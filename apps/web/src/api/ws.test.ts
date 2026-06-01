// Repro + regression test for D25 — a non-1000 close arriving *after* a
// terminal `done` must NOT schedule a reconnect, and RunWsClient must expose
// its terminal decision so the store can mirror it authoritatively.
//
// Written in vitest shape (describe/it/expect) and also runnable under bare
// node via the shim at the bottom:
//
//   node --experimental-strip-types --loader <ts-ext-loader> \
//        --import ./src/api/ws.test.ts
//
// ws.ts imports AgentEvent only as a `type`, so it has no runtime dependency
// on @mathodology/contracts under type-stripping.

import { RunWsClient } from "./ws";

// ---- minimal WebSocket stub -----------------------------------------------
// Captures handlers and lets the test drive onmessage/onclose synchronously,
// the way the real server's done-then-close sequence would.
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: ((e: { code: number; reason?: string }) => void) | null = null;
  sent: string[] = [];
  closed = false;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close(code = 1000, reason = "") {
    this.closed = true;
    this.onclose?.({ code, reason });
  }
}

// ---- harness --------------------------------------------------------------
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

// Install the fake globally for the duration of the run.
const realWs = (globalThis as { WebSocket?: unknown }).WebSocket;
(globalThis as { WebSocket?: unknown }).WebSocket =
  FakeWebSocket as unknown as typeof WebSocket;

const ev = (kind: string, seq: number) =>
  JSON.stringify({ run_id: "r1", kind, seq, ts: "2026-01-01T00:00:00Z" });

describe("RunWsClient terminal-after-done close (D25)", () => {
  it("does not reconnect when a non-1000 close follows a done event", () => {
    FakeWebSocket.instances = [];
    let reconnectScheduled = false;
    // Spy on setTimeout to detect a scheduled reconnect.
    const realSetTimeout = globalThis.setTimeout;
    (globalThis as { setTimeout: typeof setTimeout }).setTimeout = (() => {
      reconnectScheduled = true;
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    try {
      const client = new RunWsClient({
        runId: "r1",
        wsBase: "ws://x",
        token: "t",
        handlers: { onEvent: () => {} },
      });
      client.connect();
      const sock = FakeWebSocket.instances[0]!;
      // Server sends terminal `done`, then closes with 1001 (going away).
      sock.onmessage?.({ data: ev("done", 5) });
      expect(client.isTerminal()).toBe(true);
      sock.onclose?.({ code: 1001 });
      // A non-1000 close after done must NOT schedule a reconnect.
      expect(reconnectScheduled).toBe(false);
      // No new socket should have been opened.
      expect(FakeWebSocket.instances.length).toBe(1);
    } finally {
      (globalThis as { setTimeout: typeof setTimeout }).setTimeout =
        realSetTimeout;
    }
  });

  it("still reconnects on a genuine mid-run drop (no done, code 1006)", () => {
    FakeWebSocket.instances = [];
    let reconnectScheduled = false;
    const realSetTimeout = globalThis.setTimeout;
    (globalThis as { setTimeout: typeof setTimeout }).setTimeout = (() => {
      reconnectScheduled = true;
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    try {
      const client = new RunWsClient({
        runId: "r1",
        wsBase: "ws://x",
        token: "t",
        handlers: { onEvent: () => {} },
      });
      client.connect();
      const sock = FakeWebSocket.instances[0]!;
      sock.onmessage?.({ data: ev("stage.start", 1) });
      expect(client.isTerminal()).toBe(false);
      sock.onclose?.({ code: 1006 });
      expect(reconnectScheduled).toBe(true);
    } finally {
      (globalThis as { setTimeout: typeof setTimeout }).setTimeout =
        realSetTimeout;
    }
  });

  it("mirrors the store's reconnect rule: terminal => no reconnect flag", () => {
    // Reproduce the store's onClose decision in isolation against the client's
    // authoritative terminal flag, proving the D25 fix: isTerminal() short-
    // circuits the reconnect flag regardless of close code.
    FakeWebSocket.instances = [];
    const client = new RunWsClient({
      runId: "r1",
      wsBase: "ws://x",
      token: "t",
      handlers: { onEvent: () => {} },
    });
    client.connect();
    const sock = FakeWebSocket.instances[0]!;
    sock.onmessage?.({ data: ev("done", 9) });
    // Store-side decision (copied from stores/run.ts onClose):
    const code: number = 1001;
    const reachedTerminal = client.isTerminal();
    const wsReconnecting = code !== 1000 && !reachedTerminal;
    expect(wsReconnecting).toBe(false);
  });
});

(globalThis as { WebSocket?: unknown }).WebSocket = realWs;

if (!g.it && failures > 0) {
  console.error(`\n${failures} failure(s)`);
  const proc = (globalThis as { process?: { exitCode?: number } }).process;
  if (proc) proc.exitCode = 1;
}
