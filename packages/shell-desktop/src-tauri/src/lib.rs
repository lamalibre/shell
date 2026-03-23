mod api;
mod config;
mod shell;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            shell::get_shell_config,
            shell::update_shell_config,
            shell::get_agents,
            shell::get_server_config,
            shell::update_server_config,
            shell::get_shell_policies,
            shell::create_shell_policy,
            shell::update_shell_policy,
            shell::delete_shell_policy,
            shell::enable_agent_shell,
            shell::disable_agent_shell,
            shell::get_shell_sessions,
            shell::check_health,
            shell::get_recordings,
            shell::download_recording,
            shell::create_join_token,
            shell::terminate_session,
            shell::revoke_agent,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
