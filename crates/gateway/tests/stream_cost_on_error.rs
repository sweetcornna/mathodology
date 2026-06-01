//! D11 integration test: when an upstream SSE stream ends with an ERROR after
//! some tokens were billed, the gateway must still finalize cost (write a
//! `cost_ledger` row + bump `mm:cost`). Before the fix the Err branch set
//! `done_sent` and bypassed cost finalization entirely, silently dropping the
//! partial usage the provider already billed for.
//!
//! Strategy: a wiremock OpenAI-compatible server emits one valid `data:` chunk
//! carrying `usage`, followed by a MALFORMED `data:` frame (invalid JSON, no
//! `[DONE]`). The openai_compat adapter turns the malformed frame into a
//! `ProviderError::Parse`, which drives `build_forward_stream` into its Err
//! branch. We POST with a real `X-Run-Id` and assert a cost_ledger row exists.
//!
//! Relies on live Redis + Postgres at the dev defaults (migrations applied).

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::serve;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use sqlx::postgres::PgPoolOptions;
use tempfile::NamedTempFile;
use tokio::net::TcpListener;
use tokio::time::timeout;
use uuid::Uuid;
use wiremock::matchers::{method, path as wm_path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use gateway::app::build_router;
use gateway::config::AppConfig;
use gateway::llm::LlmContext;
use gateway::state::AppState;

const DEV_TOKEN: &str = "test-token-stream-cost";

/// One valid content+usage chunk, then a malformed frame (no `[DONE]`).
fn partial_then_error_body() -> String {
    let valid = r#"{"id":"c1","model":"deepseek-chat","choices":[{"index":0,"delta":{"content":"Hel"}}],"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}}"#;
    let mut body = String::new();
    body.push_str("data: ");
    body.push_str(valid);
    body.push_str("\n\n");
    // Malformed JSON in a data frame -> ProviderError::Parse mid-stream.
    body.push_str("data: {not valid json at all\n\n");
    body
}

async fn write_providers_toml(mock_url: &str) -> NamedTempFile {
    let file = NamedTempFile::new().expect("tempfile");
    let toml = format!(
        r#"
[[providers]]
name = "mock"
kind = "openai_compat"
base_url = "{mock_url}/v1"
api_key_env = ""
models = ["deepseek-chat"]
price_input_per_1m = 3.0
price_output_per_1m = 6.0

[router]
default_model = "deepseek-chat"
fallback = []
"#
    );
    std::fs::write(file.path(), toml).expect("write providers.toml");
    file
}

async fn build_state(providers_path: PathBuf) -> AppState {
    let redis_url =
        std::env::var("TEST_REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379/0".into());
    let database_url = std::env::var("TEST_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://mm:mm@127.0.0.1:5432/mm".into());

    let client = redis::Client::open(redis_url.clone()).expect("redis client");
    let redis = redis::aio::ConnectionManager::new(client)
        .await
        .expect("redis connect");

    let pg = PgPoolOptions::new()
        .max_connections(4)
        .acquire_timeout(Duration::from_secs(3))
        .connect(&database_url)
        .await
        .expect("postgres connect");

    let runs_tmp = tempfile::tempdir().expect("runs tempdir");
    let runs_dir = tokio::fs::canonicalize(runs_tmp.path())
        .await
        .expect("canonicalize runs tempdir");
    std::mem::forget(runs_tmp);

    let cfg = AppConfig {
        host: "127.0.0.1".into(),
        port: 0,
        dev_auth_token: DEV_TOKEN.into(),
        redis_url,
        database_url,
        providers_path: providers_path.clone(),
        runs_dir: runs_dir.clone(),
        static_dir: None,
    };
    let llm = LlmContext::bootstrap(&providers_path).expect("LlmContext::bootstrap");

    AppState {
        redis,
        pg,
        config: Arc::new(cfg),
        llm,
        runs_dir: Arc::new(runs_dir),
    }
}

#[tokio::test]
async fn d11_partial_usage_recorded_when_stream_errors() {
    // --- Mock upstream: valid usage chunk, then a malformed frame. -------
    let mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(wm_path("/v1/chat/completions"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_raw(partial_then_error_body(), "text/event-stream"),
        )
        .mount(&mock)
        .await;

    let providers = write_providers_toml(&mock.uri()).await;
    let state = build_state(providers.path().to_path_buf()).await;

    // Seed a real run row so the cost_ledger FK is satisfied.
    let run_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO runs (id, problem_text, competition_type, status) VALUES ($1,$2,$3,'running')",
    )
    .bind(run_id)
    .bind("D11 partial-usage probe")
    .bind("mcm")
    .execute(&state.pg)
    .await
    .expect("insert run");

    let router = build_router(state.clone());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let _ = serve(listener, router).await;
    });
    tokio::time::sleep(Duration::from_millis(20)).await;

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {DEV_TOKEN}")).unwrap(),
    );
    headers.insert(
        "x-run-id",
        HeaderValue::from_str(&run_id.to_string()).unwrap(),
    );
    headers.insert("x-agent", HeaderValue::from_static("writer"));

    let client = reqwest::Client::new();
    let resp = timeout(
        Duration::from_secs(10),
        client
            .post(format!("http://{addr}/llm/chat/completions"))
            .headers(headers)
            .json(&serde_json::json!({
                "model": "deepseek-chat",
                "messages": [{"role": "user", "content": "hi"}],
                "stream": true,
            }))
            .send(),
    )
    .await
    .expect("no timeout")
    .expect("sent");

    assert_eq!(resp.status(), 200, "SSE endpoint returns 200");
    // Drain the body so the stream (and its cost finalization) runs to completion.
    let body = timeout(Duration::from_secs(10), resp.bytes())
        .await
        .expect("body")
        .expect("body bytes");
    let body_text = String::from_utf8_lossy(&body);
    assert!(
        body_text.contains("event: error") || body_text.contains("\"error\""),
        "expected an error event in the SSE body: {body_text}"
    );

    // Give the (awaited-inline) finalization a beat to commit, then assert a
    // cost_ledger row exists for this run with the partial usage.
    let mut found: Option<(i32, i32)> = None;
    for _ in 0..20 {
        let row: Option<(i32, i32)> = sqlx::query_as(
            "SELECT prompt_tokens, completion_tokens FROM cost_ledger WHERE run_id = $1 ORDER BY ts DESC LIMIT 1",
        )
        .bind(run_id)
        .fetch_optional(&state.pg)
        .await
        .expect("query cost_ledger");
        if row.is_some() {
            found = row;
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    // Cleanup before asserting (cost_ledger cascades on run delete).
    let _ = sqlx::query("DELETE FROM runs WHERE id = $1")
        .bind(run_id)
        .execute(&state.pg)
        .await;
    server.abort();

    let (pt, ct) =
        found.expect("cost_ledger row must exist for partial usage after a stream error");
    assert_eq!(pt, 11, "prompt_tokens from the partial usage chunk");
    assert_eq!(ct, 7, "completion_tokens from the partial usage chunk");
}
