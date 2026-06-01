"""Tests for the OpenAlex tool — offline via pytest-httpx."""

from __future__ import annotations

import httpx
import pytest
from agent_worker.tools.openalex import (
    OPENALEX_API_URL,
    _parse_works,
    _reconstruct_inverted_abstract,
    batch_search_openalex,
    search_openalex,
)

_SAMPLE_WORKS = {
    "results": [
        {
            "id": "https://openalex.org/W123456789",
            "doi": "https://doi.org/10.1234/example.2024.001",
            "title": "Adaptive Signal Timing via Reinforcement Learning",
            "publication_date": "2024-03-15",
            "authorships": [
                {"author": {"display_name": "Alice A."}},
                {"author": {"display_name": "Bob B."}},
            ],
            "abstract_inverted_index": {
                "We": [0],
                "propose": [1],
                "an": [2],
                "RL-based": [3],
                "controller.": [4],
            },
        },
        {
            "id": "https://openalex.org/W987654321",
            # No DOI — exercise the openalex.id fallback path.
            "doi": None,
            "title": "Queueing Theory Revisited",
            "publication_date": "2023-09-01",
            "authorships": [{"author": {"display_name": "Carol C."}}],
            "abstract_inverted_index": None,
        },
    ]
}


def test_parse_works_extracts_fields() -> None:
    papers = _parse_works(_SAMPLE_WORKS)
    assert len(papers) == 2

    p0 = papers[0]
    assert p0.title.startswith("Adaptive Signal Timing")
    assert p0.authors == ["Alice A.", "Bob B."]
    assert p0.doi == "10.1234/example.2024.001"
    # DOI is preferred over the openalex.id when present.
    assert p0.url == "https://doi.org/10.1234/example.2024.001"
    assert p0.published == "2024-03-15"
    # Inverted index reconstructed in position order.
    assert p0.abstract == "We propose an RL-based controller."

    p1 = papers[1]
    assert p1.doi is None
    # Falls back to the openalex.id when DOI missing.
    assert p1.url == "https://openalex.org/W987654321"
    assert p1.abstract == ""  # missing index → empty


def test_parse_works_strips_doi_url_prefix() -> None:
    papers = _parse_works(
        {
            "results": [
                {
                    "id": "https://openalex.org/W1",
                    "doi": "https://doi.org/10.1/abc",
                    "title": "T",
                }
            ]
        }
    )
    assert papers[0].doi == "10.1/abc"


def test_parse_works_skips_titleless_entries() -> None:
    """Entries without a title are dropped, not raised on."""
    papers = _parse_works(
        {
            "results": [
                {"id": "https://openalex.org/W1", "title": ""},
                {"id": "https://openalex.org/W2", "title": "Real Title"},
            ]
        }
    )
    assert len(papers) == 1
    assert papers[0].title == "Real Title"


def test_parse_works_empty_or_malformed() -> None:
    assert _parse_works({}) == []
    assert _parse_works({"results": None}) == []
    assert _parse_works({"results": []}) == []


def test_reconstruct_inverted_abstract_handles_missing_index() -> None:
    assert _reconstruct_inverted_abstract(None) == ""
    assert _reconstruct_inverted_abstract({}) == ""
    # Non-int positions are ignored.
    assert _reconstruct_inverted_abstract({"x": ["bad"]}) == ""


def test_reconstruct_inverted_abstract_orders_by_position() -> None:
    idx = {"second": [1], "first": [0], "third": [2]}
    assert _reconstruct_inverted_abstract(idx) == "first second third"


async def test_search_openalex_mocked(httpx_mock) -> None:  # type: ignore[no-untyped-def]
    httpx_mock.add_response(
        url=(
            f"{OPENALEX_API_URL}?search=signal%20timing&per-page=5"
            "&select=id%2Cdoi%2Ctitle%2Cpublication_date%2Cauthorships%2Cabstract_inverted_index"
        ),
        json=_SAMPLE_WORKS,
    )
    papers = await search_openalex("signal timing", max_results=5)
    assert len(papers) == 2
    assert papers[0].doi == "10.1234/example.2024.001"


