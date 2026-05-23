//! Submission-bundle endpoint.
//!
//! `GET /runs/:run_id/submission?template=<mcm|icm|cumcm|huashu>` returns a
//! ZIP archive containing every file the team needs to upload to the
//! competition platform — including secondary artefacts each competition
//! demands (cover-letter / 编号专用页 / 支撑材料 / MD5 manifest / AI-use
//! report) that the standalone `/export/:format` route does not produce.
//!
//! Per-template ZIP layout (all UTF-8 paths inside the archive):
//!
//! * **MCM / ICM** (`template=mcm` or `icm`)
//!   ```text
//!   submission-mcm-<run>.zip
//!   ├── <run>.pdf          # main paper + appended Report on Use of AI
//!   ├── README.txt         # COMAP upload checklist
//!   └── source/            # archive copy for the team's own records
//!       ├── paper.tex
//!       ├── paper.md
//!       └── figures/*.png
//!   ```
//!
//! * **CUMCM** (`template=cumcm`)
//!   ```text
//!   submission-cumcm-<run>.zip
//!   ├── 论文-匿名版.pdf      # uploads to cumcm.cnki.net (no 承诺书/编号页)
//!   ├── 论文-打印版-签字用.pdf # printed copy with 承诺书 + 编号专用页
//!   ├── 论文.docx           # optional alternate format
//!   ├── 支撑材料.zip         # nested per spec: notebook + code + figures
//!   ├── MD5.txt             # MD5 manifest required by the upload client
//!   └── README.txt          # CUMCM submission checklist
//!   ```
//!
//! * **Huashu Cup** (`template=huashu`)
//!   ```text
//!   submission-huashu-<run>.zip
//!   ├── 论文.pdf            # with 承诺书 as first page
//!   ├── 支撑材料.zip         # notebook + code + figures
//!   └── README.txt          # 赛氪 saikr.com upload instructions
//!   ```
//!
//! All bundles are built fully in-memory (`Vec<u8>`) because each component
//! has independent retry semantics and we want a single atomic body to
//! hand back to axum. The 100 MB hard cap avoids buffering the response
//! body twice (once here, once in axum), and is well below any of the
//! three platforms' upload ceilings. The support-archive walker enforces
//! a tighter 80 MB / 500-file budget *during* construction so we reject
//! before the OOM window opens, rather than after assembly when the
//! damage is already done.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::Path as StdPath;

use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::Response;
use chrono::{Datelike, Utc};
use md5::{Digest, Md5};
use serde::Deserialize;
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;
use zip::ZipWriter;

use crate::error::AppError;
use crate::routes::export::{
    compile_docx, compile_pdf, render_tex, resolve_within, tera, PaperMeta, RenderExtras,
    TemplateKind,
};
use crate::state::AppState;

/// Hard cap on the *assembled* bundle (post-build safety net). COMAP's own
/// upload limit is 25 MB; CUMCM is unstated but in practice 50 MB+ trips
/// the upload client. 100 MB leaves headroom for two CUMCM variants +
/// docx + figures while staying well under any platform ceiling.
const MAX_BUNDLE_BYTES: usize = 100 * 1024 * 1024;

/// Per-bundle budget for the support archive (figures + data combined).
/// Enforced *during* the walk so we reject oversized inputs before
/// committing them to memory — avoids the post-build OOM window where a
/// malicious or misconfigured run could buffer ~512 MB before the
/// `MAX_BUNDLE_BYTES` check trips.
const SUPPORT_MAX_BYTES: u64 = 80 * 1024 * 1024;
/// Cap on the number of files included in the support archive. Bounds the
/// ZIP central directory size; without this a `data/` dir holding 10k
/// small CSVs would balloon the metadata even if total bytes stay sane.
const SUPPORT_MAX_FILES: usize = 500;
/// Per-file size cap for support-archive entries. Larger than the
/// figures-export 32 MB cap because competition input data files
/// (NetCDF, parquet, large CSVs) routinely exceed 32 MB. Files above
/// this are warn-and-skipped, not fatal: better to ship a slightly
/// incomplete bundle than to fail the whole submission.
const SUPPORT_PER_FILE_MAX_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Deserialize)]
pub struct SubmissionQuery {
    #[serde(default)]
    pub template: Option<String>,
}

#[tracing::instrument(skip_all, fields(%run_id))]
pub async fn export_submission(
    State(state): State<AppState>,
    Path(run_id): Path<Uuid>,
    Query(q): Query<SubmissionQuery>,
) -> Result<Response, AppError> {
    let run_root = state.runs_dir.join(run_id.to_string());
    let canonical = tokio::fs::canonicalize(&run_root).await.map_err(|e| {
        tracing::debug!(error = %e, "canonicalize run root failed");
        AppError::NotFound
    })?;

    // paper.meta.json is the single source of truth for what the bundle
    // contains (title, abstract, references, figures…). If the writer
    // hasn't finished, the bundle simply can't be assembled.
    let meta_path = resolve_within(&canonical, &canonical.join("paper.meta.json")).await?;
    let meta_bytes = tokio::fs::read(&meta_path).await.map_err(|e| {
        tracing::debug!(error = %e, "read paper.meta.json");
        AppError::NotFound
    })?;
    let meta: PaperMeta = serde_json::from_slice(&meta_bytes)
        .map_err(|e| AppError::UnprocessableEntity(format!("paper.meta.json invalid: {e}")))?;

    let template = match q.template.as_deref() {
        Some(s) => TemplateKind::parse(s).ok_or_else(|| {
            AppError::UnprocessableEntity(format!(
                "unsupported template {s:?}; expected one of mcm|icm|cumcm|huashu"
            ))
        })?,
        None => TemplateKind::from_competition(meta.competition_type.as_deref()),
    };

    let (zip_bytes, label) = match template {
        TemplateKind::Mcm => (build_mcm_bundle(&meta, &canonical, run_id).await?, "mcm"),
        TemplateKind::Cumcm => (
            build_cumcm_bundle(&meta, &canonical, run_id).await?,
            "cumcm",
        ),
        TemplateKind::Huashu => (
            build_huashu_bundle(&meta, &canonical, run_id).await?,
            "huashu",
        ),
    };

    if zip_bytes.len() > MAX_BUNDLE_BYTES {
        return Err(AppError::PayloadTooLarge);
    }

    build_zip_response(zip_bytes, label, run_id)
}

