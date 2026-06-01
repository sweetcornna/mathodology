// Repro + regression test for D8 — the dev auth token must NOT appear as a
// `?token=` query param in figure / notebook / paper URLs in production
// builds (it leaks via copy-URL, Referer, history, proxy/CDN logs). In dev it
// stays for local convenience.
//
// `import.meta.env.{DEV,VITE_DEV_AUTH_TOKEN,VITE_GATEWAY_HTTP}` are inlined by
// Vite at build time. Under bare node we simulate each build by transpiling
// figures.ts with esbuild `define`s (see /tmp/esbuild-loader-def.mjs). The
// runner sets MATHO_DEFINES to pick the dev or prod variant, so this file is
// invoked twice — once per build mode — by the harness comment below:
//
//   MATHO_DEFINES='{"import.meta.env.DEV":"true","import.meta.env.VITE_DEV_AUTH_TOKEN":"\"sekret\"","import.meta.env.VITE_GATEWAY_HTTP":"\"http://gw\""}' \
//     node --loader /tmp/esbuild-loader-def.mjs --import ./src/api/figures.test.ts
//   MATHO_DEFINES='{"import.meta.env.DEV":"false", ...}' node ... (prod)
//
// It also works in vitest with `vi.stubEnv`.

import {
  figureUrl,
  notebookUrl,
  paperUrl,
  figurePath,
  notebookPath,
} from "./figures";

interface MiniExpect {
  toBe(v: unknown): void;
  toContain(v: string): void;
  not: { toContain(v: string): void };
}
type Fn = () => void;
const g = globalThis as unknown as {
  describe?: (name: string, fn: Fn) => void;
  it?: (name: string, fn: Fn) => void;
  expect?: (actual: unknown) => MiniExpect;
};
let failures = 0;
const describe = g.describe ?? ((_n: string, fn: Fn) => fn());
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
  ((actual: unknown): MiniExpect => ({
    toBe(v: unknown) {
      if (actual !== v)
        throw new Error(`expected ${String(actual)} to be ${String(v)}`);
    },
    toContain(v: string) {
      if (!String(actual).includes(v))
        throw new Error(`expected "${String(actual)}" to contain "${v}"`);
    },
    not: {
      toContain(v: string) {
        if (String(actual).includes(v))
          throw new Error(`expected "${String(actual)}" NOT to contain "${v}"`);
      },
    },
  }));

// Detect which build the harness compiled us for. We re-derive it from a URL:
// dev appends `?token=`, prod does not.
const isDevBuild = figureUrl("r1", "figures/a.png").includes("token=");

describe(`figures URL token leak (D8) — ${isDevBuild ? "DEV" : "PROD"} build`, () => {
  if (isDevBuild) {
    it("DEV: keeps ?token= for local convenience", () => {
      expect(figureUrl("r1", "figures/a.png")).toContain("token=");
      expect(notebookUrl("r1")).toContain("token=");
      expect(paperUrl("r1")).toContain("token=");
      expect(paperUrl("r1", true)).toContain("token=");
    });
  } else {
    it("PROD: figureUrl carries NO token query param", () => {
      const u = figureUrl("r1", "figures/a.png");
      expect(u).not.toContain("token=");
      expect(u).not.toContain("sekret");
    });
    it("PROD: notebookUrl carries NO token query param", () => {
      expect(notebookUrl("r1")).not.toContain("token=");
    });
    it("PROD: paperUrl (download + inline) carries NO token query param", () => {
      expect(paperUrl("r1")).not.toContain("token=");
      expect(paperUrl("r1", true)).not.toContain("token=");
      // inline flag must still be present, just without the token.
      expect(paperUrl("r1", true)).toContain("inline=true");
    });
  }

  it("path helpers are always token-free (header/cookie auth path)", () => {
    expect(figurePath("r1", "figures/a.png")).not.toContain("token=");
    expect(notebookPath("r1")).not.toContain("token=");
  });
});

if (!g.it && failures > 0) {
  console.error(`\n${failures} failure(s)`);
  const proc = (globalThis as { process?: { exitCode?: number } }).process;
  if (proc) proc.exitCode = 1;
}
