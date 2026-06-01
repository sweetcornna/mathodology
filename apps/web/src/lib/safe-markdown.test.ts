// Repro + regression test for D16 — XSS via unsanitized markdown of
// LLM-streamed assistant text in FinetuneChat.
//
// The web app has no test runner wired yet (no vitest/jest). These cases are
// written in the vitest `describe/it/expect` shape so they slot straight in
// once a runner is added, and they are *also* runnable today with:
//
//   node --experimental-strip-types --import ./src/lib/safe-markdown.test.ts
//
// (a tiny shim at the bottom executes them under plain node when the vitest
// globals are absent). The pre-fix `new Marked({gfm:true,breaks:false})`
// emitted `<img src=x onerror=alert(1)>` verbatim into v-html — these assert
// the sanitizing renderer neutralizes that while keeping real markdown.

import { createSafeMarked, sanitizeUrl } from "./safe-markdown";

interface MiniExpect {
  toBe(v: unknown): void;
  toContain(v: string): void;
  toMatch(re: RegExp): void;
  not: { toMatch(re: RegExp): void; toContain(v: string): void };
}

// Resolve a vitest-compatible (describe, it, expect) trio, or fall back to a
// minimal harness so the file runs under bare node for the repro.
type Fn = () => void;
const g = globalThis as unknown as {
  describe?: (name: string, fn: Fn) => void;
  it?: (name: string, fn: Fn) => void;
  expect?: (actual: unknown) => MiniExpect;
};

let failures = 0;
const describe =
  g.describe ??
  ((_name: string, fn: Fn) => {
    fn();
  });
const it =
  g.it ??
  ((name: string, fn: Fn) => {
    try {
      fn();
      console.log("PASS:", name);
    } catch (e) {
      failures++;
      console.error("FAIL:", name, "—", (e as Error).message);
    }
  });
const expect =
  g.expect ??
  ((actual: unknown): MiniExpect => {
    const fail = (msg: string) => {
      throw new Error(msg);
    };
    const api = {
      toBe(v: unknown) {
        if (actual !== v) fail(`expected ${String(actual)} to be ${String(v)}`);
      },
      toContain(v: string) {
        if (!String(actual).includes(v))
          fail(`expected output to contain ${v}`);
      },
      toMatch(re: RegExp) {
        if (!re.test(String(actual))) fail(`expected output to match ${re}`);
      },
      not: {
        toMatch(re: RegExp) {
          if (re.test(String(actual))) fail(`expected output NOT to match ${re}`);
        },
        toContain(v: string) {
          if (String(actual).includes(v))
            fail(`expected output NOT to contain ${v}`);
        },
      },
    };
    return api;
  });

const md = createSafeMarked();
const render = (s: string) => md.parse(s, { async: false }) as string;

describe("safe-markdown / FinetuneChat XSS (D16)", () => {
  it("neutralizes a raw <img onerror> payload (the audit repro)", () => {
    const out = render("<img src=x onerror=alert(1)>");
    expect(out).not.toMatch(/<img[^>]*onerror/i);
    expect(out).toContain("&lt;img");
  });

  it("neutralizes inline <script>", () => {
    const out = render("hello <script>alert(1)</script> world");
    expect(out).not.toMatch(/<script>/i);
  });

  it("strips javascript: from markdown links", () => {
    const out = render("[click](javascript:alert(1))");
    expect(out).not.toMatch(/href="javascript:/i);
  });

  it("strips javascript: from markdown images", () => {
    const out = render("![x](javascript:alert(1))");
    expect(out).not.toMatch(/src="javascript:/i);
  });

  it("strips data: URLs (markup smuggling)", () => {
    expect(sanitizeUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe("");
  });

  it("keeps legitimate markdown intact", () => {
    const out = render("**bold** and `code` and [link](https://e.com)");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<code>code</code>");
    expect(out).toMatch(/href="https:\/\/e\.com"/);
  });

  it("sanitizeUrl keeps http/https/relative", () => {
    expect(sanitizeUrl("https://x.com")).toBe("https://x.com");
    expect(sanitizeUrl("figures/a.png")).toBe("figures/a.png");
  });
});

// Bare-node exit code so the repro can gate CI / manual runs. Guarded via
// globalThis so this file also typechecks in the browser tsconfig (no
// @types/node).
if (!g.it && failures > 0) {
  console.error(`\n${failures} failure(s)`);
  const proc = (globalThis as { process?: { exitCode?: number } }).process;
  if (proc) proc.exitCode = 1;
}