// ---------------------------------------------------------------------------
// Per-template bundle builders
// ---------------------------------------------------------------------------

async fn build_mcm_bundle(
    meta: &PaperMeta,
    run_root: &StdPath,
    run_id: Uuid,
) -> Result<Vec<u8>, AppError> {
    // events.jsonl is optional — if absent, the AI report renders the
    // "no LLM calls recorded" fallback row (still required by COMAP, but
    // signals to judges that the team ran without LLM assistance).
    let events_path = run_root.join("events.jsonl");
    let ai_section = build_ai_use_report_section(&events_path).await?;

    let extras = RenderExtras {
        cover_letter_section: "",
        ai_use_report_section: &ai_section,
        pdf_title_override: None,
    };
    let tex = render_tex(meta, TemplateKind::Mcm, run_root, extras).await?;
    let pdf = compile_pdf(&tex).await?;

    let mut buf: Vec<u8> = Vec::with_capacity(pdf.len() + 64 * 1024);
    {
        let mut zw = ZipWriter::new(std::io::Cursor::new(&mut buf));
        let opts = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o644);

        // The COMAP rule: "Use your team's control number as the name of
        // your PDF file attachment". We can't know the control number
        // server-side, so we name it after the run-id (the team can
        // simply rename to `0000000.pdf` before uploading). The README
        // calls this out.
        let pdf_name = format!("{run_id}.pdf");
        zw.start_file(&pdf_name, opts).map_err(zip_err)?;
        zw.write_all(&pdf).map_err(zip_err)?;

        zw.start_file("README.txt", opts).map_err(zip_err)?;
        zw.write_all(README_MCM.as_bytes()).map_err(zip_err)?;

        // Archive source — purely for the team's own records / for later
        // reproduction. COMAP does NOT want code or auxiliary files.
        zw.start_file("source/paper.tex", opts).map_err(zip_err)?;
        zw.write_all(tex.as_bytes()).map_err(zip_err)?;

        if let Ok(md) = tokio::fs::read(run_root.join("paper.md")).await {
            zw.start_file("source/paper.md", opts).map_err(zip_err)?;
            zw.write_all(&md).map_err(zip_err)?;
        }

        add_archival_figures_to_zip(&mut zw, run_root, "source/figures", opts).await?;

        zw.finish().map_err(zip_err)?;
    }
    Ok(buf)
}

async fn build_cumcm_bundle(
    meta: &PaperMeta,
    run_root: &StdPath,
    _run_id: Uuid,
) -> Result<Vec<u8>, AppError> {
    let year = Utc::now().year();
    let cover_letter = render_fragment("cumcm_cover_letter.tex.tera", year)?;

    // Anonymous variant — what gets uploaded to cumcm.cnki.net. No cover
    // letter, no team_id (render_tex inserts empty strings by default),
    // PDF metadata title overridden to a generic string so even
    // `meta.title` (which teams sometimes set to "Team 12345 — Model X")
    // doesn't leak into the PDF properties. Matches the rule:
    //   "在参赛论文电子版及支撑材料压缩包内任何位置（含文件夹名、
    //    文件名和文档属性等）均不能包含与参赛队有关的信息".
    const ANON_PDF_TITLE: &str = "CUMCM Submission (anonymous)";
    let anon_extras = RenderExtras {
        cover_letter_section: "",
        ai_use_report_section: "",
        pdf_title_override: Some(ANON_PDF_TITLE),
    };
    let anon_tex = render_tex(meta, TemplateKind::Cumcm, run_root, anon_extras).await?;
    let anon_pdf = compile_pdf(&anon_tex).await?;

    // Printed variant — same body, but cover letter (承诺书 + 编号专用页)
    // prepended as the first two pages, signature lines blank for the
    // team to fill by hand.
    let extras = RenderExtras {
        cover_letter_section: &cover_letter,
        ai_use_report_section: "",
        pdf_title_override: None,
    };
    let print_tex = render_tex(meta, TemplateKind::Cumcm, run_root, extras).await?;
    let print_pdf = compile_pdf(&print_tex).await?;

    // DOCX is best-effort — the team isn't required to upload it (CUMCM
    // accepts PDF), so a missing pandoc shouldn't fail the whole bundle.
    let docx = match tokio::fs::metadata(run_root.join("paper.md")).await {
        Ok(_) => match compile_docx(&run_root.join("paper.md"), run_root).await {
            Ok(b) => Some(b),
            Err(e) => {
                tracing::warn!(error = ?e, "CUMCM bundle: docx render skipped");
                None
            }
        },
        Err(_) => None,
    };

    let support_zip = build_support_zip(run_root).await?;

    let pdf_md5 = md5_hex(&anon_pdf);
    let support_md5 = md5_hex(&support_zip);
    let md5_txt = format!(
        "# {year} 高教社杯全国大学生数学建模竞赛 — 提交文件 MD5 校验码\n\
         #\n\
         # 在客户端按提示分别上传以下两个文件的 MD5 校验码；上传文件后系统\n\
         # 会重新计算并比对。重命名为 <队号>.pdf / <队号>.zip 不会改变 MD5。\n\
         \n\
         论文-匿名版.pdf    {pdf_md5}\n\
         支撑材料.zip       {support_md5}\n",
    );

    let mut buf: Vec<u8> =
        Vec::with_capacity(anon_pdf.len() + print_pdf.len() + support_zip.len() + 64 * 1024);
    {
        let mut zw = ZipWriter::new(std::io::Cursor::new(&mut buf));
        let opts = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o644);
        // STORE for the nested ZIP — re-deflating an already-deflated
        // payload doesn't compress further and just costs CPU.
        let stored = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Stored)
            .unix_permissions(0o644);

        zw.start_file("论文-匿名版.pdf", opts).map_err(zip_err)?;
        zw.write_all(&anon_pdf).map_err(zip_err)?;

        zw.start_file("论文-打印版-签字用.pdf", opts)
            .map_err(zip_err)?;
        zw.write_all(&print_pdf).map_err(zip_err)?;

        if let Some(d) = docx {
            zw.start_file("论文.docx", opts).map_err(zip_err)?;
            zw.write_all(&d).map_err(zip_err)?;
        }

        zw.start_file("支撑材料.zip", stored).map_err(zip_err)?;
        zw.write_all(&support_zip).map_err(zip_err)?;

        zw.start_file("MD5.txt", opts).map_err(zip_err)?;
        zw.write_all(md5_txt.as_bytes()).map_err(zip_err)?;

        zw.start_file("README.txt", opts).map_err(zip_err)?;
        zw.write_all(README_CUMCM.as_bytes()).map_err(zip_err)?;

        zw.finish().map_err(zip_err)?;
    }
    Ok(buf)
}

