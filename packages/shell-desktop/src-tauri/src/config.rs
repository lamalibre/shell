use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellDesktopConfig {
    pub server_url: String,
    pub api_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ca_cert_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cert_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_path: Option<String>,
}

fn shell_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".shell"))
}

fn config_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".shell-desktop"))
}

fn config_path() -> Option<PathBuf> {
    config_dir().map(|d| d.join("config.json"))
}

pub fn load_config() -> ShellDesktopConfig {
    // Try loading from config file first
    if let Some(path) = config_path() {
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(config) = serde_json::from_str::<ShellDesktopConfig>(&data) {
                return config;
            }
        }
    }

    // Fall back to reading from ~/.shell directory (standalone server defaults)
    let shell = shell_dir();
    let api_key = shell
        .as_ref()
        .map(|d| d.join("api-key"))
        .and_then(|p| fs::read_to_string(p).ok())
        .unwrap_or_default()
        .trim()
        .to_string();

    let ca_cert_path = shell
        .as_ref()
        .map(|d| d.join("ca.crt"))
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().to_string());

    let cert_path = shell
        .as_ref()
        .map(|d| d.join("client.crt"))
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().to_string());

    let key_path = shell
        .as_ref()
        .map(|d| d.join("client.key"))
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().to_string());

    ShellDesktopConfig {
        server_url: "https://localhost:9494".to_string(),
        api_key,
        ca_cert_path,
        cert_path,
        key_path,
    }
}

pub fn save_config(config: &ShellDesktopConfig) -> Result<(), String> {
    let dir = config_dir().ok_or("Cannot determine config directory")?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config dir: {e}"))?;

    let path = dir.join("config.json");
    let data = serde_json::to_string_pretty(config).map_err(|e| format!("JSON error: {e}"))?;

    // Atomic write: open with 0o600 → write → fsync → rename
    let tmp_path = dir.join("config.json.tmp");

    {
        #[cfg(unix)]
        let mut file = {
            use std::os::unix::fs::OpenOptionsExt;
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&tmp_path)
                .map_err(|e| format!("Failed to create temp config: {e}"))?
        };
        #[cfg(not(unix))]
        let mut file = {
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&tmp_path)
                .map_err(|e| format!("Failed to create temp config: {e}"))?
        };

        file.write_all(data.as_bytes())
            .map_err(|e| format!("Failed to write config: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("Failed to fsync config: {e}"))?;
    }

    fs::rename(&tmp_path, &path).map_err(|e| format!("Failed to rename config: {e}"))?;

    Ok(())
}
