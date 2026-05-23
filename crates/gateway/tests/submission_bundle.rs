//! Integration tests for `GET /runs/:run_id/submission`.
//!
//! Light tests (always on): auth, 404 when meta missing, 422 on bad
//! template, run-id mismatch.
//!
//! Heavy tests (`#[ignore]`): the actual ZIP build path, which shells out
//! to tectonic (and pandoc for CUMCM docx). These match the binary-gated
//! tests in `export_paper.rs`. Run them explicitly with:
//!
//!   cargo test -p gateway --test submission_bundle -- --ignored
//!
//! Heavy tests verify the per-template ZIP layout (file presence,
//! anonymity guarantees, MD5 manifest format).

use std::io::Cursor;
use std::io::Read;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::serve;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_DISPOSITION, CONTENT_TYPE};
use sqlx::postgres::PgPoolOptions;
use tempfile::{NamedTempFile, TempDir};
use tokio::net::TcpListener;
use tokio::time::timeout;
use uuid::Uuid;

use gateway::app::build_router;
use gateway::config::AppConfig;
use gateway::llm::LlmContext;
use gateway::state::AppState;

const DEV_TOKEN: &str = "test-token-submission";

async fn write_providers_toml() -> NamedTempFile {
    let file = NamedTempFile::new().expect("tempfile");
    let toml = r#"
[[providers]]
name = "mock"
kind = "openai_compat"
base_url = "http://127.0.0.1:1/v1"
api_key_env = ""
models = ["deepseek-chat"]
price_input_per_1m = 1.0
price_output_per_1m = 2.0

[router]
default_model = "deepseek-chat"
fallback = []
"#;
    std::fs::write(file.path(), toml).expect("write providers.toml");
    file
}

async fn build_state(providers_path: PathBuf, runs_dir: PathBuf) -> AppState {
    let redis_url =
        std::env::var("TEST_REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379/0".into());
    let database_url = std::env::var("TEST_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://mm:mm@127.0.0.1:5432/mm".into());

    let client = redis::Client::open(redis_url.clone()).expect("redis client");
    let redis = redis::aio::ConnectionManager::new(client)
        .await
        .expect("redis connect");

    let pg = PgPoolOptions::new()
        .max_connections(2)
        .acquire_timeout(Duration::from_secs(3))
        .connect(&database_url)
        .await
        .expect("postgres connect");

    let cfg = AppConfig {
        host: "127.0.0.1".into(),
        port: 0,
        dev_auth_token: DEV_TOKEN.into(),
        redis_url,
        database_url,
        providers_path: providers_path.clone(),
        runs_dir: runs_dir.clone(),
        static_dir: None,
    };
    let llm = LlmContext::bootstrap(&providers_path).expect("LlmContext::bootstrap");

    AppState {
        redis,
        pg,
        config: Arc::new(cfg),
        llm,
        runs_dir: Arc::new(runs_dir),
    }
}

