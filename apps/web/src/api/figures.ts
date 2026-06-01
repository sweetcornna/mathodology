// URL helpers for kernel-produced artifacts served by the gateway.
//
// Figures and notebooks require Bearer auth. `<img>` tags can't set headers,
// so in *development* we attach the dev token as a `?token=` query param — the
// gateway accepts both `Authorization: Bearer ...` and `?token=...` (see
// docs/auth.md). This is acceptable in dev: the token is a throwaway local
// value and requests go same-origin through the Vite `/api` proxy.
//
// SECURITY (D8): in *production builds* we must NOT bake the dev token into
// the bundle and emit it as `?token=` in `<img src>` / `<a href>` URLs — the
// raw credential would leak via copy-URL, Referer headers, browser history and
// proxy/CDN access logs. So the query-param fallback is gated to DEV only.
// Production is expected to authenticate protected assets via cookies / a
// reverse-proxy session, or via short-lived signed URLs issued per resource
// (see fetchAuthedBlobUrl below for the header-carrying download path, and the
// orchestrator flag for the signed-URL design decision still owed).
//
// `VITE_GATEWAY_HTTP` is the direct gateway origin (e.g. http://127.0.0.1:8080).
// We don't use the Vite `/api` proxy here because `<img src>` happens after
// HTML parse time and we want one stable URL format across dev + build.

const BASE = import.meta.env.VITE_GATEWAY_HTTP ?? "";
const TOKEN = import.meta.env.VITE_DEV_AUTH_TOKEN ?? "";
const IS_DEV = import.meta.env.DEV;

// Append the dev token as a query param ONLY in dev builds. In prod the token
// is omitted entirely so it can never end up in a URL/log.
function withDevToken(url: string): string {
  if (!IS_DEV || !TOKEN) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(TOKEN)}`;
}

// Production figure/notebook/paper requests ride in `<img src>` / `<a href>`,
// which cannot carry an Authorization header. The gateway accepts an `mm_auth`
// cookie for GET asset routes only (so it can't be replayed as CSRF against the
// mutating POST endpoints), so we set it once at app init from the configured
// token — the token never enters a URL. In dev the SPA is cross-origin to the
// gateway (Vite proxy, different port) so this cookie isn't sent and the
// DEV-only `?token=` fallback applies; in prod the SPA is served same-origin
// (see config/Caddyfile.prod) and the browser sends the cookie automatically.
export function ensureAuthCookie(): void {
  if (typeof document === "undefined" || !TOKEN) return;
  document.cookie = `mm_auth=${TOKEN}; path=/; SameSite=Lax`;
}

export function figureUrl(runId: string, relPath: string): string {
  // `relPath` is produced by the worker as e.g. "figures/fig-0.png". It may
  // already contain slashes — encode each segment so a stray space or non-ascii
  // character survives the trip without percent-mangling path separators.
  const encoded = relPath
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  return withDevToken(`${BASE}/runs/${runId}/figures/${encoded}`);
}

export function notebookUrl(runId: string): string {
  return withDevToken(`${BASE}/runs/${runId}/notebook`);
}

// Paper markdown URL. `inline=true` renders in-browser (text/markdown +
// Content-Disposition: inline); omitted for attachment download.
export function paperUrl(runId: string, inline = false): string {
  const url = inline
    ? `${BASE}/runs/${runId}/paper?inline=true`
    : `${BASE}/runs/${runId}/paper`;
  return withDevToken(url);
}

// Fetch a protected gateway resource carrying the Bearer token in the
// `Authorization` *header* (never the URL) and return a same-origin blob URL
// safe to use as an `<img src>` / `<a href>`. This keeps the credential out of
// URLs/logs in every build. Callers own the returned object URL and should
// `URL.revokeObjectURL` it when the element is torn down.
//
// Returns null on any failure so callers can fall back to the plain URL
// (e.g. when prod auth is cookie-based and a header isn't needed).
export async function fetchAuthedBlobUrl(url: string): Promise<string | null> {
  try {
    const headers = new Headers({ accept: "*/*" });
    if (TOKEN) headers.set("authorization", `Bearer ${TOKEN}`);
    const res = await fetch(url, { method: "GET", headers });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

// Plain (token-free) resource URLs, for callers using fetchAuthedBlobUrl or a
// cookie-based prod session. Exposed so components don't reconstruct paths.
export function figurePath(runId: string, relPath: string): string {
  const encoded = relPath
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  return `${BASE}/runs/${runId}/figures/${encoded}`;
}

export function notebookPath(runId: string): string {
  return `${BASE}/runs/${runId}/notebook`;
}

export function paperPath(runId: string, inline = false): string {
  return inline
    ? `${BASE}/runs/${runId}/paper?inline=true`
    : `${BASE}/runs/${runId}/paper`;
}
