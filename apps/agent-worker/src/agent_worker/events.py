"""Event emission helper: wraps XADD to `mm:events:<run_id>`."""

from __future__ import annotations

import asyncio
import contextlib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID

import orjson
from mm_contracts import AgentEvent
from redis.asyncio import Redis

EVENTS_MAXLEN = 5000

# Event kinds persisted to disk for post-mortem. Token events are deliberately
# excluded — they dominate volume (~100k+ per run on long generations) and add
# no forensic value vs the aggregated cost / agent.output events.
_PERSISTED_KINDS: frozenset[str] = frozenset(
    {
        "stage.start",
        "stage.done",
        "agent.output",
        "error",
        "log",
        "cost",
        "done",
        "kernel.figure",
        # Finetune session bookends + tool-call records belong to the
        # forensic log too — they're low-volume (~3-20/turn) and a stream
        # MAXLEN rolloff was previously erasing them past ~5000 events.
        "finetune.session.start",
        "finetune.session.done",
        "finetune.session.error",
        "finetune.tool_call",
        "finetune.tool_result",
    }
)


class EventEmitter:
    """Per-run event emitter.

    Sequence numbers are drawn from the Redis counter `mm:seq:<run_id>` via
    INCR, which is the single source of truth shared with the Rust gateway's
    token/cost fan-out. The in-memory `_seq` attribute caches the last value
    we received for logging only.

    When `events_log_path` is set, non-token events are also appended to a
    JSONL file. Redis stream capping (MAXLEN=5000) drops ~96% of events on
    long generations, so the JSONL is the forensic source of truth; the
    Redis stream is for live WS replay only.
    """

    def __init__(
        self,
        redis: Redis,
        run_id: UUID,
        events_log_path: Path | None = None,
    ) -> None:
        self._redis = redis
        self._run_id = run_id
        self._stream_key = f"mm:events:{run_id}"
        self._seq_key = f"mm:seq:{run_id}"
        self._seq = 0
        self._events_log_path = events_log_path
        # Serializes off-loop forensic writes so concurrent emit() calls keep
        # append ordering even though each write hops to a worker thread.
        self._log_lock = asyncio.Lock()

    @property
    def run_id(self) -> UUID:
        """Public accessor for the run UUID (used by agents to tag LLM calls)."""
        return self._run_id

    async def emit(
        self,
        kind: str,
        payload: dict[str, Any] | None = None,
        agent: str | None = None,
    ) -> bytes | str:
        """Build an AgentEvent and XADD it to the run's stream.

        Returns the stream entry id assigned by Redis.
        """
        self._seq = await self._redis.incr(self._seq_key)
        event = AgentEvent(
            run_id=self._run_id,
            agent=agent,  # type: ignore[arg-type]
            kind=kind,  # type: ignore[arg-type]
            seq=self._seq,
            ts=datetime.now(UTC),
            payload=payload or {},
        )
        dumped = event.model_dump(mode="json")
        body = orjson.dumps(dumped).decode("utf-8")
        # Persist forensic events to disk before the Redis stream MAXLEN
        # rolls them off. The open+write is done off the event loop via
        # asyncio.to_thread so high event volume can't block token streaming
        # / WS fan-out on the loop thread (D22). A per-emitter lock serializes
        # the thread hops so append ordering is preserved. Failures here must
        # NOT block the live stream.
        if self._events_log_path is not None and kind in _PERSISTED_KINDS:
            line = orjson.dumps(dumped) + b"\n"
            async with self._log_lock:
                with contextlib.suppress(OSError):
                    await asyncio.to_thread(self._append_log_line, line)
        return await self._redis.xadd(
            self._stream_key,
            {"payload": body},
            maxlen=EVENTS_MAXLEN,
            approximate=True,
        )

    def _append_log_line(self, line: bytes) -> None:
        """Append one pre-serialized JSONL line. Runs in a worker thread (off
        the event loop) — see emit(). Synchronous file I/O is fine here."""
        assert self._events_log_path is not None
        with self._events_log_path.open("ab") as f:
            f.write(line)
