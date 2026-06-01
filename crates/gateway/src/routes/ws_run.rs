use std::time::Duration;

use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use redis::aio::ConnectionManager;
use redis::streams::{StreamReadOptions, StreamReadReply};
use redis::AsyncCommands;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::dispatch::events_stream_key;
use crate::state::AppState;

/// Optional first client frame.
#[derive(Debug, Deserialize)]
struct Hello {
    #[serde(rename = "type")]
    _type: String,
    #[allow(dead_code)]
    run_id: Option<String>,
    last_seq: Option<u64>,
}

#[tracing::instrument(skip_all, fields(%run_id))]
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(run_id): Path<Uuid>,
) -> Result<axum::response::Response, crate::error::AppError> {
    // C6: reject unknown run_ids with a 404 BEFORE upgrading, mirroring
    // cancel_run / finetune_run. Without this, any authenticated client can
    // subscribe to an arbitrary UUID and the handler polls a non-existent
    // stream every ~100ms forever.
    let exists: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM runs WHERE id = $1")
        .bind(run_id)
        .fetch_optional(&state.pg)
        .await
        .map_err(|e| crate::error::AppError::Internal(format!("lookup run: {e}")))?;
    if exists.is_none() {
        return Err(crate::error::AppError::NotFound);
    }

    Ok(ws.on_upgrade(move |socket| async move {
        if let Err(e) = handle_socket(socket, state, run_id).await {
            tracing::warn!(%run_id, error = %e, "ws session ended with error");
        }
    }))
}

async fn handle_socket(mut socket: WebSocket, state: AppState, run_id: Uuid) -> anyhow::Result<()> {
    let stream_key = events_stream_key(&run_id);
    let mut redis = state.redis.clone();

    // --- Optional hello frame with `last_seq` ------------------------------
    //
    // Worker XADDs with `*` (auto-assigned timestamp IDs), so a client-facing
    // `seq` has no direct mapping to a Redis stream ID. We always XREAD from
    // `0-0` and filter forwarded entries by payload.seq > last_seq instead.
    // Redis per-run streams are small (MAXLEN ~5000), so re-scanning is cheap.
    let mut last_seq: u64 = 0;
    tokio::select! {
        maybe_msg = socket.recv() => {
            if let Some(Ok(Message::Text(txt))) = maybe_msg {
                if let Ok(hello) = serde_json::from_str::<Hello>(&txt) {
                    if let Some(s) = hello.last_seq { last_seq = s; }
                }
            }
        }
        _ = tokio::time::sleep(Duration::from_millis(200)) => {}
    }

    let mut last_id = "0-0".to_string();
    tracing::debug!(%run_id, stream_key, last_seq, "ws subscribed to events stream");

    // --- Main loop: XREAD with short block timeout, interleaved with client recv ---
    // block(100) keeps the loop tight so tokens XADDed by the gateway's LLM
    // forwarder land in the browser within ~100ms of emission, instead of
    // being batched in 500ms chunks that make streaming feel stuttery.
    let opts = StreamReadOptions::default().block(100).count(64);

    loop {
        tokio::select! {
            // (a) Redis-side pull.
            read_res = xread_once(&mut redis, &stream_key, &last_id, &opts) => {
                match read_res {
                    Ok(Some(batch)) => {
                        // D5: always advance the cursor past EVERY consumed
                        // entry (incl. payload-less ones), so a malformed XADD
                        // can't pin us in an infinite re-read loop.
                        last_id = batch.max_id;

                        // Decide what to forward + whether the batch contained
                        // a `done` event. Pure logic, unit-tested as `plan_batch`.
                        let plan = plan_batch(&batch.entries, last_seq);

                        // D12: forward the remaining entries in the batch even
                        // after a `done` is seen, then close. Closing the moment
                        // we see `done` would drop trailing tokens that raced
                        // ahead of the worker's done XADD in the same batch.
                        for payload in plan.forward {
                            if socket.send(Message::Text(payload.to_string())).await.is_err() {
                                tracing::debug!(%run_id, "client send failed; closing");
                                return Ok(());
                            }
                        }

                        // Close cleanly once the whole batch has been flushed.
                        if plan.saw_done {
                            tracing::info!(%run_id, "done event forwarded; closing ws");
                            tokio::time::sleep(Duration::from_millis(50)).await;
                            let _ = socket.send(Message::Close(Some(CloseFrame {
                                code: axum::extract::ws::close_code::NORMAL,
                                reason: std::borrow::Cow::Borrowed("run done"),
                            }))).await;
                            return Ok(());
                        }
                    }
                    Ok(None) => {
                        // XREAD timed out with no entries. Loop back and check client too.
                    }
                    Err(e) => {
                        tracing::warn!(%run_id, error = %e, "XREAD error; ending ws");
                        return Ok(());
                    }
                }
            }

            // (b) Client-side recv (disconnect / ping / text we ignore).
            msg = socket.recv() => {
                match msg {
                    None => {
                        tracing::debug!(%run_id, "client closed ws");
                        return Ok(());
                    }
                    Some(Err(e)) => {
                        tracing::debug!(%run_id, error = %e, "client recv error");
                        return Ok(());
                    }
                    Some(Ok(Message::Close(_))) => {
                        tracing::debug!(%run_id, "client sent close frame");
                        return Ok(());
                    }
                    Some(Ok(_)) => {
                        // Ignore further text/binary/ping/pong frames in M1.
                    }
                }
            }
        }
    }
}