async def test_search_openalex_passes_mailto(httpx_mock) -> None:  # type: ignore[no-untyped-def]
    """When mailto is supplied it must be forwarded as a query parameter."""
    httpx_mock.add_response(json={"results": []})
    await search_openalex("anything", mailto="bot@example.com")
    request = httpx_mock.get_request()
    assert "mailto=bot%40example.com" in str(request.url)


async def test_search_openalex_swallows_owned_client_errors(httpx_mock, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """When we own the client and the server keeps returning 503, the retry
    budget is exhausted and the final error propagates."""
    async def _no_sleep(_d: float) -> None:
        return None

    monkeypatch.setattr("agent_worker.tools.openalex.asyncio.sleep", _no_sleep)
    # 503 is retried; 1 initial + _MAX_RETRIES attempts all 503 → final raise.
    for _ in range(4):
        httpx_mock.add_response(status_code=503)
    with pytest.raises(httpx.HTTPStatusError):
        await search_openalex("anything")


async def test_search_openalex_retries_on_429_then_succeeds(httpx_mock, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """D20: a transient 429 must be retried, not silently dropped."""
    async def _no_sleep(_d: float) -> None:
        return None

    monkeypatch.setattr("agent_worker.tools.openalex.asyncio.sleep", _no_sleep)
    httpx_mock.add_response(status_code=429)
    httpx_mock.add_response(json=_SAMPLE_WORKS)
    papers = await search_openalex("signal timing", max_results=5)
    assert len(papers) == 2
    # Two HTTP calls: the 429 and the retried 200.
    assert len(httpx_mock.get_requests()) == 2


async def test_search_openalex_retries_on_503_then_succeeds(httpx_mock, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    async def _no_sleep(_d: float) -> None:
        return None

    monkeypatch.setattr("agent_worker.tools.openalex.asyncio.sleep", _no_sleep)
    httpx_mock.add_response(status_code=503)
    httpx_mock.add_response(json=_SAMPLE_WORKS)
    papers = await search_openalex("signal timing")
    assert len(papers) == 2


async def test_search_openalex_does_not_retry_on_400(httpx_mock, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """A 400 is our bug, not transient — must raise immediately, no retry."""
    async def _no_sleep(_d: float) -> None:
        return None

    monkeypatch.setattr("agent_worker.tools.openalex.asyncio.sleep", _no_sleep)
    httpx_mock.add_response(status_code=400)
    with pytest.raises(httpx.HTTPStatusError):
        await search_openalex("anything")
    assert len(httpx_mock.get_requests()) == 1


async def test_batch_search_openalex_skips_failed_queries(httpx_mock, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import httpx as _httpx

    async def _no_sleep(_d: float) -> None:
        return None

    monkeypatch.setattr("agent_worker.tools.openalex.asyncio.sleep", _no_sleep)

    # Route by the distinct `search` query param via a callback so the
    # concurrent retry interleaving stays deterministic regardless of order.
    # q1 succeeds; q2 always 429s (exhausts its retry budget → wrapped to []);
    # q3 returns empty.
    def _router(request: _httpx.Request) -> _httpx.Response:
        search = request.url.params.get("search")
        if search == "q1":
            return _httpx.Response(200, json=_SAMPLE_WORKS)
        if search == "q2":
            return _httpx.Response(429)
        return _httpx.Response(200, json={"results": []})

    httpx_mock.add_callback(_router, is_reusable=True)

    results = await batch_search_openalex(["q1", "q2", "q3"], max_per_query=5)
    assert set(results.keys()) == {"q1", "q2", "q3"}
    # q1 → 2 papers; q2 → [] (retries exhausted, wrapped); q3 → [].
    assert len(results["q1"]) == 2
    assert results["q2"] == []
    assert results["q3"] == []


async def test_batch_search_openalex_empty_queries() -> None:
    assert await batch_search_openalex([]) == {}
