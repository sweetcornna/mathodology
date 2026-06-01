"""Lifecycle smoke for `run_pipeline` — kernel teardown on failure (D1).

`run_pipeline` constructs a `KernelSession` (started lazily by the Coder /
audit paths) and a `GatewayClient`, and must tear the kernel down in its
`finally` block so a completed or failed run never orphans an ipykernel
subprocess. Pre-D1 the `finally` closed only the gateway.

We patch the heavy collaborators (`GatewayClient`, `KernelSession`,
`MatlabSession`) inside the `pipeline` module and force the very first stage
(`AnalyzerAgent.run_for_problem`) to raise an `AgentError`. The orchestrator
should catch it, emit a terminal `done(failed)`, and STILL await
`kernel.shutdown()` in `finally`. Redis is a minimal AsyncMock — only the
EventEmitter / cost / cancel call surface is exercised before the forced
failure.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from agent_worker import pipeline
from agent_worker.agents.base import AgentError
from mm_contracts import ProblemInput


@pytest.fixture
def fake_redis() -> AsyncMock:
    redis = AsyncMock()
    # Cost / cancel checks read string keys; return benign values so the
    # pre-failure setup doesn't choke.
    redis.get.return_value = None
    redis.incr.return_value = 1
    return redis


async def test_run_pipeline_shuts_down_kernel_on_failure(
    tmp_path: Path,
    fake_redis: AsyncMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run_id = uuid4()
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()
    monkeypatch.setenv("RUNS_DIR", str(runs_dir))
    monkeypatch.setenv("REDIS_URL", "redis://stub")
    monkeypatch.setenv("GATEWAY_HTTP", "http://stub")

    fake_gateway = AsyncMock()
    fake_kernel = AsyncMock()
    fake_matlab = AsyncMock()

    monkeypatch.setattr(pipeline, "GatewayClient", lambda *a, **k: fake_gateway)
    monkeypatch.setattr(pipeline, "KernelSession", lambda *a, **k: fake_kernel)
    monkeypatch.setattr(pipeline, "MatlabSession", lambda *a, **k: fake_matlab)

    # Force the first pipeline stage to blow up so we hit the failure path.
    class _BoomAnalyzer:
        def __init__(self, *_a: object, **_k: object) -> None:
            pass

        async def run_for_problem(self, *_a: object, **_k: object) -> None:
            raise AgentError("simulated analyzer failure")

    monkeypatch.setattr(pipeline, "AnalyzerAgent", _BoomAnalyzer)

    problem = ProblemInput(problem_text="stub", competition_type="mcm")

    # Must not re-raise — AgentError is caught and converted to done(failed).
    await pipeline.run_pipeline(fake_redis, run_id, problem)

    # The whole point of D1: kernel torn down in `finally` despite the failure.
    fake_kernel.shutdown.assert_awaited_once()
    fake_gateway.close.assert_awaited_once()