/// Result of a single [`xread_once`] call: the forwardable `(entry_id, payload)`
/// pairs plus the maximum stream id consumed in this batch (whether or not it
/// carried a payload).
struct XreadBatch {
    /// Entries with a usable `payload` field, in stream order.
    entries: Vec<(String, String)>,
    /// The highest stream id seen in this batch. The caller MUST advance its
    /// cursor to this even when `entries` is empty (D5): a batch made entirely
    /// of payload-less entries would otherwise leave the cursor unchanged and
    /// the next XREAD would re-fetch the same entries forever.
    max_id: String,
}

/// Single XREAD call. Returns `Ok(None)` if the command blocked and returned
/// no entries (timeout), `Ok(Some(...))` otherwise.
async fn xread_once(
    redis: &mut ConnectionManager,
    stream_key: &str,
    last_id: &str,
    opts: &StreamReadOptions,
) -> redis::RedisResult<Option<XreadBatch>> {
    let reply: Option<StreamReadReply> =
        redis.xread_options(&[stream_key], &[last_id], opts).await?;

    let Some(reply) = reply else {
        return Ok(None);
    };

    let mut entries = Vec::new();
    let mut max_id: Option<String> = None;
    for key in reply.keys {
        for entry in key.ids {
            // Track the cursor over EVERY consumed id, including entries we
            // can't forward (missing/malformed payload). XREAD ids are
            // monotonically increasing within a batch, so the last one is max.
            max_id = Some(entry.id.clone());

            // Events are stored with a single `payload` field holding the JSON string.
            let payload = match entry.map.get("payload") {
                Some(redis::Value::BulkString(bytes)) => {
                    String::from_utf8_lossy(bytes).into_owned()
                }
                Some(redis::Value::SimpleString(s)) => s.clone(),
                _ => continue,
            };
            entries.push((entry.id, payload));
        }
    }

    // An empty reply object (no keys/ids) is treated like a timeout.
    let Some(max_id) = max_id else {
        return Ok(None);
    };
    Ok(Some(XreadBatch { entries, max_id }))
}

/// True if the JSON payload has `"kind":"done"` at the top level.
fn is_done_event(payload: &str) -> bool {
    serde_json::from_str::<Value>(payload)
        .ok()
        .and_then(|v| v.get("kind").and_then(|k| k.as_str()).map(str::to_owned))
        .as_deref()
        == Some("done")
}

/// Extract the `seq` field from a JSON event payload.
fn event_seq(payload: &str) -> Option<u64> {
    serde_json::from_str::<Value>(payload)
        .ok()
        .and_then(|v| v.get("seq").and_then(|s| s.as_u64()))
}

/// Outcome of planning a single XREAD batch: the payloads to forward (in
/// order, with already-seen `seq <= last_seq` entries filtered out) and
/// whether a `done` event appeared anywhere in the batch.
struct BatchPlan<'a> {
    forward: Vec<&'a str>,
    saw_done: bool,
}