async fn build_huashu_bundle(
    meta: &PaperMeta,
    run_root: &StdPath,
    _run_id: Uuid,
) -> Result<Vec<u8>, AppError> {
    // 华数杯 expects 承诺书 on the FIRST page of the uploaded paper, with
    // student signatures. Unlike CUMCM there's no separate anonymous
    // variant — the commitment letter is part of the submitted paper.
    let year = Utc::now().year();
    let cover_letter = render_fragment("huashu_cover_letter.tex.tera", year)?;
    let extras = RenderExtras {
        cover_letter_section: &cover_letter,
        ai_use_report_section: "",
        pdf_title_override: None,
    };
    let tex = render_tex(meta, TemplateKind::Huashu, run_root, extras).await?;
    let pdf = compile_pdf(&tex).await?;

    let support_zip = build_support_zip(run_root).await?;

    let mut buf: Vec<u8> = Vec::with_capacity(pdf.len() + support_zip.len() + 32 * 1024);
    {
        let mut zw = ZipWriter::new(std::io::Cursor::new(&mut buf));
        let opts = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o644);
        let stored = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Stored)
            .unix_permissions(0o644);

        zw.start_file("论文.pdf", opts).map_err(zip_err)?;
        zw.write_all(&pdf).map_err(zip_err)?;

        zw.start_file("支撑材料.zip", stored).map_err(zip_err)?;
        zw.write_all(&support_zip).map_err(zip_err)?;

        zw.start_file("README.txt", opts).map_err(zip_err)?;
        zw.write_all(README_HUASHU.as_bytes()).map_err(zip_err)?;

        zw.finish().map_err(zip_err)?;
    }
    Ok(buf)
}

// ---------------------------------------------------------------------------
// Support archive (支撑材料.zip) — used by CUMCM and Huashu
// ---------------------------------------------------------------------------

async fn build_support_zip(run_root: &StdPath) -> Result<Vec<u8>, AppError> {
    let mut buf: Vec<u8> = Vec::with_capacity(2 * 1024 * 1024);
    {
        let mut zw = ZipWriter::new(std::io::Cursor::new(&mut buf));
        let opts = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o644);

        // 1. notebook.ipynb — the Coder's executed Jupyter notebook,
        //    with author / kernel-display-name metadata scrubbed so a
        //    hand-edited notebook with team info baked in doesn't leak
        //    into the anonymous support archive.
        let notebook_path = run_root.join("notebook.ipynb");
        if let Ok(nb) = tokio::fs::read(&notebook_path).await {
            let scrubbed = scrub_notebook_metadata(&nb);
            zw.start_file("notebook.ipynb", opts).map_err(zip_err)?;
            zw.write_all(&scrubbed).map_err(zip_err)?;

            // 2. code/source.py — extracted code cells concatenated, so a
            //    reviewer who doesn't have Jupyter installed can still
            //    read the program logic. CUMCM specifically requires
            //    "可运行的源程序代码" — keeping a flat .py beside the
            //    notebook makes that obvious without `jupyter nbconvert`.
            if let Some(py) = extract_python_from_notebook(&scrubbed) {
                zw.start_file("code/source.py", opts).map_err(zip_err)?;
                zw.write_all(py.as_bytes()).map_err(zip_err)?;
            }
        }

        // 3. figures/ — all PNGs from the run's figures directory.
        // 4. data/ — optional; some problems provide reference data
        //    inside the run dir. Walked shallowly (one level deep) so
        //    we don't accidentally suck in node_modules-sized trees.
        // Both share a SupportBudget so cumulative size / file-count
        // caps are enforced across the two directories together.
        let mut budget = SupportBudget::new();
        add_dir_to_zip(
            &mut zw,
            &run_root.join("figures"),
            "figures",
            opts,
            &mut budget,
        )
        .await?;
        let data_dir = run_root.join("data");
        if is_existing_dir(&data_dir).await {
            add_dir_to_zip(&mut zw, &data_dir, "data", opts, &mut budget).await?;
        }

        // 5. README inside the inner zip — survives unpacking the
        //    nested archive (reviewers might extract this independently).
        zw.start_file("README.txt", opts).map_err(zip_err)?;
        zw.write_all(README_SUPPORT.as_bytes()).map_err(zip_err)?;

        zw.finish().map_err(zip_err)?;
    }
    Ok(buf)
}

/// Running totals enforced across all support-archive directories.
/// Single mutable struct passed by reference so figures + data share
/// one budget (10 000 figures × 1 MB shouldn't be allowed just because
/// they're spread across two directories).
struct SupportBudget {
    bytes: u64,
    files: usize,
}

impl SupportBudget {
    fn new() -> Self {
        Self { bytes: 0, files: 0 }
    }

    /// Reserve `size` bytes + 1 file slot. Returns `Err(PayloadTooLarge)`
    /// when adding would exceed either cap so the caller bails before
    /// reading the file into memory.
    fn try_reserve(&mut self, size: u64) -> Result<(), AppError> {
        if self.files + 1 > SUPPORT_MAX_FILES {
            tracing::warn!(
                cap = SUPPORT_MAX_FILES,
                "support archive: file count cap exceeded"
            );
            return Err(AppError::PayloadTooLarge);
        }
        let projected = self.bytes.saturating_add(size);
        if projected > SUPPORT_MAX_BYTES {
            tracing::warn!(
                projected,
                cap = SUPPORT_MAX_BYTES,
                "support archive: cumulative size cap exceeded"
            );
            return Err(AppError::PayloadTooLarge);
        }
        self.bytes = projected;
        self.files += 1;
        Ok(())
    }
}

