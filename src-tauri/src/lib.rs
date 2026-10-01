mod apps;
mod audio;
mod automation;
mod commands;
mod hid;
mod media;
mod screen;
mod state;
mod store;
mod stream;
mod updates;
mod wallpaper;

use state::AppState;
use store::Gallery;
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let start_hidden = std::env::args().any(|a| a == "--minimized");

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| automation::show_main(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(automation::shortcut_plugin())
        .setup(move |app| {
            let config_dir = app.path().app_config_dir()?;
            let data_dir = app.path().app_data_dir()?;
            let settings_path = config_dir.join("settings.json");
            let gallery_dir = data_dir.join("gallery");
            std::fs::create_dir_all(&gallery_dir)?;
            let settings = store::load_settings(&settings_path);
            let shortcuts = settings.shortcuts_enabled;
            app.manage(AppState::new(settings, settings_path, Gallery { dir: gallery_dir }));
            automation::build_tray(app.handle())?;
            let _ = automation::set_shortcuts(app.handle(), shortcuts);
            if !start_hidden {
                automation::show_main(app.handle());
            }
            automation::start_monitor(app.handle().clone());
            stream::start(app.handle().clone());
            updates::check_on_startup(app.handle().clone());
            if app.state::<AppState>().settings().now_playing_enabled {
                let _ = media::set_enabled(app.handle(), true);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let to_tray = app.state::<AppState>().settings.lock().map(|s| s.minimize_to_tray).unwrap_or(false);
                if to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    app.exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::device_status,
            commands::diagnostics,
            commands::ping,
            commands::sync_time,
            commands::set_lighting,
            commands::apply_profile,
            commands::toggle_lights,
            commands::lights_state,
            commands::set_sleep,
            commands::stream_set,
            commands::stream_status,
            commands::upload,
            commands::gallery_save,
            commands::gallery_list,
            commands::gallery_frames,
            commands::gallery_upload,
            commands::step_screen,
            commands::gallery_current,
            commands::gallery_rename,
            commands::gallery_delete,
            commands::gallery_set_favorite,
            commands::gallery_duplicate,
            commands::gallery_export,
            commands::gallery_import,
            commands::write_file,
            commands::read_file,
            commands::get_settings,
            commands::save_settings,
            commands::run_schedule,
            commands::shortcut_list,
            commands::activity_log,
            commands::activity_clear,
            commands::export_backup,
            commands::import_backup,
            commands::now_playing_set,
            commands::now_playing_get,
            commands::wallpaper_get,
            commands::wallpaper_engine_monitors,
            commands::list_processes,
            commands::active_rule,
            commands::pomodoro_reset,
            commands::update_check,
            commands::update_install,
            commands::app_version,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o AK820 Studio");
}