/// Decide which batch entries to forward and whether the batch terminates the
/// run. Pure so D5/D12 behavior is unit-testable without a live socket/Redis.
///
/// D12: a `done` does NOT stop forwarding — all subsequent entries in the same
/// batch are still forwarded (a token can race ahead of the worker's `done`
/// XADD and land in the same XREAD batch). The caller closes the socket only
/// after every forwarded entry has been flushed.
fn plan_batch(entries: &[(String, String)], last_seq: u64) -> BatchPlan<'_> {
    let mut forward = Vec::new();
    let mut saw_done = false;
    for (_entry_id, payload) in entries {
        // Skip events already seen by the client.
        if event_seq(payload).is_some_and(|s| s <= last_seq) {
            continue;
        }
        if is_done_event(payload) {
            saw_done = true;
        }
        forward.push(payload.as_str());
    }
    BatchPlan { forward, saw_done }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(seq: u64, kind: &str) -> String {
        serde_json::json!({ "seq": seq, "kind": kind, "payload": {} }).to_string()
    }

    #[test]
    fn plan_batch_forwards_trailing_entries_after_done() {
        // D12 regression: [token_A, done, token_B] must forward all three;
        // closing on `done` would drop token_B.
        let entries = vec![
            ("1-0".into(), ev(1, "token")),
            ("2-0".into(), ev(2, "done")),
            ("3-0".into(), ev(3, "token")),
        ];
        let plan = plan_batch(&entries, 0);
        assert!(plan.saw_done, "done present in batch");
        assert_eq!(plan.forward.len(), 3, "all three entries forwarded");
        // token_B (seq=3) is present.
        assert!(plan.forward.iter().any(|p| p.contains("\"seq\":3")));
    }

    #[test]
    fn plan_batch_filters_already_seen_seq() {
        let entries = vec![
            ("1-0".into(), ev(1, "token")),
            ("2-0".into(), ev(2, "token")),
            ("3-0".into(), ev(3, "token")),
        ];
        // Client already saw seq<=2; only seq=3 should forward.
        let plan = plan_batch(&entries, 2);
        assert!(!plan.saw_done);
        assert_eq!(plan.forward.len(), 1);
        assert!(plan.forward[0].contains("\"seq\":3"));
    }

    #[test]
    fn plan_batch_empty_when_all_seen() {
        let entries = vec![("1-0".into(), ev(1, "token"))];
        let plan = plan_batch(&entries, 5);
        assert!(plan.forward.is_empty());
        assert!(!plan.saw_done);
    }

    // --- D5: cursor advancement past payload-less entries ------------------
    //
    // `xread_once` builds `XreadBatch.max_id` from EVERY consumed entry id, not
    // just the forwardable ones. We can't issue a real XREAD here, but we can
    // verify the parsing/cursor invariant that drives the fix: the max_id must
    // track the highest id even when an entry carries no `payload` field. The
    // helper below mirrors the parse loop in `xread_once`.
    fn parse_ids_and_payloads(
        raw: &[(&str, Option<&str>)],
    ) -> Option<(Vec<(String, String)>, String)> {
        let mut entries = Vec::new();
        let mut max_id: Option<String> = None;
        for (id, payload) in raw {
            max_id = Some((*id).to_string());
            if let Some(p) = payload {
                entries.push(((*id).to_string(), (*p).to_string()));
            }
        }
        max_id.map(|m| (entries, m))
    }

    #[test]
    fn cursor_advances_past_payloadless_entries() {
        // Batch: one payload-less entry followed by one valid entry.
        let valid = ev(6, "token");
        let raw = vec![("5-0", None), ("6-0", Some(valid.as_str()))];
        let (entries, max_id) = parse_ids_and_payloads(&raw).expect("non-empty batch");
        // Only the valid entry is forwardable...
        assert_eq!(entries.len(), 1);
        // ...but the cursor advances past BOTH (to "6-0"), so the next XREAD
        // won't re-fetch the payload-less "5-0" forever.
        assert_eq!(max_id, "6-0");

        // Batch made ENTIRELY of payload-less entries still advances the cursor.
        let raw = vec![("7-0", None), ("8-0", None)];
        let (entries, max_id) = parse_ids_and_payloads(&raw).expect("non-empty batch");
        assert!(entries.is_empty());
        assert_eq!(
            max_id, "8-0",
            "cursor must advance even with zero forwardable entries"
        );
    }
}
