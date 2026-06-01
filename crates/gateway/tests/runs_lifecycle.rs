//! Integration tests for run lifecycle endpoints, covering audit fixes:
//!   * D10 — orphaned 'queued' row is rolled back when enqueue_job (XADD)
//!           fails after the INSERT.
//!   * D23 — GET /runs/:id paginates events_audit (LIMIT + after_seq cursor).
//!   * C6  — WS upgrade to an unknown run_id returns 404 before upgrade.
//!   * C7  — GET /health returns 503 when a dependency is degraded.
//!
//! Like the sibling integration tests, these rely on a live Redis + Postgres
//! reachable at `TEST_REDIS_URL` / `TEST_DATABASE_URL` (defaults mirror
//! `.env.example`). The gateway's migrations are expected to have already been
//! applied to the test database (tables `runs`, `events_audit`, `cost_ledger`).

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::serve;
use redis::AsyncCommands;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use sqlx::postgres::PgPoolOptions;
use tempfile::NamedTempFile;
use tokio::net::TcpListener;
use uuid::Uuid;

use gateway::app::build_router;
use gateway::config::AppConfig;
use gateway::dispatch::JOBS_STREAM;
use gateway::llm::LlmContext;
use gateway::state::AppState;

const DEV_TOKEN: &str = "test-token-runs-lifecycle";

fn providers_toml() -> NamedTempFile {
    let file = NamedTempFile::new().expect("tempfile");
    let toml = r#"
[[providers]]
name = "mock"
kind = "openai_compat"
base_url = "http://127.0.0.1:1/v1"
api_key_env = ""
models = ["deepseek-chat"]
price_input_per_1m = 1.0
price_output_per_1m = 2.0

[router]
default_model = "deepseek-chat"
fallback = []
"#;
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

async fn boot(state: AppState) -> SocketAddr {
    let router = build_router(state);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = serve(listener, router).await;
    });
    tokio::time::sleep(Duration::from_millis(20)).await;
    addr
}

fn auth_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {DEV_TOKEN}")).unwrap(),
    );
    headers
}

/// D10: when XADD onto `mm:jobs` fails AFTER the INSERT, the run row must be
/// rolled back (deleted) so we don't leak a permanently-'queued' row that no
/// worker consumes.
///
/// We force a deterministic XADD failure by pre-setting `mm:jobs` to a plain
/// string: a subsequent XADD against a non-stream key returns WRONGTYPE.
#[tokio::test]
async fn d10_orphaned_queued_row_rolled_back_on_enqueue_failure() {
    // Unique marker so we count only THIS test's rows (sibling test binaries
    // run against the same DB concurrently and may insert unrelated rows).
    let marker = format!("D10 rollback probe {}", Uuid::new_v4());
    let providers = providers_toml();
    let mut state = build_state(providers.path().to_path_buf()).await;

    // Defensive: clear any leftover poison from a previous crashed run so the
    // SET below establishes the WRONGTYPE condition cleanly.
    let _: () = state.redis.del(JOBS_STREAM).await.unwrap_or(());
    // Force XADD to fail: set mm:jobs to a string (WRONGTYPE on XADD).
    let _: () = state
        .redis
        .set(JOBS_STREAM, "not-a-stream")
        .await
        .expect("poison mm:jobs");

    let addr = boot(state.clone()).await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://{addr}/runs"))
        .headers(auth_headers())
        .json(&serde_json::json!({
            "problem_text": marker,
            "competition_type": "mcm",
        }))
        .send()
        .await
        .expect("send");

    let status = resp.status();
    let body_txt = resp.text().await.unwrap_or_default();

    // Count rows matching THIS test's unique marker. The rollback must have
    // deleted the inserted row, so the count must be zero.
    let leaked: (i64,) = sqlx::query_as("SELECT count(*) FROM runs WHERE problem_text = $1")
        .bind(&marker)
        .fetch_one(&state.pg)
        .await
        .expect("count leaked");

    // Cleanup the poisoned shared key BEFORE any assertion can panic, so a
    // failure here never leaves `mm:jobs` poisoned for sibling tests. Also
    // best-effort delete our marker row if the fix regressed.
    let _: () = state.redis.clone().del(JOBS_STREAM).await.unwrap_or(());
    let _ = sqlx::query("DELETE FROM runs WHERE problem_text = $1")
        .bind(&marker)
        .execute(&state.pg)
        .await;

    // The enqueue failure surfaces as a 5xx (Internal).
    assert!(
        status.is_server_error(),
        "expected 5xx on enqueue failure, got {status}: {body_txt}"
    );
    assert_eq!(
        leaked.0, 0,
        "orphaned 'queued' run row leaked after enqueue failure (count={})",
        leaked.0
    );
}