/// Boot a router and seed a run directory with paper.md, paper.meta.json,
/// a notebook (with a Python code cell), a figure, and a couple of
/// `cost` events in events.jsonl so the AI Use Report has something to
/// aggregate.
async fn boot_server_with_full_run(
    seed_meta: bool,
) -> (SocketAddr, TempDir, NamedTempFile, Uuid, PathBuf) {
    let runs_tmp = tempfile::tempdir().expect("runs tempdir");
    let runs_dir = tokio::fs::canonicalize(runs_tmp.path())
        .await
        .expect("canonicalize runs tempdir");

    let run_id = Uuid::new_v4();
    let run_root = runs_dir.join(run_id.to_string());
    tokio::fs::create_dir_all(&run_root)
        .await
        .expect("mkdir run");
    tokio::fs::create_dir_all(run_root.join("figures"))
        .await
        .expect("mkdir figures");

    let md = "# Title\n\nBody paragraph with $E=mc^2$.\n";
    tokio::fs::write(run_root.join("paper.md"), md)
        .await
        .expect("write paper.md");

    if seed_meta {
        let meta = serde_json::json!({
            "title": "End-to-end submission bundle smoke test",
            "abstract": "Short abstract for the bundle smoke test. Contains $\\pm 5\\%$ math.",
            "competition_type": "cumcm",
            "problem_text": "Synthetic problem text for tests.",
            "sections": [
                {"title": "Introduction", "body_markdown": "Hello world."},
                {"title": "Results", "body_markdown": "We report $K_R = 1.0$."}
            ],
            "references": ["Knuth (1984). Literate Programming."],
            "figures": []
        });
        tokio::fs::write(
            run_root.join("paper.meta.json"),
            serde_json::to_vec_pretty(&meta).unwrap(),
        )
        .await
        .expect("write paper.meta.json");
    }

    // Tiny notebook with one code cell — enough to validate the
    // extract_python_from_notebook path inside the bundle build.
    let nb = serde_json::json!({
        "cells": [
            {"cell_type": "code", "source": "import numpy as np\nx = np.arange(10)\n"},
            {"cell_type": "markdown", "source": "## A heading"}
        ],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    });
    tokio::fs::write(
        run_root.join("notebook.ipynb"),
        serde_json::to_vec_pretty(&nb).unwrap(),
    )
    .await
    .expect("write notebook.ipynb");

    // 1×1 transparent PNG so figures/ isn't empty
    let png_1px: [u8; 67] = [
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F,
        0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00,
        0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];
    tokio::fs::write(run_root.join("figures").join("test.png"), png_1px)
        .await
        .expect("write png");

    // events.jsonl with two cost events from different agents so AI Use
    // Report aggregates by model and rolls up the agent set.
    let events = [
        r#"{"run_id":"x","agent":"writer","kind":"cost","seq":1,"ts":"2026-05-23T00:00:00Z","payload":{"model":"gpt-5-pro","prompt_tokens":100,"completion_tokens":50}}"#,
        r#"{"run_id":"x","agent":"coder","kind":"cost","seq":2,"ts":"2026-05-23T00:00:01Z","payload":{"model":"claude-sonnet-4-6","prompt_tokens":300,"completion_tokens":80}}"#,
    ]
    .join("\n");
    tokio::fs::write(run_root.join("events.jsonl"), events)
        .await
        .expect("write events.jsonl");

    let providers_file = write_providers_toml().await;
    let state = build_state(providers_file.path().to_path_buf(), runs_dir).await;

    let router = build_router(state);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = serve(listener, router).await;
    });
    tokio::time::sleep(Duration::from_millis(20)).await;

    (addr, runs_tmp, providers_file, run_id, run_root)
}

fn auth_headers() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {DEV_TOKEN}")).unwrap(),
    );
    h
}

/// Check whether `name` is on PATH and spawnable. We only care about
/// spawn success — not the exit status — because some binaries (notably
/// poppler's `pdftotext` and `pdfinfo`) reject `--version` and exit
/// non-zero even when fully installed (they want `-v`). The previous
/// `--version + status.success()` check silently skipped poppler-gated
/// assertions even when poppler was installed.
fn have_binary(name: &str) -> bool {
    match std::process::Command::new(name).arg("-v").output() {
        Ok(_) => true,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
        Err(_) => false,
    }
}

