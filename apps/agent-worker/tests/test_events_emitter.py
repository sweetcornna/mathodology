"""Tests for EventEmitter forensic JSONL persistence (D22).

The synchronous file open/write was moved off the event loop (asyncio.to_thread)
with a per-emitter lock to preserve append ordering. These tests assert that
(a) the JSONL file still contains every persisted event, in order, and (b) the
write is dispatched via asyncio.to_thread rather than blocking the loop inline.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock
from uuid import uuid4

import agent_worker.events as events_mod
import orjson
import pytest
from agent_worker.events import EventEmitter


@pytest.fixture
def fake_redis() -> AsyncMock:
    redis = AsyncMock()
    # incr returns a monotonically increasing seq.
    counter = {"n": 0}

    async def _incr(_key: str) -> int:
        counter["n"] += 1
        return counter["n"]

    redis.incr.side_effect = _incr
    return redis


async def test_emit_persists_all_events_in_order(
    tmp_path: Path, fake_redis: AsyncMock
) -> None:
    log_path = tmp_path / "events.jsonl"
    emitter = EventEmitter(fake_redis, uuid4(), events_log_path=log_path)

    # Many concurrent emits of a persisted kind: ordering must be preserved by
    # the per-emitter lock even though each write hops to a worker thread.
    import asyncio

    seqs = list(range(20))
    await asyncio.gather(
        *(
            emitter.emit("log", {"level": "info", "message": f"m{i}"}, agent=None)
            for i in seqs
        )
    )

    lines = log_path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 20
    parsed = [orjson.loads(line) for line in lines]
    # seq is assigned by redis.incr in call order; the persisted lines must be
    # strictly increasing (no interleaving/corruption).
    persisted_seqs = [p["seq"] for p in parsed]
    assert persisted_seqs == sorted(persisted_seqs)
    assert len({p["seq"] for p in parsed}) == 20


async def test_emit_write_is_dispatched_off_loop(
    tmp_path: Path, fake_redis: AsyncMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The forensic write must go through asyncio.to_thread (off the loop),
    not a synchronous open/write inline on the loop thread."""
    log_path = tmp_path / "events.jsonl"
    emitter = EventEmitter(fake_redis, uuid4(), events_log_path=log_path)

    calls: list[str] = []
    real_to_thread = events_mod.asyncio.to_thread

    async def _spy_to_thread(func, *args, **kwargs):  # type: ignore[no-untyped-def]
        calls.append(getattr(func, "__name__", repr(func)))
        return await real_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(events_mod.asyncio, "to_thread", _spy_to_thread)

    await emitter.emit("log", {"level": "info", "message": "hi"}, agent=None)

    assert calls == ["_append_log_line"]
    assert log_path.read_text(encoding="utf-8").strip() != ""


async def test_emit_skips_persistence_for_token_kinds(
    tmp_path: Path, fake_redis: AsyncMock
) -> None:
    """Non-persisted (high-volume token) kinds must NOT touch the JSONL."""
    log_path = tmp_path / "events.jsonl"
    emitter = EventEmitter(fake_redis, uuid4(), events_log_path=log_path)
    await emitter.emit("token", {"text": "x"}, agent="writer")
    assert not log_path.exists()