/// D23: GET /runs/:id must page events. We seed >limit events and assert the
/// default page is bounded, `has_more` is reported, and `after_seq` advances.
#[tokio::test]
async fn d23_get_run_paginates_events() {
    let providers = providers_toml();
    let state = build_state(providers.path().to_path_buf()).await;

    // Seed a run + a handful of audit events directly.
    let run_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO runs (id, problem_text, competition_type, status) VALUES ($1,$2,$3,'done')",
    )
    .bind(run_id)
    .bind("D23 pagination probe")
    .bind("mcm")
    .execute(&state.pg)
    .await
    .expect("insert run");

    let total = 25_i64;
    for seq in 1..=total {
        sqlx::query(
            "INSERT INTO events_audit (run_id, seq, ts, agent, kind, payload) VALUES ($1,$2, now(), $3, $4, $5)",
        )
        .bind(run_id)
        .bind(seq)
        .bind("writer")
        .bind("token")
        .bind(serde_json::json!({"text": format!("t{seq}")}))
        .execute(&state.pg)
        .await
        .expect("insert event");
    }

    let addr = boot(state.clone()).await;
    let client = reqwest::Client::new();

    // First page with limit=10.
    let body: serde_json::Value = client
        .get(format!("http://{addr}/runs/{run_id}?limit=10"))
        .headers(auth_headers())
        .send()
        .await
        .expect("send")
        .json()
        .await
        .expect("json");

    let events = body["events"].as_array().expect("events array");
    assert_eq!(events.len(), 10, "first page is capped at limit");
    assert_eq!(body["has_more"], true, "more events remain");
    let next = body["next_after_seq"].as_i64().expect("next_after_seq");
    assert_eq!(next, 10, "cursor points at the last seq of the page");

    // Second page picks up where the first left off.
    let body2: serde_json::Value = client
        .get(format!(
            "http://{addr}/runs/{run_id}?limit=10&after_seq={next}"
        ))
        .headers(auth_headers())
        .send()
        .await
        .expect("send2")
        .json()
        .await
        .expect("json2");
    let events2 = body2["events"].as_array().expect("events2");
    assert_eq!(events2.len(), 10);
    assert_eq!(events2[0]["seq"], 11, "second page starts after the cursor");
    assert_eq!(body2["has_more"], true);

    // Final page returns the remainder with has_more=false.
    let body3: serde_json::Value = client
        .get(format!("http://{addr}/runs/{run_id}?limit=10&after_seq=20"))
        .headers(auth_headers())
        .send()
        .await
        .expect("send3")
        .json()
        .await
        .expect("json3");
    let events3 = body3["events"].as_array().expect("events3");
    assert_eq!(events3.len(), 5, "remainder is 5 events");
    assert_eq!(body3["has_more"], false);

    // Cleanup (events cascade on run delete via FK).
    let _ = sqlx::query("DELETE FROM runs WHERE id = $1")
        .bind(run_id)
        .execute(&state.pg)
        .await;
}