/// Unified directory-to-zip walker used for both `figures/` and `data/`.
/// Missing source dir is non-fatal (returns Ok). Each file is:
///   * skipped if its name starts with `.` (dotfiles like `.DS_Store`)
///   * skipped (with warn) if its size exceeds `SUPPORT_PER_FILE_MAX_BYTES`
///   * counted against the shared `SupportBudget`; bundle aborted with
///     `PayloadTooLarge` if budget is busted.
async fn add_dir_to_zip<W: Write + std::io::Seek>(
    zw: &mut ZipWriter<W>,
    src_dir: &StdPath,
    prefix: &str,
    opts: SimpleFileOptions,
    budget: &mut SupportBudget,
) -> Result<(), AppError> {
    let mut rd = match tokio::fs::read_dir(src_dir).await {
        Ok(r) => r,
        Err(_) => return Ok(()), // missing source dir is OK
    };
    while let Some(entry) = rd
        .next_entry()
        .await
        .map_err(|e| AppError::Internal(format!("walk {}: {e}", src_dir.display())))?
    {
        let path = entry.path();
        let meta = match tokio::fs::metadata(&path).await {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) if !n.starts_with('.') => n.to_string(),
            _ => continue,
        };
        // M7: single oversized file → warn + skip, NOT fail the bundle.
        // Competition data files routinely exceed the 32 MB figures cap
        // (NetCDF, parquet, raw sensor dumps). Better a slightly thin
        // bundle than no bundle.
        let size = meta.len();
        if size > SUPPORT_PER_FILE_MAX_BYTES {
            tracing::warn!(
                path = %path.display(),
                size,
                cap = SUPPORT_PER_FILE_MAX_BYTES,
                "support archive: skipping file above per-file cap"
            );
            continue;
        }
        budget.try_reserve(size)?;
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|e| AppError::Internal(format!("read {}: {e}", path.display())))?;
        zw.start_file(format!("{prefix}/{name}"), opts)
            .map_err(zip_err)?;
        zw.write_all(&bytes).map_err(zip_err)?;
    }
    Ok(())
}

/// MCM bundle's archival `source/figures/` copy — no budget tracking
/// because (a) it's the team's own paper figures, bounded by the
/// pipeline, and (b) the COMAP bundle ships only the main PDF for
/// upload, so source/ exists purely for the team's offline records.
async fn add_archival_figures_to_zip<W: Write + std::io::Seek>(
    zw: &mut ZipWriter<W>,
    run_root: &StdPath,
    prefix: &str,
    opts: SimpleFileOptions,
) -> Result<(), AppError> {
    let figures_dir = run_root.join("figures");
    let mut rd = match tokio::fs::read_dir(&figures_dir).await {
        Ok(r) => r,
        Err(_) => return Ok(()),
    };
    while let Some(entry) = rd
        .next_entry()
        .await
        .map_err(|e| AppError::Internal(format!("walk figures: {e}")))?
    {
        let path = entry.path();
        let meta = match tokio::fs::metadata(&path).await {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) if !n.starts_with('.') => n.to_string(),
            _ => continue,
        };
        // Pipeline-produced figures are tightly bounded (8-12 PNGs at
        // <2 MB each); a 32 MB ceiling is generous and rejects only
        // genuinely broken inputs.
        if meta.len() > 32 * 1024 * 1024 {
            tracing::warn!(
                path = %path.display(),
                size = meta.len(),
                "archival figures: skipping oversized file"
            );
            continue;
        }
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|e| AppError::Internal(format!("read {}: {e}", path.display())))?;
        zw.start_file(format!("{prefix}/{name}"), opts)
            .map_err(zip_err)?;
        zw.write_all(&bytes).map_err(zip_err)?;
    }
    Ok(())
}

/// Async replacement for `Path::is_dir()` which would otherwise issue a
/// blocking `stat(2)` syscall on the tokio runtime. Cheap (one syscall)
/// but the rest of the module is meticulous about async I/O; staying
/// consistent avoids future surprises when this gets called under load.
async fn is_existing_dir(path: &StdPath) -> bool {
    tokio::fs::metadata(path)
        .await
        .map(|m| m.is_dir())
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// AI Use Report (MCM only) — reduces events.jsonl into a usage table
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Clone)]
struct ModelUsage {
    calls: u64,
    prompt_tokens: u64,
    completion_tokens: u64,
    used_by: std::collections::BTreeSet<String>,
}

/// Walks `events.jsonl` line-by-line and aggregates every `kind=cost`
/// event by model. Resilient to:
///   * missing file (returns the "no calls recorded" fallback)
///   * malformed lines (silently skipped — we're reading a forensic log)
///   * missing payload fields (treated as 0)
async fn build_ai_use_report_section(events_path: &StdPath) -> Result<String, AppError> {
    let mut models: BTreeMap<String, ModelUsage> = BTreeMap::new();

    if events_path.is_file() {
        let raw = tokio::fs::read_to_string(events_path)
            .await
            .map_err(|e| AppError::Internal(format!("read events.jsonl: {e}")))?;
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let v: serde_json::Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if v.get("kind").and_then(|k| k.as_str()) != Some("cost") {
                continue;
            }
            let payload = match v.get("payload") {
                Some(p) => p,
                None => continue,
            };
            let model = payload
                .get("model")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown")
                .to_string();
            let prompt = payload
                .get("prompt_tokens")
                .and_then(|t| t.as_u64())
                .unwrap_or(0);
            let completion = payload
                .get("completion_tokens")
                .and_then(|t| t.as_u64())
                .unwrap_or(0);
            // Normalize agent names: a single agent can show up as
            // both "writer" and "finetune_writer" depending on whether
            // the call originated from the main pipeline or a finetune
            // chat session. Judges only care about the role; collapse
            // the finetune_ prefix so the "Used by" cell stays clean.
            let agent = v.get("agent").and_then(|a| a.as_str()).unwrap_or("unknown");
            let agent = agent.strip_prefix("finetune_").unwrap_or(agent).to_string();

            let entry = models.entry(model).or_default();
            entry.calls += 1;
            entry.prompt_tokens += prompt;
            entry.completion_tokens += completion;
            entry.used_by.insert(agent);
        }
    }

    let models_ctx: Vec<serde_json::Value> = models
        .iter()
        .map(|(name, u)| {
            let used_by = u.used_by.iter().cloned().collect::<Vec<_>>().join(", ");
            serde_json::json!({
                "name": name,
                "provider": infer_provider(name),
                "calls": u.calls,
                "prompt_tokens": u.prompt_tokens,
                "completion_tokens": u.completion_tokens,
                "used_by": used_by,
            })
        })
        .collect();

    let mut ctx = tera::Context::new();
    ctx.insert("models", &models_ctx);
    ctx.insert(
        "generated_at",
        &Utc::now().format("%Y-%m-%d %H:%M UTC").to_string(),
    );

    tera()
        .render("ai_use_report.tex.tera", &ctx)
        .map_err(|e| AppError::Internal(format!("render ai_use_report: {e}")))
}