/// Shell out to `pdftotext - -` (read PDF from stdin, write text to stdout)
/// and return the extracted text. Panics on failure — only called from
/// tests gated on `have_binary("pdftotext")`.
fn pdftotext_all(pdf_bytes: &[u8]) -> String {
    use std::io::Write as _;
    let mut child = std::process::Command::new("pdftotext")
        .arg("-")
        .arg("-")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("spawn pdftotext");
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(pdf_bytes)
        .expect("write pdf");
    let out = child.wait_with_output().expect("wait pdftotext");
    assert!(out.status.success(), "pdftotext failed: {:?}", out.stderr);
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn pdftotext_first_page(pdf_bytes: &[u8]) -> String {
    use std::io::Write as _;
    let mut child = std::process::Command::new("pdftotext")
        .args(["-f", "1", "-l", "1", "-", "-"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("spawn pdftotext");
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(pdf_bytes)
        .expect("write pdf");
    let out = child.wait_with_output().expect("wait pdftotext");
    assert!(out.status.success(), "pdftotext failed: {:?}", out.stderr);
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// `pdfinfo` doesn't read PDF from stdin, so we write the bytes to a
/// temp file first.
fn pdfinfo_title(pdf_bytes: &[u8]) -> String {
    let tmp = tempfile::NamedTempFile::new().expect("tempfile");
    std::fs::write(tmp.path(), pdf_bytes).expect("write tmp pdf");
    let out = std::process::Command::new("pdfinfo")
        .arg(tmp.path())
        .output()
        .expect("spawn pdfinfo");
    assert!(out.status.success(), "pdfinfo failed: {:?}", out.stderr);
    let s = String::from_utf8_lossy(&out.stdout);
    for line in s.lines() {
        if let Some(rest) = line.strip_prefix("Title:") {
            return rest.trim().to_string();
        }
    }
    String::new()
}

// ---------------------------------------------------------------------------
// Light tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn submission_requires_auth() {
    let (addr, _tmp, _prov, run_id, _root) = boot_server_with_full_run(true).await;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("http://{addr}/runs/{run_id}/submission"))
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn submission_bad_template_is_422() {
    let (addr, _tmp, _prov, run_id, _root) = boot_server_with_full_run(true).await;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!(
            "http://{addr}/runs/{run_id}/submission?template=bogus"
        ))
        .headers(auth_headers())
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 422);
}

#[tokio::test]
async fn submission_missing_meta_is_404() {
    let (addr, _tmp, _prov, run_id, _root) = boot_server_with_full_run(false).await;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("http://{addr}/runs/{run_id}/submission"))
        .headers(auth_headers())
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn submission_unknown_run_is_404() {
    let (addr, _tmp, _prov, _run_id, _root) = boot_server_with_full_run(true).await;
    let client = reqwest::Client::new();
    let other = Uuid::new_v4();
    let resp = client
        .get(format!("http://{addr}/runs/{other}/submission"))
        .headers(auth_headers())
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 404);
}

// ---------------------------------------------------------------------------
// Heavy tests — gated on tectonic. CUMCM also exercises pandoc (best
// effort; docx render failure is non-fatal).
// ---------------------------------------------------------------------------

fn assert_zip_contains(bytes: &[u8], expected: &[&str]) -> zip::ZipArchive<Cursor<Vec<u8>>> {
    let cursor = Cursor::new(bytes.to_vec());
    let archive = zip::ZipArchive::new(cursor).expect("valid zip");
    let names: std::collections::HashSet<String> =
        archive.file_names().map(|s| s.to_string()).collect();
    for ex in expected {
        assert!(
            names.contains(*ex),
            "expected `{ex}` in bundle; got {names:?}"
        );
    }
    archive
}

fn read_zip_entry(
    archive: &mut zip::ZipArchive<Cursor<Vec<u8>>>,
    name: &str,
) -> Vec<u8> {
    let mut file = archive.by_name(name).expect(name);
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).expect("read");
    buf
}

#[tokio::test]
#[ignore = "shells out to tectonic; run with --ignored"]
async fn submission_mcm_bundle_has_pdf_and_readme() {
    if !have_binary("tectonic") {
        eprintln!("skipping: tectonic not on PATH");
        return;
    }
    let (addr, _tmp, _prov, run_id, _root) = boot_server_with_full_run(true).await;
    let client = reqwest::Client::new();

    let resp = timeout(
        Duration::from_secs(600),
        client
            .get(format!(
                "http://{addr}/runs/{run_id}/submission?template=mcm"
            ))
            .headers(auth_headers())
            .send(),
    )
    .await
    .expect("no timeout")
    .expect("send");
    assert_eq!(resp.status(), 200);
    assert_eq!(
        resp.headers().get(CONTENT_TYPE).and_then(|v| v.to_str().ok()),
        Some("application/zip")
    );
    let cd = resp.headers().get(CONTENT_DISPOSITION).cloned();
    assert!(cd.is_some());

    let bytes = resp.bytes().await.expect("body").to_vec();
    let mut archive = assert_zip_contains(
        &bytes,
        &[
            &format!("{run_id}.pdf"),
            "README.txt",
            "source/paper.tex",
            "source/paper.md",
            "source/figures/test.png",
        ],
    );

    // README mentions the COMAP submission url and the rename-to-control
    // number step, so the team knows what to do with the file.
    let readme = String::from_utf8(read_zip_entry(&mut archive, "README.txt")).unwrap();
    assert!(readme.contains("comap.org") || readme.contains("comap.com"));
    assert!(readme.contains("Rename") || readme.contains("rename") || readme.contains("Team"));

    // Main paper PDF: starts with %PDF magic header.
    let pdf_bytes = read_zip_entry(&mut archive, &format!("{run_id}.pdf"));
    assert!(pdf_bytes.starts_with(b"%PDF"), "main pdf has %PDF magic");

    // The rendered LaTeX must reference the AI use report (because we
    // injected events).
    let tex = String::from_utf8(read_zip_entry(&mut archive, "source/paper.tex")).unwrap();
    assert!(tex.contains("Report on Use of AI"));
    assert!(tex.contains("gpt-5-pro"));
}