/// C6: WS upgrade to an unknown run_id must 404 before upgrading. A real
/// WebSocket upgrade attempt against a random UUID should be rejected.
#[tokio::test]
async fn c6_ws_unknown_run_id_returns_404() {
    let providers = providers_toml();
    let state = build_state(providers.path().to_path_buf()).await;
    let addr = boot(state).await;

    let unknown = Uuid::new_v4();
    // Attempt a WS handshake via reqwest with Upgrade headers. axum runs our
    // 404 guard before `on_upgrade`, so the server replies with a normal HTTP
    // 404 instead of switching protocols.
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("http://{addr}/ws/runs/{unknown}"))
        .header(AUTHORIZATION, format!("Bearer {DEV_TOKEN}"))
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
        .send()
        .await
        .expect("send");

    assert_eq!(
        resp.status().as_u16(),
        404,
        "unknown run_id must 404 before WS upgrade"
    );
}

/// C7: /health returns 200 when both deps are up. (Degraded -> 503 is asserted
/// by the unit test in health.rs; here we confirm the happy path still 200s
/// with the new (StatusCode, Json) return type.)
#[tokio::test]
async fn c7_health_ok_returns_200() {
    let providers = providers_toml();
    let state = build_state(providers.path().to_path_buf()).await;
    let addr = boot(state).await;

    let client = reqwest::Client::new();
    let resp = client
        .get(format!("http://{addr}/health"))
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status().as_u16(), 200);
    let body: serde_json::Value = resp.json().await.expect("json");
    assert_eq!(body["status"], "ok");
}

/// D8: an `mm_auth` cookie authenticates GET asset requests (so prod
/// `<img>`/`<a>` loads work without a token in the URL), but must NOT be
/// honoured for mutating POSTs — otherwise it would be a CSRF vector.
#[tokio::test]
async fn d8_cookie_auth_authorizes_get_only() {
    let providers = providers_toml();
    let state = build_state(providers.path().to_path_buf()).await;

    let run_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO runs (id, problem_text, competition_type, status) VALUES ($1,$2,$3,'done')",
    )
    .bind(run_id)
    .bind("D8 cookie auth probe")
    .bind("mcm")
    .execute(&state.pg)
    .await
    .expect("insert run");

    let addr = boot(state.clone()).await;
    let client = reqwest::Client::new();

    // Valid cookie, NO Authorization header -> 200 (the <img>/<a> path).
    let ok = client
        .get(format!("http://{addr}/runs/{run_id}"))
        .header("Cookie", format!("mm_auth={DEV_TOKEN}"))
        .send()
        .await
        .expect("cookie GET");
    let ok_status = ok.status().as_u16();

    // Wrong cookie -> 401.
    let bad = client
        .get(format!("http://{addr}/runs/{run_id}"))
        .header("Cookie", "mm_auth=not-the-token")
        .send()
        .await
        .expect("bad cookie GET");
    let bad_status = bad.status().as_u16();

    // Cookie-only POST must be rejected (CSRF guard): mutations need the header.
    let csrf_marker = format!("D8 csrf probe {}", Uuid::new_v4());
    let csrf = client
        .post(format!("http://{addr}/runs"))
        .header("Cookie", format!("mm_auth={DEV_TOKEN}"))
        .header(CONTENT_TYPE, "application/json")
        .json(&serde_json::json!({"problem_text": csrf_marker, "competition_type": "mcm"}))
        .send()
        .await
        .expect("csrf POST");
    let csrf_status = csrf.status().as_u16();

    // Cleanup before assertions so a failure never leaks rows for siblings.
    let _ = sqlx::query("DELETE FROM runs WHERE id = $1 OR problem_text = $2")
        .bind(run_id)
        .bind(&csrf_marker)
        .execute(&state.pg)
        .await;

    assert_eq!(ok_status, 200, "valid mm_auth cookie authorizes a GET");
    assert_eq!(bad_status, 401, "wrong cookie is rejected");
    assert_eq!(
        csrf_status, 401,
        "cookie must NOT authorize a mutating POST (CSRF guard)"
    );
}
