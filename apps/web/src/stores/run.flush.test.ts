// Repro + regression test for D24 — the module-level `_flushScheduled` flag
// and the rAF handle must be reset/cancelled in reset() so the next run's
// first token frame is not dropped.
//
// The store's token-batching block (stores/run.ts) is module-level state that
// can't be imported in isolation under bare node (pinia + import.meta.env +
// `@/` aliases). This test reproduces that exact scheduling pattern — the
// `_flushScheduled` flag, the cancellable handle, and the reset path — and
// proves the bug deterministically:
//
//   BUGGY (no reset of the flag/handle): a flush scheduled for run A leaves
//   _flushScheduled === true after reset(); run B's first token sees the flag
//   set and schedules NOTHING, so run B's opening frame never paints until the
//   stale run-A callback eventually fires.
//
//   FIXED (reset cancels the handle and clears the flag): run B's first token
//   schedules a fresh flush and the opening frame paints.
//
// Runnable in vitest shape and under bare node (via the shim at the bottom).

interface MiniExpect {
  toBe(v: unknown): void;
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
  }));

// A manual rAF queue so the test controls exactly when flushes fire.
function makeScheduler() {
  const queued = new Map<number, () => void>();
  let nextId = 1;
  return {
    raf(cb: () => void): number {
      const id = nextId++;
      queued.set(id, cb);
      return id;
    },
    cancel(id: number) {
      queued.delete(id);
    },
    // Fire all currently-queued callbacks (simulating the next frame).
    frame() {
      const cbs = [...queued.values()];
      queued.clear();
      for (const cb of cbs) cb();
    },
    pendingCount() {
      return queued.size;
    },
  };
}

// Model of the store's token-flush singletons, parameterised by whether
// reset() applies the D24 fix. We expose the internal flag/handle so the test
// can assert on the scheduling state directly — that is the root cause.
function makeStore(opts: { applyFix: boolean }) {
  const sched = makeScheduler();
  const pending = new Map<string, string>();
  const tokens: Record<string, string> = {};
  const internal = { flushScheduled: false, flushHandle: null as number | null };
  let freshSchedules = 0;

  function onToken(agent: string, delta: string) {
    pending.set(agent, (pending.get(agent) ?? "") + delta);
    if (!internal.flushScheduled) {
      internal.flushScheduled = true;
      freshSchedules++;
      internal.flushHandle = sched.raf(() => {
        internal.flushScheduled = false;
        internal.flushHandle = null;
        for (const [k, v] of pending) tokens[k] = (tokens[k] ?? "") + v;
        pending.clear();
      });
    }
  }

  function reset() {
    pending.clear();
    if (opts.applyFix) {
      if (internal.flushHandle !== null) {
        sched.cancel(internal.flushHandle);
        internal.flushHandle = null;
      }
      internal.flushScheduled = false;
    }
    for (const k of Object.keys(tokens)) delete tokens[k];
  }

  return {
    sched,
    tokens,
    internal,
    onToken,
    reset,
    freshSchedulesSince(n: number) {
      return freshSchedules - n;
    },
    freshSchedules: () => freshSchedules,
  };
}

describe("token flush scheduling across run switch (D24)", () => {
  it("BUGGY reset leaves _flushScheduled stuck true, so run B schedules no fresh frame", () => {
    const s = makeStore({ applyFix: false });
    // Run A: a token is buffered and a flush is scheduled (not yet fired).
    s.onToken("writer", "A-first");
    // User clicks "New run" before the frame fires -> reset() (buggy: leaves
    // the flag set and the stale handle queued).
    s.reset();
    expect(s.internal.flushScheduled).toBe(true); // <-- the defect
    const before = s.freshSchedules();
    // Run B: first token arrives but, seeing the stale flag, schedules NO
    // fresh flush — run B's opening frame is bound to run A's stale callback.
    s.onToken("writer", "B-first");
    expect(s.freshSchedulesSince(before)).toBe(0);
  });

  it("FIXED reset clears the flag so run B schedules its own first frame", () => {
    const s = makeStore({ applyFix: true });
    s.onToken("writer", "A-first");
    s.reset();
    expect(s.internal.flushScheduled).toBe(false);
    const before = s.freshSchedules();
    s.onToken("writer", "B-first");
    expect(s.freshSchedulesSince(before)).toBe(1);
    s.sched.frame();
    expect(s.tokens["writer"]).toBe("B-first");
  });

  it("FIXED reset cancels the stale handle (no leftover pending frame)", () => {
    const s = makeStore({ applyFix: true });
    s.onToken("writer", "A-first");
    s.reset();
    // After reset there must be no queued frame from run A.
    expect(s.sched.pendingCount()).toBe(0);
  });
});

if (!g.it && failures > 0) {
  console.error(`\n${failures} failure(s)`);
  const proc = (globalThis as { process?: { exitCode?: number } }).process;
  if (proc) proc.exitCode = 1;
}