fn infer_provider(model: &str) -> String {
    let m = model.to_ascii_lowercase();
    let known: Option<&str> = if m.starts_with("gpt-")
        || m.starts_with("o1")
        || m.starts_with("o3")
        || m.starts_with("o4")
    {
        Some("OpenAI")
    } else if m.starts_with("claude") {
        Some("Anthropic")
    } else if m.starts_with("gemini") {
        Some("Google")
    } else if m.starts_with("deepseek") {
        Some("DeepSeek")
    } else if m.starts_with("glm") {
        Some("Zhipu AI")
    } else if m.starts_with("qwen") {
        Some("Alibaba")
    } else if m.starts_with("doubao") {
        Some("ByteDance")
    } else if m.starts_with("moonshot") || m.starts_with("kimi") {
        Some("Moonshot AI")
    } else if m.starts_with("grok") {
        Some("xAI")
    } else if m.starts_with("yi-") {
        Some("01.AI")
    } else {
        None
    };
    match known {
        Some(s) => s.to_string(),
        // Fallback: use the model's first hyphen-separated segment,
        // title-cased. "foobar-pro-v2" → "Foobar". Reads more naturally
        // in the judges' table than a literal "LLM provider".
        None => {
            let first = model.split('-').next().unwrap_or(model);
            let mut chars = first.chars();
            match chars.next() {
                Some(c) => c.to_ascii_uppercase().to_string() + chars.as_str(),
                None => "Other".to_string(),
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn render_fragment(name: &str, year: i32) -> Result<String, AppError> {
    // Cover letter fragments take only the current year — passing it via
    // Tera (rather than hardcoding `2025`) keeps the rendered PDF
    // year-accurate without a code change every September. CUMCM is held
    // in Sept–Nov and 华数杯 in Aug, so wall-clock year is the
    // correct default.
    let mut ctx = tera::Context::new();
    ctx.insert("year", &year);
    tera()
        .render(name, &ctx)
        .map_err(|e| AppError::Internal(format!("render {name}: {e}")))
}

fn md5_hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut h = Md5::new();
    h.update(bytes);
    let out = h.finalize();
    let mut s = String::with_capacity(32);
    for b in out.iter() {
        // write! writes into the existing String buffer; format!() would
        // allocate a fresh 2-char String per byte.
        write!(&mut s, "{b:02x}").expect("infallible into String");
    }
    s
}

/// Best-effort: pull every `cell_type == "code"` cell's source out of a
/// Jupyter notebook JSON and concatenate them into a single .py blob. We
/// don't fail the bundle on malformed notebooks — the .ipynb itself is
/// always included alongside.
///
/// The first line is a shebang + utf-8 coding cookie so the file is
/// directly executable on POSIX and signals encoding to Windows
/// reviewers / pdf-to-text grep workflows.
fn extract_python_from_notebook(nb_bytes: &[u8]) -> Option<String> {
    let v: serde_json::Value = serde_json::from_slice(nb_bytes).ok()?;
    let cells = v.get("cells")?.as_array()?;
    let mut out = String::new();
    out.push_str("#!/usr/bin/env python3\n");
    out.push_str("# -*- coding: utf-8 -*-\n");
    out.push_str("# Source code extracted from notebook.ipynb\n");
    out.push_str("# Generated by mathodology submission bundle.\n\n");
    for (idx, cell) in cells.iter().enumerate() {
        if cell.get("cell_type").and_then(|t| t.as_str()) != Some("code") {
            continue;
        }
        // Programmatically-built notebooks sometimes omit `source` entirely
        // (`nbformat.v4.new_code_cell()` with no body); skip the cell
        // rather than aborting the whole extraction — losing one cell's
        // listing is better than losing the entire source.py.
        let source = match cell.get("source") {
            Some(s) => s,
            None => continue,
        };
        // `source` is either a string or an array of strings (per nbformat 4)
        let text = match source {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Array(arr) => arr
                .iter()
                .filter_map(|v| v.as_str())
                .collect::<Vec<_>>()
                .join(""),
            _ => continue,
        };
        if text.trim().is_empty() {
            continue;
        }
        out.push_str(&format!("# ===== Cell {} =====\n", idx + 1));
        out.push_str(&text);
        if !text.ends_with('\n') {
            out.push('\n');
        }
        out.push('\n');
    }
    Some(out)
}

/// Remove identifying metadata from a Jupyter notebook before bundling.
///
/// CUMCM's anonymity rule covers "文档属性" (document properties), and
/// `nbformat`'s top-level `metadata` field is a documented carrier for
/// author / kernel / institution names. Per-cell metadata is also
/// commonly used by JupyterLab plugins for the same purpose.
///
/// On any parse failure we return the input unchanged — losing the scrub
/// is preferable to losing the notebook.
fn scrub_notebook_metadata(nb_bytes: &[u8]) -> Vec<u8> {
    let mut v: serde_json::Value = match serde_json::from_slice(nb_bytes) {
        Ok(v) => v,
        Err(_) => return nb_bytes.to_vec(),
    };
    // Scrub top-level metadata fields that commonly carry author info.
    // We leave kernelspec / language_info alone (they're needed for
    // re-execution), but drop the human-name display name in favour of
    // the language name only.
    if let Some(meta) = v.get_mut("metadata").and_then(|m| m.as_object_mut()) {
        for key in ["authors", "author", "title", "institution", "affiliation"] {
            meta.remove(key);
        }
        if let Some(ks) = meta.get_mut("kernelspec").and_then(|k| k.as_object_mut()) {
            // "Python 3 (ipykernel)" -> "Python 3"; harmless but tidy.
            if let Some(name) = ks.get("name").and_then(|n| n.as_str()) {
                let pinned = name.to_string();
                ks.insert(
                    "display_name".into(),
                    serde_json::Value::String(pinned.clone()),
                );
            }
        }
    }
    // Per-cell metadata authors (rare but real for hand-edited
    // notebooks).
    if let Some(cells) = v.get_mut("cells").and_then(|c| c.as_array_mut()) {
        for cell in cells.iter_mut() {
            if let Some(meta) = cell.get_mut("metadata").and_then(|m| m.as_object_mut()) {
                for key in ["authors", "author", "tags"] {
                    // `tags` removed because some labs tag cells with team
                    // identifiers ("team-12345-final"); judges don't need
                    // them.
                    meta.remove(key);
                }
            }
        }
    }
    serde_json::to_vec(&v).unwrap_or_else(|_| nb_bytes.to_vec())
}

/// Accepts both `ZipError` (start_file/finish) and `io::Error`
/// (write_all on the underlying writer) so call sites can stay terse.
fn zip_err<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Internal(format!("zip: {e}"))
}

fn build_zip_response(bytes: Vec<u8>, label: &str, run_id: Uuid) -> Result<Response, AppError> {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/zip"),
    );
    if let Ok(hv) = HeaderValue::from_str(&bytes.len().to_string()) {
        headers.insert(header::CONTENT_LENGTH, hv);
    }
    let disposition = format!("attachment; filename=\"submission-{label}-{run_id}.zip\"");
    if let Ok(hv) = HeaderValue::from_str(&disposition) {
        headers.insert(header::CONTENT_DISPOSITION, hv);
    }
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );

    let mut resp = Response::builder()
        .status(StatusCode::OK)
        .body(Body::from(bytes))
        .map_err(|e| AppError::Internal(format!("response build: {e}")))?;
    *resp.headers_mut() = headers;
    Ok(resp)
}

