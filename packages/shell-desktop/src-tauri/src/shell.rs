use crate::api::{curl_shell, parse_response};
use crate::config::{load_config, save_config, ShellDesktopConfig};
use serde::{Deserialize, Serialize};

// --- Response types matching server ---

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingsResponse {
    pub recordings: Vec<RecordingEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingEntry {
    pub session_id: String,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    pub status: String,
    #[serde(default)]
    pub has_recording: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinTokenResponse {
    pub token: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OkResponse {
    pub ok: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsResponse {
    pub agents: Vec<ShellAgent>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellAgent {
    pub label: String,
    pub revoked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shell_enabled_until: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shell_policy: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellConfig {
    pub enabled: bool,
    pub policies: Vec<ShellPolicy>,
    pub default_policy: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellPolicy {
    pub id: String,
    pub name: String,
    pub description: String,
    pub allowed_ips: Vec<String>,
    pub denied_ips: Vec<String>,
    pub max_file_size: u64,
    pub inactivity_timeout: u64,
    pub command_blocklist: CommandBlocklist,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandBlocklist {
    pub hard_blocked: Vec<String>,
    pub restricted: std::collections::HashMap<String, bool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsResponse {
    pub sessions: Vec<ShellSessionEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellSessionEntry {
    pub id: String,
    pub agent_label: String,
    pub source_ip: String,
    pub status: String,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoliciesResponse {
    pub policies: Vec<ShellPolicy>,
    pub default_policy: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnableResponse {
    pub label: String,
    pub shell_enabled_until: String,
    pub shell_policy: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigUpdateResponse {
    pub ok: bool,
    pub config: ShellConfig,
}

// --- Wrapper types for server responses ---

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PolicyCreateResponse {
    #[allow(dead_code)]
    ok: bool,
    policy: ShellPolicy,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PolicyUpdateResponse {
    #[allow(dead_code)]
    ok: bool,
    policy: ShellPolicy,
}

// --- Validation helpers ---

fn validate_label(label: &str) -> Result<(), String> {
    if label.is_empty() {
        return Err("Label must not be empty".to_string());
    }
    let valid = label
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !valid {
        return Err(format!(
            "Invalid label '{label}': must match [a-z0-9-]+"
        ));
    }
    Ok(())
}

fn validate_session_id(session_id: &str) -> Result<(), String> {
    if session_id.is_empty() {
        return Err("Session ID must not be empty".to_string());
    }
    let valid = session_id
        .chars()
        .all(|c| c.is_ascii_hexdigit() || c == '-');
    if !valid || session_id.len() != 36 {
        return Err(format!(
            "Invalid session ID '{session_id}': must be a UUID"
        ));
    }
    Ok(())
}

// --- Tauri commands ---

#[tauri::command]
pub async fn get_shell_config() -> Result<ShellDesktopConfig, String> {
    tokio::task::spawn_blocking(load_config)
        .await
        .map_err(|e| format!("Task failed: {e}"))
}

#[tauri::command]
pub async fn update_shell_config(config: ShellDesktopConfig) -> Result<(), String> {
    tokio::task::spawn_blocking(move || save_config(&config))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn get_agents() -> Result<AgentsResponse, String> {
    tokio::task::spawn_blocking(|| {
        let cfg = load_config();
        let body = curl_shell(&cfg, "GET", "/api/shell/agents", None)?;
        parse_response::<AgentsResponse>(&body)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn get_server_config() -> Result<ShellConfig, String> {
    tokio::task::spawn_blocking(|| {
        let cfg = load_config();
        let body = curl_shell(&cfg, "GET", "/api/shell/config", None)?;
        parse_response::<ShellConfig>(&body)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn update_server_config(payload: serde_json::Value) -> Result<ShellConfig, String> {
    tokio::task::spawn_blocking(move || {
        let cfg = load_config();
        let body_str = serde_json::to_string(&payload).map_err(|e| format!("JSON error: {e}"))?;
        let body = curl_shell(&cfg, "PATCH", "/api/shell/config", Some(&body_str))?;
        let resp = parse_response::<ConfigUpdateResponse>(&body)?;
        Ok(resp.config)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn get_shell_policies() -> Result<PoliciesResponse, String> {
    tokio::task::spawn_blocking(|| {
        let cfg = load_config();
        let body = curl_shell(&cfg, "GET", "/api/shell/policies", None)?;
        parse_response::<PoliciesResponse>(&body)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn create_shell_policy(payload: serde_json::Value) -> Result<ShellPolicy, String> {
    tokio::task::spawn_blocking(move || {
        let cfg = load_config();
        let body_str = serde_json::to_string(&payload).map_err(|e| format!("JSON error: {e}"))?;
        let body = curl_shell(&cfg, "POST", "/api/shell/policies", Some(&body_str))?;
        let resp = parse_response::<PolicyCreateResponse>(&body)?;
        Ok(resp.policy)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn update_shell_policy(
    policy_id: String,
    payload: serde_json::Value,
) -> Result<ShellPolicy, String> {
    tokio::task::spawn_blocking(move || {
        let cfg = load_config();
        let body_str = serde_json::to_string(&payload).map_err(|e| format!("JSON error: {e}"))?;
        let path = format!("/api/shell/policies/{policy_id}");
        let body = curl_shell(&cfg, "PATCH", &path, Some(&body_str))?;
        let resp = parse_response::<PolicyUpdateResponse>(&body)?;
        Ok(resp.policy)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn delete_shell_policy(policy_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let cfg = load_config();
        let path = format!("/api/shell/policies/{policy_id}");
        let body = curl_shell(&cfg, "DELETE", &path, None)?;
        // DELETE returns { ok: true } or an error
        let val = parse_response::<serde_json::Value>(&body)?;
        if val.get("error").is_some() {
            return Err(format!(
                "Server error: {}",
                val["error"].as_str().unwrap_or("unknown")
            ));
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn enable_agent_shell(
    label: String,
    duration_minutes: u32,
    policy_id: Option<String>,
) -> Result<EnableResponse, String> {
    validate_label(&label)?;
    tokio::task::spawn_blocking(move || {
        let cfg = load_config();
        let mut payload = serde_json::json!({
            "durationMinutes": duration_minutes
        });
        if let Some(pid) = policy_id {
            payload["policyId"] = serde_json::Value::String(pid);
        }
        let body_str = serde_json::to_string(&payload).map_err(|e| format!("JSON error: {e}"))?;
        let path = format!("/api/shell/enable/{label}");
        let body = curl_shell(&cfg, "POST", &path, Some(&body_str))?;
        parse_response::<EnableResponse>(&body)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn disable_agent_shell(label: String) -> Result<(), String> {
    validate_label(&label)?;
    tokio::task::spawn_blocking(move || {
        let cfg = load_config();
        let path = format!("/api/shell/enable/{label}");
        curl_shell(&cfg, "DELETE", &path, None)?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn get_shell_sessions() -> Result<SessionsResponse, String> {
    tokio::task::spawn_blocking(|| {
        let cfg = load_config();
        let body = curl_shell(&cfg, "GET", "/api/shell/sessions", None)?;
        parse_response::<SessionsResponse>(&body)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn check_health() -> Result<HealthResponse, String> {
    tokio::task::spawn_blocking(|| {
        let cfg = load_config();
        let body = curl_shell(&cfg, "GET", "/api/shell/health", None)?;
        parse_response::<HealthResponse>(&body)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn get_recordings(label: String) -> Result<RecordingsResponse, String> {
    validate_label(&label)?;
    tokio::task::spawn_blocking(move || {
        let cfg = load_config();
        let path = format!("/api/shell/recordings/{label}");
        let body = curl_shell(&cfg, "GET", &path, None)?;
        parse_response::<RecordingsResponse>(&body)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn download_recording(
    label: String,
    session_id: String,
) -> Result<String, String> {
    validate_label(&label)?;
    validate_session_id(&session_id)?;
    tokio::task::spawn_blocking(move || {
        let cfg = load_config();
        let path = format!("/api/shell/recordings/{label}/{session_id}");
        curl_shell(&cfg, "GET", &path, None)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn create_join_token(label: String) -> Result<JoinTokenResponse, String> {
    validate_label(&label)?;
    tokio::task::spawn_blocking(move || {
        let cfg = load_config();
        let payload = serde_json::json!({ "label": label });
        let body_str = serde_json::to_string(&payload).map_err(|e| format!("JSON error: {e}"))?;
        let body = curl_shell(&cfg, "POST", "/api/shell/tokens", Some(&body_str))?;
        parse_response::<JoinTokenResponse>(&body)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn terminate_session(session_id: String) -> Result<OkResponse, String> {
    validate_session_id(&session_id)?;
    tokio::task::spawn_blocking(move || {
        let cfg = load_config();
        let path = format!("/api/shell/sessions/{session_id}");
        let body = curl_shell(&cfg, "DELETE", &path, None)?;
        parse_response::<OkResponse>(&body)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
pub async fn revoke_agent(label: String) -> Result<OkResponse, String> {
    validate_label(&label)?;
    tokio::task::spawn_blocking(move || {
        let cfg = load_config();
        let path = format!("/api/shell/agents/{label}/revoke");
        let body = curl_shell(&cfg, "POST", &path, Some("{}"))?;
        parse_response::<OkResponse>(&body)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}
