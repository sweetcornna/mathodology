//! Cost accounting.
//!
//! Formula: `cost_rmb = prompt_tokens/1e6 * price_input + completion_tokens/1e6 * price_output`.
//! Numbers are carried as f64 in-memory and written as text casts to
//! Postgres NUMERIC (same trick as M2's GET /runs/:id) so we don't need the
//! bigdecimal sqlx feature.

use std::io::Write;
use std::path::Path;

use chrono::Utc;
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use serde_json::json;
use uuid::Uuid;

use crate::dispatch::events_stream_key;
use crate::llm::canonical::Usage;
use crate::llm::config::{Price, PriceTable};
use crate::llm::stream::next_seq;

/// Stream MAXLEN for `mm:events:<run_id>`. Matches worker emitter.
const EVENTS_MAXLEN: usize = 5000;

/// Redis key that holds the per-run running cost total in RMB. Mirrors
/// `runs.cost_rmb` in Postgres so consumers (e.g. the Python worker's
/// Critic budget tracker) can query the authoritative running total
/// without a database round-trip. INCRBYFLOAT'd on every chargeable LLM
/// call. Caller is expected to set TTL externally if cleanup is desired;
/// keys are small and bounded by the run lifecycle.
pub fn cost_key(run_id: &Uuid) -> String {
    format!("mm:cost:{run_id}")
}

pub fn compute_cost_rmb(price: Price, usage: &Usage) -> f64 {
    (usage.prompt_tokens as f64 / 1_000_000.0) * price.input_per_1m
        + (usage.completion_tokens as f64 / 1_000_000.0) * price.output_per_1m
}

/// Record a completion against the cost ledger.
///
/// - INSERTs a `cost_ledger` row.
/// - If `run_id` is set: `UPDATE runs SET cost_rmb = cost_rmb + delta` and
///   emits a `kind=cost` event to `mm:events:<run_id>`.
///
/// Returns `delta_rmb` so the caller can log / trace it.
#[allow(clippy::too_many_arguments)]
pub async fn record_completion_cost(
    pg: &sqlx::PgPool,
    redis: &mut ConnectionManager,
    prices: &PriceTable,
    runs_dir: &Path,
    run_id: Option<Uuid>,
    agent: Option<&str>,
    model: &str,
    usage: &Usage,
    cache_hit: bool,
) -> anyhow::Result<f64> {
    let price = prices.get(model).unwrap_or(Price {
        input_per_1m: 0.0,
        output_per_1m: 0.0,
    });
    let delta = if cache_hit {
        0.0
    } else {
        compute_cost_rmb(price, usage)
    };
    let delta_str = format!("{delta:.6}");

    // Ledger insert is only performed when a run_id is present (cost_ledger
    // has a NOT NULL run_id FK). Orphan LLM calls (no X-Run-Id) are counted
    // in tracing only.
    if let Some(rid) = run_id {
        sqlx::query(
            r#"
            INSERT INTO cost_ledger
              (run_id, ts, agent, model, prompt_tokens, completion_tokens, cost_rmb, cache_hit)
            VALUES ($1, now(), $2, $3, $4, $5, $6::numeric, $7)
            "#,
        )
        .bind(rid)
        .bind(agent)
        .bind(model)
        .bind(usage.prompt_tokens as i32)
        .bind(usage.completion_tokens as i32)
        .bind(&delta_str)
        .bind(cache_hit)
        .execute(pg)
        .await?;

        // Bump runs.cost_rmb and read back the new total in one round-trip.
        // Text-cast keeps us free of BigDecimal.
        let row: (String,) = sqlx::query_as(
            r#"
            UPDATE runs
               SET cost_rmb = cost_rmb + $2::numeric,
                   updated_at = now()
             WHERE id = $1
         RETURNING cost_rmb::text
            "#,
        )
        .bind(rid)
        .bind(&delta_str)
        .fetch_one(pg)
        .await?;
        let run_total: f64 = row.0.parse().unwrap_or(0.0);

        // Mirror the running total into Redis so consumers (Critic budget
        // tracker) can read the authoritative value without a Postgres
        // round-trip. We use INCRBYFLOAT with `delta` rather than SET
        // `run_total` so concurrent calls accumulate correctly even if
        // ordered differently with respect to the Postgres UPDATE. A 0.0
        // delta is fine (no-op net) and we still call it so the key
        // exists eagerly for the run.
        let cost_redis_key = cost_key(&rid);
        let _: redis::RedisResult<f64> =
            redis.incr(cost_redis_key, delta).await;

        // XADD kind=cost event to the run stream. Seq from shared counter.
        let seq = next_seq(redis, &rid).await?;
        let payload = json!({
            "run_id": rid,
            "agent": agent,
            "kind": "cost",
            "seq": seq,
            "ts": Utc::now(),
            "payload": {
                "run_total_rmb": run_total,
                "delta_rmb": delta,
                "model": model,
                "prompt_tokens": usage.prompt_tokens,
                "completion_tokens": usage.completion_tokens,
            },
        });
        let payload_str = serde_json::to_string(&payload)?;
        let stream_key = events_stream_key(&rid);
        let _: String = redis
            .xadd_maxlen(
                stream_key,
                redis::streams::StreamMaxlen::Approx(EVENTS_MAXLEN),
                "*",
                &[("payload", payload_str.as_str())],
            )
            .await?;

        // Mirror to <runs_dir>/<run_id>/events.jsonl so the forensic log
        // (and the submission-bundle AI Use Report aggregator) sees every
        // cost event. The worker's EventEmitter only persists events it
        // emits itself; cost events are produced *here*, server-side,
        // and the worker never sees them. Without this, the on-disk
        // jsonl is missing every LLM call — verified across 44 real runs
        // pre-fix (all had 0 cost events on disk despite hundreds of
        // calls in the Redis stream).
        //
        // Best-effort: failures (run dir not yet created, fs full, etc.)
        // log + continue. The Redis stream remains the authoritative
        // live source; this disk mirror is for forensics + submission
        // bundle assembly only.
        let mut jsonl_line = payload_str;
        jsonl_line.push('\n');
        let events_path = runs_dir.join(rid.to_string()).join("events.jsonl");
        let _ = tokio::task::spawn_blocking(move || {
            // O_APPEND + single write() under PIPE_BUF (4 KiB) is
            // atomic against concurrent writers on POSIX — matches the
            // worker's EventEmitter contract.
            match std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&events_path)
            {
                Ok(mut f) => {
                    if let Err(e) = f.write_all(jsonl_line.as_bytes()) {
                        tracing::warn!(
                            error = %e,
                            path = %events_path.display(),
                            "cost event events.jsonl append failed"
                        );
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    // Run dir doesn't exist yet (orphan LLM call before
                    // run row created) — silent skip, this branch is
                    // already gated on run_id presence above.
                }
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        path = %events_path.display(),
                        "cost event events.jsonl open failed"
                    );
                }
            }
        })
        .await;
    }

    Ok(delta)
}