// ---------------------------------------------------------------------------
// README boilerplate (Chinese where the target user base is Chinese)
// ---------------------------------------------------------------------------

const README_MCM: &str = r#"MCM / ICM Submission Bundle
============================

Files in this archive:

  <run_id>.pdf          The paper to upload to COMAP. Contains the 25-page
                        solution + the "Report on Use of AI" appendix
                        (page-limit exempt per COMAP 2026 AI Policy).
  README.txt            This file.
  source/               Reference copy of the LaTeX source, Markdown, and
                        figures. NOT to be uploaded to COMAP.

Before submitting:

  1. Rename <run_id>.pdf to <TeamControlNumber>.pdf
     (e.g. 0000007.pdf). COMAP requires the team control number as the
     filename: see contest.comap.com/undergraduate/contests/mcm/instructions.php

  2. Verify the file is < 25 MB. If oversized, lower figure DPI or
     compress images.

  3. Confirm anonymity: the PDF must NOT contain any student name,
     advisor name, or institution name. The header shows only
     "Team #  , Page X of Y" (intentionally blank — leave it that way).

  4. Upload from the contest dashboard. The submission form URL changes
     each contest year; navigate to it from
     https://www.comap.com/contests/mcm-icm by following the "Submit your
     paper" link for the current year. The deadline is typically 9:00 PM
     EST on the final contest day.

Generated by mathodology submission-bundle endpoint.
"#;

const README_CUMCM: &str = r#"CUMCM 全国大学生数学建模竞赛 — 提交材料压缩包
==================================================

本压缩包内包含的文件：

  论文-匿名版.pdf          用于上传 cumcm.cnki.net 的电子论文。
                          不含 承诺书 / 编号专用页，符合官方匿名要求。
  论文-打印版-签字用.pdf    与匿名版正文相同，但增加 承诺书 + 编号专用页 两页，
                          供参赛队打印、签字、装订后交赛区组委会。
  论文.docx               同一论文的 docx 版本（可选）。
  支撑材料.zip             官方要求的"支撑材料"（notebook + 源代码 + 图表）。
  MD5.txt                 上传时所需的 MD5 校验码。
  README.txt              本文件。

提交流程（依据 mcm.edu.cn 官方规则）：

  1. 登录 https://cumcm.cnki.net 竞赛管理系统。

  2. 将下列文件重命名为本队 12 位参赛队号后再上传：
       论文-匿名版.pdf   →  <12 位队号>.pdf
       支撑材料.zip      →  <12 位队号>.zip
     cnki 客户端会校验文件名与队号一致；不重命名将上传失败。

  3. 在客户端中按提示分别上传：
       a. "参赛论文"   -> <12 位队号>.pdf
       b. "支撑材料"   -> <12 位队号>.zip
     如客户端要求填写 MD5 校验码，请参考 MD5.txt 中的对应值
     （重命名不会改变文件内容，MD5 仍然有效）。

  4. 打印 论文-打印版-签字用.pdf：
       第 1 页为承诺书 —— 三位队员、指导教师签字，并填写参赛队号、题号、学校。
       第 2 页为编号专用页 —— 留空，由赛区/全国组委会评阅时填写。
       第 3 页起为论文正文。
     按赛区要求装订后交本校竞赛组负责老师。

  5. 关键匿名要求：参赛论文电子版及支撑材料压缩包内 任何位置（含文件夹名、
     文件名、文档属性）均不能包含与参赛队有关的信息。本工具生成的两个 ZIP
     已严格匿名（论文 PDF 的标题元数据被改写成通用字符串，notebook 的
     authors 元数据已剥离），请勿在提交前手工添加 README 或重命名队员信息
     相关文件。

Generated by mathodology submission-bundle endpoint.
"#;

const README_HUASHU: &str = r#""华数杯"全国大学生数学建模竞赛 — 提交材料压缩包
======================================================

