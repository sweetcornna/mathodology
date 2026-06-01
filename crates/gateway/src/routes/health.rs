use std::time::Duration;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde_json::{json, Value};

use crate::dispatch::ping_redis;
use crate::state::AppState;

#[tracing::instrument(skip_all)]
pub async fn health(State(mut state): State<AppState>) -> (StatusCode, Json<Value>) {
    let redis_ok = ping_redis(&mut state.redis).await;
    let postgres_ok = ping_postgres(&state.pg).await;

    // C7: surface degradation in the HTTP status, not just the body. LB / k8s
    // probes only look at the status code, so a 200-on-degraded gateway keeps
    // receiving traffic even when Redis or Postgres is down.
    let healthy = redis_ok && postgres_ok;
    let status = health_status(healthy);

    (
        status,
        Json(json!({
            "status": if healthy { "ok" } else { "degraded" },
            "version": env!("CARGO_PKG_VERSION"),
            "redis_ok": redis_ok,
            "postgres_ok": postgres_ok,
        })),
    )
}

/// Map the aggregate health to an HTTP status: 200 when every dependency is
/// reachable, 503 otherwise (C7).
fn health_status(healthy: bool) -> StatusCode {
    if healthy {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}

/// `SELECT 1` with a hard 500ms ceiling. Never returns an error; callers only
/// care about true/false.
async fn ping_postgres(pg: &sqlx::PgPool) -> bool {
    let fut = sqlx::query_scalar::<_, i32>("SELECT 1").fetch_one(pg);
    match tokio::time::timeout(Duration::from_millis(500), fut).await {
        Ok(Ok(_)) => true,
        Ok(Err(e)) => {
            tracing::warn!(error = %e, "postgres health probe failed");
            false
        }
        Err(_) => {
            tracing::warn!("postgres health probe timed out");
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn degraded_maps_to_503_and_healthy_to_200() {
        // C7: a degraded gateway must report 503 so LB/k8s probes drain it.
        assert_eq!(health_status(true), StatusCode::OK);
        assert_eq!(health_status(false), StatusCode::SERVICE_UNAVAILABLE);
    }
}
