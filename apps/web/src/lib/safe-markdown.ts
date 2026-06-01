// Sanitizing markdown renderer for *untrusted* model output.
//
// The fine-tune assistant streams its replies over the `finetune.token` WS
// channel — i.e. raw LLM output that is manipulable via prompt injection.
// Rendering that through `v-html` with a vanilla `marked` instance is an XSS
// sink: marked (v14) does NOT escape raw HTML by default, so a streamed
// `<img src=x onerror=alert(1)>` or `<script>` would execute in the user's
// session.
//
// Rather than add a runtime sanitizer dependency (DOMPurify), we neutralize
// the dangerous surface inside marked's renderer — the same escape-based
// approach PaperDraft uses for its custom image renderer:
//   - `html`  : escape any raw HTML block / inline HTML so tags render as
//               visible text instead of live DOM.
//   - `link`  / `image`: drop dangerous URI schemes (javascript:, data:,
//               vbscript:, file:) and add `rel="noopener noreferrer"` +
//               `target="_blank"` to links.
//
// Legitimate markdown (headings, bold/italic, code, lists, tables, safe
// links/images) still renders normally — only raw HTML and dangerous URLs
// are stripped.

import { Marked } from "marked";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Schemes that can execute script or smuggle markup when placed in an
// `href`/`src`. We allow everything else (http/https/mailto/relative paths).
const DANGEROUS_SCHEME_RE = /^\s*(?:javascript|vbscript|data|file):/i;

export function sanitizeUrl(href: string | null | undefined): string {
  if (!href) return "";
  const t = href.trim();
  if (DANGEROUS_SCHEME_RE.test(t)) return "";
  return t;
}

/**
 * Build a `Marked` instance that escapes raw HTML and strips dangerous URL
 * schemes. Use for any markdown that originates from model output before it
 * reaches `v-html`.
 */
export function createSafeMarked(): Marked {
  const md = new Marked({ gfm: true, breaks: false });
  md.use({
    renderer: {
      // Raw HTML (block or inline) — render the source as escaped text so it
      // can never become live DOM.
      html(token): string {
        const raw =
          typeof token === "string"
            ? token
            : (token.text ?? token.raw ?? "");
        return escapeHtml(raw);
      },
      link(token): string {
        const href = sanitizeUrl(token.href);
        const inner = this.parser.parseInline(token.tokens);
        // Dangerous scheme stripped — fall back to rendering the link text
        // only, so the user still sees the words without a clickable sink.
        if (!href) return inner;
        const title = token.title
          ? ` title="${escapeHtml(token.title)}"`
          : "";
        return `<a href="${escapeHtml(href)}"${title} target="_blank" rel="noopener noreferrer">${inner}</a>`;
      },
      image(token): string {
        const href = sanitizeUrl(token.href);
        const alt = escapeHtml(token.text ?? "");
        if (!href) return alt;
        const title = token.title
          ? ` title="${escapeHtml(token.title)}"`
          : "";
        return `<img src="${escapeHtml(href)}" alt="${alt}"${title} loading="lazy" decoding="async" />`;
      },
    },
  });
  return md;
}