本压缩包内包含的文件：

  论文.pdf                提交论文。第一页为承诺书（签字栏需打印后手写填入），
                          其后为论文正文。
  支撑材料.zip             notebook + 源代码 + 图表。
  README.txt              本文件。

提交流程（依据 saikr.com 官方赛事页）：

  1. 由队长用电脑登录赛氪官网 https://www.saikr.com ，在搜索框输入
     "华数杯"，进入本届赛事页（年度赛事页路径每年不同，请从官网导航）。

  2. 打印 论文.pdf 第一页（承诺书），三位队员签字，扫描或拍照插回 PDF
     之前；或按赛事页指示，将签字版作为附件一并上传。

  3. 上传论文（PDF）和支撑材料（ZIP），按截止时间（一般为竞赛结束日 20:00）
     完成提交。

  4. 注意事项：
       * 论文将通过查重系统比对；
       * 获奖论文的源代码将被运行检查，请确保 支撑材料.zip 中的代码可执行；
       * 请遵守竞赛规则，禁止参赛队员加入与赛题相关的思路交流群。

Generated by mathodology submission-bundle endpoint.
"#;

const README_SUPPORT: &str = r#"支撑材料 (Support Materials)
============================

  notebook.ipynb        Jupyter notebook executed end-to-end inside the
                        gateway's sandboxed kernel (papermill-compatible).
  code/source.py        Code cells extracted and concatenated for
                        reviewers without Jupyter installed.
  figures/*.png         All figures referenced in the paper, at 300 dpi.
  data/                 (Optional) Reference data files, if any.

This archive is generated automatically; do not edit by hand before
submission. All paths inside are anonymised — no team/school metadata.
"#;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn md5_matches_known_vector() {
        // RFC 1321 test vector: MD5("abc") = 900150983cd24fb0d6963f7d28e17f72
        assert_eq!(md5_hex(b"abc"), "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(md5_hex(b""), "d41d8cd98f00b204e9800998ecf8427e");
    }

    #[test]
    fn provider_inference_covers_common_models() {
        assert_eq!(infer_provider("gpt-5-pro"), "OpenAI");
        assert_eq!(infer_provider("GPT-4o-mini"), "OpenAI");
        assert_eq!(infer_provider("o3-mini-high"), "OpenAI");
        assert_eq!(infer_provider("claude-sonnet-4-6"), "Anthropic");
        assert_eq!(infer_provider("gemini-2.5-pro"), "Google");
        assert_eq!(infer_provider("deepseek-r1"), "DeepSeek");
        assert_eq!(infer_provider("glm-4.6"), "Zhipu AI");
        assert_eq!(infer_provider("qwen3-max"), "Alibaba");
        assert_eq!(infer_provider("doubao-pro"), "ByteDance");
        assert_eq!(infer_provider("kimi-k2"), "Moonshot AI");
        assert_eq!(infer_provider("moonshot-v1"), "Moonshot AI");
        assert_eq!(infer_provider("grok-3"), "xAI");
        assert_eq!(infer_provider("yi-large"), "01.AI");
        // Unknown models fall back to the title-cased first segment of
        // the model name — reads more naturally to a judge than a
        // literal "LLM provider" placeholder.
        assert_eq!(infer_provider("some-unknown-model"), "Some");
        assert_eq!(infer_provider("foobar"), "Foobar");
        assert_eq!(infer_provider(""), "Other");
    }

    #[test]
    fn fragment_renders_without_context() {
        // Both cover-letter fragments + the AI report are no-context
        // Tera templates today; this guards against future {{ vars }}
        // sneaking in without the call site being updated.
        for name in [
            "cumcm_cover_letter.tex.tera",
            "huashu_cover_letter.tex.tera",
        ] {
            let out =
                render_fragment(name, 2026).unwrap_or_else(|e| panic!("render {name}: {e:?}"));
            assert!(out.contains("承诺书"), "{name} renders the 承诺书 header");
        }
    }

    #[test]
    fn ai_use_report_renders_with_empty_models() {
        let mut ctx = tera::Context::new();
        ctx.insert("models", &Vec::<serde_json::Value>::new());
        ctx.insert("generated_at", "2026-05-23 12:00 UTC");
        let out = tera()
            .render("ai_use_report.tex.tera", &ctx)
            .expect("renders empty");
        assert!(out.contains("Report on Use of AI"));
        assert!(
            out.contains("No LLM calls recorded"),
            "empty model list yields the fallback row"
        );
    }

    #[test]
    fn ai_use_report_renders_with_models() {
        let models = vec![
            serde_json::json!({
                "name": "gpt-5-pro",
                "provider": "OpenAI",
                "calls": 12,
                "prompt_tokens": 412020,
                "completion_tokens": 23110,
                "used_by": "modeler, writer",
            }),
            serde_json::json!({
                "name": "claude-sonnet-4-6",
                "provider": "Anthropic",
                "calls": 8,
                "prompt_tokens": 100000,
                "completion_tokens": 50000,
                "used_by": "coder, critic",
            }),
        ];
        let mut ctx = tera::Context::new();
        ctx.insert("models", &models);
        ctx.insert("generated_at", "2026-05-23 12:00 UTC");
        let out = tera()
            .render("ai_use_report.tex.tera", &ctx)
            .expect("renders");
        assert!(out.contains("gpt-5-pro"));
        assert!(out.contains("OpenAI"));
        assert!(out.contains("claude-sonnet-4-6"));
        assert!(out.contains("412020"));
        assert!(out.contains("modeler, writer"));
    }

    #[test]
    fn extract_python_handles_string_and_array_source() {
        let nb = serde_json::json!({
            "cells": [
                {"cell_type": "code", "source": "print('hello')\n"},
                {"cell_type": "markdown", "source": "# heading"},
                {"cell_type": "code", "source": ["import numpy as np\n", "x = np.arange(10)\n"]},
                {"cell_type": "code", "source": ""},  // empty cell, skipped
            ]
        });
        let bytes = serde_json::to_vec(&nb).unwrap();
        let out = extract_python_from_notebook(&bytes).expect("extracts");
        assert!(out.contains("print('hello')"));
        assert!(out.contains("import numpy as np"));
        assert!(out.contains("x = np.arange(10)"));
        assert!(!out.contains("# heading"), "markdown cells skipped");
        assert!(out.contains("Cell 1"));
        assert!(out.contains("Cell 3"));
        assert!(!out.contains("Cell 4"), "empty cell skipped");
    }

    #[test]
    fn extract_python_returns_none_on_garbage() {
        assert!(extract_python_from_notebook(b"not json").is_none());
        assert!(extract_python_from_notebook(b"{}").is_none());
    }

    #[test]
    fn extract_python_skips_cells_missing_source() {
        // Regression for B3: a code cell missing `source` (legal per
        // nbformat, produced e.g. by `new_code_cell()` with no body)
        // used to early-return None and drop the ENTIRE source.py.
        // After fix: skip just that cell, keep the rest.
        let nb = serde_json::json!({
            "cells": [
                {"cell_type": "code", "source": "ok = 1\n"},
                {"cell_type": "code"},  // no `source` at all
                {"cell_type": "code", "source": "ok = 2\n"},
            ]
        });
        let bytes = serde_json::to_vec(&nb).unwrap();
        let out = extract_python_from_notebook(&bytes).expect("must NOT be None");
        assert!(out.contains("ok = 1"));
        assert!(out.contains("ok = 2"));
        // The shebang + coding-cookie header is present too.
        assert!(out.starts_with("#!/usr/bin/env python3"));
    }

    #[test]
    fn scrub_notebook_metadata_removes_authors() {
        let nb = serde_json::json!({
            "metadata": {
                "authors": [{"name": "Alice"}],
                "author": "Bob",
                "title": "team-12345-final",
                "institution": "Tsinghua",
                "kernelspec": {"name": "python3", "display_name": "Alice's local Python"},
                "language_info": {"name": "python", "version": "3.11"},
            },
            "cells": [
                {
                    "cell_type": "code",
                    "source": "print(1)",
                    "metadata": {"authors": ["Alice"], "tags": ["team-12345-final"]},
                }
            ]
        });
        let scrubbed = scrub_notebook_metadata(&serde_json::to_vec(&nb).unwrap());
        let v: serde_json::Value = serde_json::from_slice(&scrubbed).unwrap();
        let meta = v.get("metadata").unwrap();
        assert!(meta.get("authors").is_none());
        assert!(meta.get("author").is_none());
        assert!(meta.get("title").is_none());
        assert!(meta.get("institution").is_none());
        // kernelspec.display_name rewritten to kernelspec.name
        assert_eq!(
            meta.pointer("/kernelspec/display_name")
                .and_then(|v| v.as_str()),
            Some("python3")
        );
        // language_info preserved (needed for re-execution).
        assert_eq!(
            meta.pointer("/language_info/name").and_then(|v| v.as_str()),
            Some("python")
        );
        // Per-cell authors + tags scrubbed.
        let cell_meta = v.pointer("/cells/0/metadata").unwrap();
        assert!(cell_meta.get("authors").is_none());
        assert!(cell_meta.get("tags").is_none());
    }

    #[test]
    fn scrub_notebook_metadata_passes_garbage_through() {
        // On unparseable input, the scrubber returns the raw bytes
        // unchanged — losing the scrub is preferable to losing the
        // notebook entirely.
        let raw = b"this is not a notebook";
        assert_eq!(scrub_notebook_metadata(raw), raw);
    }

    #[test]
    fn render_fragment_substitutes_year() {
        let out = render_fragment("cumcm_cover_letter.tex.tera", 2027).unwrap();
        assert!(out.contains("2027 高教社杯"));
        assert!(!out.contains("2025 高教社杯"));
        let out_h = render_fragment("huashu_cover_letter.tex.tera", 2027).unwrap();
        assert!(out_h.contains("2027 “华数杯”"));
    }

    #[tokio::test]
    async fn ai_report_handles_missing_events() {
        let dir = tempfile::tempdir().expect("tmp");
        let out = build_ai_use_report_section(&dir.path().join("events.jsonl"))
            .await
            .expect("returns ok");
        assert!(out.contains("Report on Use of AI"));
        assert!(out.contains("No LLM calls recorded"));
    }

    #[tokio::test]
    async fn ai_report_aggregates_cost_events() {
        let dir = tempfile::tempdir().expect("tmp");
        let p = dir.path().join("events.jsonl");
        let events = [
            r#"{"run_id":"x","agent":"writer","kind":"cost","seq":1,"ts":"2026-05-23T00:00:00Z","payload":{"model":"gpt-5-pro","prompt_tokens":100,"completion_tokens":50}}"#,
            r#"{"run_id":"x","agent":"writer","kind":"cost","seq":2,"ts":"2026-05-23T00:00:01Z","payload":{"model":"gpt-5-pro","prompt_tokens":200,"completion_tokens":75}}"#,
            r#"{"run_id":"x","agent":"coder","kind":"cost","seq":3,"ts":"2026-05-23T00:00:02Z","payload":{"model":"claude-sonnet-4-6","prompt_tokens":1000,"completion_tokens":300}}"#,
            r#"{"run_id":"x","agent":"writer","kind":"stage.done","seq":4,"ts":"2026-05-23T00:00:03Z","payload":{}}"#,
            r#"{this is garbage"#,
            r#""#,
        ]
        .join("\n");
        tokio::fs::write(&p, events).await.unwrap();
        let out = build_ai_use_report_section(&p).await.expect("ok");

        assert!(out.contains("gpt-5-pro"));
        assert!(out.contains("claude-sonnet-4-6"));
        // gpt-5-pro: 2 calls, 300 prompt, 125 completion
        assert!(out.contains(" 2 ") && out.contains(" 300 ") && out.contains(" 125 "));
        // claude: 1 call, 1000 prompt, 300 completion
        assert!(out.contains(" 1 ") && out.contains(" 1000 ") && out.contains(" 300 "));
        // Agent set rolled up
        assert!(out.contains("writer"));
        assert!(out.contains("coder"));
        // stage.done was NOT counted
        assert!(
            !out.contains("stage.done"),
            "non-cost events must not appear in the report"
        );
    }
}