#[tokio::test]
#[ignore = "shells out to tectonic; run with --ignored"]
async fn submission_cumcm_bundle_has_anon_print_and_md5() {
    if !have_binary("tectonic") {
        eprintln!("skipping: tectonic not on PATH");
        return;
    }
    let (addr, _tmp, _prov, run_id, _root) = boot_server_with_full_run(true).await;
    let client = reqwest::Client::new();

    let resp = timeout(
        Duration::from_secs(600),
        client
            .get(format!(
                "http://{addr}/runs/{run_id}/submission?template=cumcm"
            ))
            .headers(auth_headers())
            .send(),
    )
    .await
    .expect("no timeout")
    .expect("send");
    assert_eq!(resp.status(), 200);

    let bytes = resp.bytes().await.expect("body").to_vec();
    let mut archive = assert_zip_contains(
        &bytes,
        &[
            "论文-匿名版.pdf",
            "论文-打印版-签字用.pdf",
            "支撑材料.zip",
            "MD5.txt",
            "README.txt",
        ],
    );

    // Both PDFs are real (start with %PDF magic).
    let anon = read_zip_entry(&mut archive, "论文-匿名版.pdf");
    let print = read_zip_entry(&mut archive, "论文-打印版-签字用.pdf");
    assert!(anon.starts_with(b"%PDF"));
    assert!(print.starts_with(b"%PDF"));

    // ANONYMITY + INJECTION proof — the original size-comparison check
    // (anon.len() < print.len()) is theatre: PDF size depends heavily on
    // compression / font subset reuse / xref overhead, and adding two
    // mostly-empty pages can land EITHER way. Replace with a semantic
    // check via poppler's `pdftotext`: the printed variant's first page
    // must contain 承诺书 text, the anonymous variant must NOT contain
    // any 承诺书 / 编号专用页 strings anywhere.
    if have_binary("pdftotext") {
        let anon_text = pdftotext_all(&anon);
        let print_first = pdftotext_first_page(&print);
        // We probe via body-text strings that appear ONLY in the cover
        // letter, not the paper body. Heading glyphs like "承诺书"
        // rendered with `\Large\bfseries` under Fandol fonts often lose
        // their ToUnicode CMap entries in poppler's text extraction, so
        // those strings are unreliable witnesses. The two-line policy
        // body extracts cleanly.
        let cover_only_strings = [
            "我们仔细阅读了《全国大学生数学建模竞赛章程》",
            "我们郑重承诺",
        ];
        for needle in cover_only_strings {
            assert!(
                print_first.contains(needle),
                "printed variant page 1 missing cover-letter witness {needle:?}; \
                 first-page text was:\n{print_first}"
            );
            assert!(
                !anon_text.contains(needle),
                "anonymous variant leaks cover-letter witness {needle:?}; \
                 leak text len = {} chars",
                anon_text.len()
            );
        }
        // The 编号专用页 reviewer-record table is similarly cover-only.
        assert!(
            !anon_text.contains("赛区评阅编号"),
            "anonymous variant must not contain 赛区评阅编号"
        );
        // PDF metadata title must NOT carry meta.title verbatim — the
        // anon path overrides pdftitle to a generic string. We probe
        // via pdfinfo Title field.
        if have_binary("pdfinfo") {
            let anon_title = pdfinfo_title(&anon);
            let print_title = pdfinfo_title(&print);
            assert!(
                !anon_title.contains("End-to-end submission bundle"),
                "anon PDF metadata title leaks meta.title: {anon_title:?}"
            );
            assert!(
                anon_title.to_ascii_lowercase().contains("anonymous"),
                "anon PDF should advertise itself as anonymous in title; got {anon_title:?}"
            );
            assert!(
                print_title.contains("End-to-end submission bundle"),
                "print PDF should keep meta.title in metadata; got {print_title:?}"
            );
        }
    } else {
        eprintln!("skipping content-based anon/print assertions: pdftotext not on PATH");
    }

    // MD5 manifest: contains both file names and 32-char hex lines.
    let md5 = String::from_utf8(read_zip_entry(&mut archive, "MD5.txt")).unwrap();
    assert!(md5.contains("论文-匿名版.pdf"));
    assert!(md5.contains("支撑材料.zip"));
    // hex regex check — at least two lines with 32-char hex prefix
    let hex_lines = md5
        .lines()
        .filter(|l| {
            let parts: Vec<&str> = l.split_whitespace().collect();
            parts.len() >= 2 && parts[1].len() == 32 && parts[1].chars().all(|c| c.is_ascii_hexdigit())
        })
        .count();
    assert!(
        hex_lines >= 2,
        "expected two MD5 hex lines in MD5.txt; got: {md5}"
    );

    // Nested 支撑材料.zip is a real zip; sub-archive contains the
    // notebook + extracted source.py + the figure.
    let support_bytes = read_zip_entry(&mut archive, "支撑材料.zip");
    let mut support = zip::ZipArchive::new(Cursor::new(support_bytes)).expect("nested zip");
    let support_names: std::collections::HashSet<String> =
        support.file_names().map(|s| s.to_string()).collect();
    assert!(support_names.contains("notebook.ipynb"));
    assert!(support_names.contains("code/source.py"));
    assert!(support_names.contains("figures/test.png"));

    // Extracted code carries the notebook cell content.
    let mut src = support.by_name("code/source.py").unwrap();
    let mut s = String::new();
    src.read_to_string(&mut s).unwrap();
    assert!(s.contains("import numpy as np"));

    // ANONYMITY GUARANTEE: no run_id-derived filename anywhere in the
    // top-level archive or the support archive. (The bundle uses fixed
    // Chinese filenames; UUIDs would leak ordering / per-run state.)
    let top_names: Vec<String> = archive.file_names().map(|s| s.to_string()).collect();
    for n in &top_names {
        assert!(
            !n.contains(&run_id.to_string()),
            "top-level filename {n} leaks run_id"
        );
    }
    for n in support_names.iter() {
        assert!(
            !n.contains(&run_id.to_string()),
            "support filename {n} leaks run_id"
        );
    }
}

