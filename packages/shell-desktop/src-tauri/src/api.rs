use crate::config::ShellDesktopConfig;
use std::process::Command;

/// Execute a curl request to the shell server and return the response body.
/// Uses `-K` to pass auth header via a temp config file (password never in process list).
pub fn curl_shell(
    cfg: &ShellDesktopConfig,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<String, String> {
    let url = format!("{}{}", cfg.server_url, path);

    // Write auth header to temp config file (O_EXCL + 0600 semantics via tempfile)
    let config_content = format!("header = \"Authorization: Bearer {}\"", cfg.api_key);
    let tmp_dir = std::env::temp_dir();
    let config_path = tmp_dir.join(format!("shell-curl-{}.conf", std::process::id()));
    let config_path_str = config_path.to_string_lossy().to_string();

    // Write with restricted permissions
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&config_path)
            .map_err(|e| format!("Failed to create curl config: {e}"))?;
        std::io::Write::write_all(&mut file, config_content.as_bytes())
            .map_err(|e| format!("Failed to write curl config: {e}"))?;
    }

    #[cfg(not(unix))]
    {
        std::fs::write(&config_path, &config_content)
            .map_err(|e| format!("Failed to write curl config: {e}"))?;
    }

    let result = (|| -> Result<String, String> {
        let mut cmd = Command::new("curl");
        cmd.arg("-s")
            .arg("-X")
            .arg(method)
            .arg("-K")
            .arg(&config_path_str)
            .arg("-H")
            .arg("Content-Type: application/json");

        // TLS verification
        match &cfg.ca_cert_path {
            Some(ca) if !ca.is_empty() => {
                cmd.arg("--cacert").arg(ca);
            }
            _ => {
                cmd.arg("-k"); // insecure fallback for self-signed
            }
        }

        // mTLS client certificate
        if let Some(cert) = &cfg.cert_path {
            if !cert.is_empty() {
                cmd.arg("--cert").arg(cert);
            }
        }
        if let Some(key) = &cfg.key_path {
            if !key.is_empty() {
                cmd.arg("--key").arg(key);
            }
        }

        if let Some(b) = body {
            cmd.arg("-d").arg(b);
        }

        cmd.arg(&url);

        let output = cmd
            .output()
            .map_err(|e| format!("Failed to execute curl: {e}"))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if !output.status.success() {
            return Err(format!(
                "curl failed (exit {}): {}",
                output.status.code().unwrap_or(-1),
                if stderr.is_empty() { &stdout } else { &stderr }
            ));
        }

        Ok(stdout)
    })();

    // Always clean up temp config file
    let _ = std::fs::remove_file(&config_path);

    result
}

/// Parse a JSON response, returning a helpful error if parsing fails.
pub fn parse_response<T: serde::de::DeserializeOwned>(body: &str) -> Result<T, String> {
    serde_json::from_str(body).map_err(|e| {
        // Try to extract an error message from the response
        if let Ok(obj) = serde_json::from_str::<serde_json::Value>(body) {
            if let Some(err) = obj.get("error").and_then(|v| v.as_str()) {
                return format!("Server error: {err}");
            }
        }
        format!("Failed to parse response: {e}\nBody: {body}")
    })
}