#[tokio::test]
#[ignore = "shells out to tectonic; run with --ignored"]
async fn submission_huashu_bundle_has_paper_and_support() {
    if !have_binary("tectonic") {
        eprintln!("skipping: tectonic not on PATH");
        return;
    }
    let (addr, _tmp, _prov, run_id, _root) = boot_server_with_full_run(true).await;
    let client = reqwest::Client::new();

    // override competition_type via query — meta is still cumcm
    let resp = timeout(
        Duration::from_secs(600),
        client
            .get(format!(
                "http://{addr}/runs/{run_id}/submission?template=huashu"
            ))
            .headers(auth_headers())
            .send(),
    )
    .await
    .expect("no timeout")
    .expect("send");
    assert_eq!(resp.status(), 200);

    let bytes = resp.bytes().await.expect("body").to_vec();
    let mut archive =
        assert_zip_contains(&bytes, &["论文.pdf", "支撑材料.zip", "README.txt"]);

    let pdf = read_zip_entry(&mut archive, "论文.pdf");
    assert!(pdf.starts_with(b"%PDF"));

    let support_bytes = read_zip_entry(&mut archive, "支撑材料.zip");
    let support = zip::ZipArchive::new(Cursor::new(support_bytes)).expect("nested zip");
    let names: std::collections::HashSet<String> =
        support.file_names().map(|s| s.to_string()).collect();
    assert!(names.contains("notebook.ipynb"));
    assert!(names.contains("figures/test.png"));
}
