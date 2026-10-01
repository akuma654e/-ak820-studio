//! Monitor de conexão, sincronização automática, agendador, rotação de telas,
//! atalhos globais e menu da bandeja.

use crate::state::{self, notify, AppState};
use chrono::{Datelike, Local, Timelike};
use std::thread;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Executa em segundo plano e mostra o resultado como aviso.
pub fn spawn_action(app: &AppHandle, f: impl FnOnce(&AppHandle) -> Result<String, String> + Send + 'static) {
    let app = app.clone();
    thread::spawn(move || match f(&app) {
        Ok(msg) => notify(&app, "ok", msg),
        Err(e) => notify(&app, "error", e),
    });
}

// ------------------------------------------------------------------ agendador

pub fn run_schedule(app: &AppHandle, action: &str, target: Option<&str>) -> Result<String, String> {
    let state = app.state::<AppState>();
    match action {
        "screen" => {
            let id = target.ok_or("nenhuma tela escolhida")?;
            state::upload_item(app, id).map(|n| format!("Agendador: tela “{n}” enviada"))
        }
        "profile" => {
            let id = target.ok_or("nenhum perfil escolhido")?;
            state::apply_profile(app, id).map(|n| format!("Agendador: perfil “{n}” aplicado"))
        }
        "lightsOff" => state::lights_off(app).map(|_| "Agendador: luzes apagadas".into()),
        "lightsOn" => state::lights_on(app).map(|_| "Agendador: luzes acesas".into()),
        "sync" => state::sync_clock(app).map(|t| format!("Agendador: relógio sincronizado ({t})")),
        "rotationOn" | "rotationOff" => {
            let on = action == "rotationOn";
            state.update_settings(|s| s.rotation.enabled = on)?;
            *state.rotation_last.lock().unwrap() = Some(Instant::now());
            let _ = app.emit("settings-changed", ());
            Ok(format!("Agendador: rotação de telas {}", if on { "ligada" } else { "desligada" }))
        }
        other => Err(format!("ação desconhecida: {other}")),
    }
}

fn check_schedules(app: &AppHandle, last_key: &mut String) {
    let n = Local::now();
    let key = n.format("%Y-%m-%d %H:%M").to_string();
    if *last_key == key {
        return;
    }
    let first_run = last_key.is_empty();
    *last_key = key;
    if first_run {
        return; // não dispara ao abrir o app no meio de um minuto agendado
    }
    let hhmm = format!("{:02}:{:02}", n.hour(), n.minute());
    let day = n.weekday().num_days_from_sunday() as u8;
    let due: Vec<_> = app
        .state::<AppState>()
        .settings()
        .schedules
        .into_iter()
        .filter(|s| s.enabled && s.time == hhmm && s.days.contains(&day))
        .collect();
    for s in due {
        let app2 = app.clone();
        spawn_action(&app2, move |app| run_schedule(app, &s.action, s.target.as_deref()));
    }
}

// ------------------------------------------------------------------ monitor

pub fn start_monitor(app: AppHandle) {
    thread::spawn(move || {
        let mut last_sync: Option<Instant> = None;
        let mut minute_key = String::new();
        let mut watcher = crate::apps::Watcher::new();
        let mut tick: u64 = 0;
        let mut wall_stamp: (String, u64) = (String::new(), 0);
        loop {
            tick += 1;
            thread::sleep(Duration::from_millis(1500));
            let state = app.state::<AppState>();
            let status = {
                let _op = state.op.lock().unwrap();
                state::status_now(&state)
            };
            let prev = state.last_status.lock().unwrap().replace(status.clone());
            let changed = prev.as_ref() != Some(&status);
            if changed {
                let _ = app.emit("device-status", status.clone());
            }
            let online = status.state == "connected" || status.state == "partial";
            if !online {
                continue;
            }
            let settings = state.settings();
            let was_online = prev.map(|p| p.state == "connected" || p.state == "partial").unwrap_or(false);

            if !was_online && settings.auto_sync_on_connect {
                thread::sleep(Duration::from_millis(1200));
                match state::sync_clock(&app) {
                    Ok(t) => notify(&app, "ok", format!("Relógio sincronizado ao conectar ({t})")),
                    Err(e) => notify(&app, "error", format!("Falha ao sincronizar relógio: {e}")),
                }
                last_sync = Some(Instant::now());
                if settings.stream_autostart && state.stream.lock().unwrap().is_none() {
                    if let Some(cfg) = settings.stream.clone() {
                        state::set_stream(&app, Some(cfg));
                    }
                }
            } else if settings.sync_interval_min > 0 {
                let due = last_sync
                    .map(|t| t.elapsed() >= Duration::from_secs(settings.sync_interval_min as u64 * 60))
                    .unwrap_or(true);
                if due {
                    match state::sync_clock(&app) {
                        Ok(t) => state::log(&app, "ok", format!("Relógio sincronizado automaticamente ({t})")),
                        Err(e) => state::log(&app, "error", format!("Falha ao sincronizar relógio: {e}")),
                    }
                    last_sync = Some(Instant::now());
                }
            }

            check_schedules(&app, &mut minute_key);

            // Perfis por aplicativo (a cada ~3 s)
            if tick % 2 == 0 {
                crate::apps::tick(&app, &mut watcher);
            }

            // Troca de wallpaper (a cada ~9 s)
            if tick % 6 == 0 && settings.wallpaper_watch != "off" {
                let src = settings.wallpaper_watch.clone();
                let monitor = settings.ui.pointer("/wallpaper/monitor").and_then(|v| v.as_str()).map(str::to_string);
                let stamp = crate::wallpaper::stamp(&src, monitor.as_deref());
                if wall_stamp.0 == src && stamp != 0 && stamp != wall_stamp.1 {
                    let _ = app.emit("wallpaper-changed", src.clone());
                    state::log(&app, "info", "Wallpaper alterado");
                }
                wall_stamp = (src, stamp);
            }

            // Rotação de telas
            let rot = settings.rotation.clone();
            if rot.enabled {
                let interval = Duration::from_secs(rot.interval_min.max(5) as u64 * 60);
                let mut last = state.rotation_last.lock().unwrap();
                let due = last.map(|t| t.elapsed() >= interval).unwrap_or(false);
                if last.is_none() {
                    *last = Some(Instant::now());
                }
                if due {
                    *last = Some(Instant::now());
                    drop(last);
                    match state::step_screen(&app, 1, &rot.source, rot.shuffle) {
                        Ok(n) => state::log(&app, "ok", format!("Rotação: tela “{n}” enviada")),
                        Err(e) => state::log(&app, "error", format!("Rotação: {e}")),
                    }
                }
            }
        }
    });
}

// ------------------------------------------------------------------ atalhos

pub const SHORTCUTS: &[(&str, &str)] = &[
    ("Ctrl+Alt+→", "Próxima tela da galeria"),
    ("Ctrl+Alt+←", "Tela anterior"),
    ("Ctrl+Alt+L", "Liga/desliga as luzes"),
    ("Ctrl+Alt+P", "Liga/desliga o RGB do PC"),
    ("Ctrl+Alt+T", "Sincroniza o relógio"),
    ("Ctrl+Alt+1…5", "Aplica o perfil de luz 1 a 5"),
];

fn shortcut_list() -> Vec<Shortcut> {
    let m = Some(Modifiers::CONTROL | Modifiers::ALT);
    let mut v = vec![
        Shortcut::new(m, Code::ArrowRight),
        Shortcut::new(m, Code::ArrowLeft),
        Shortcut::new(m, Code::KeyL),
        Shortcut::new(m, Code::KeyP),
        Shortcut::new(m, Code::KeyT),
    ];
    for c in [Code::Digit1, Code::Digit2, Code::Digit3, Code::Digit4, Code::Digit5] {
        v.push(Shortcut::new(m, c));
    }
    v
}

pub fn shortcut_plugin() -> tauri::plugin::TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let code = shortcut.key;
            let rot = app.state::<AppState>().settings().rotation;
            match code {
                Code::ArrowRight => spawn_action(app, move |a| state::step_screen(a, 1, &rot.source, false).map(|n| format!("Tela “{n}” enviada"))),
                Code::ArrowLeft => spawn_action(app, move |a| state::step_screen(a, -1, &rot.source, false).map(|n| format!("Tela “{n}” enviada"))),
                Code::KeyL => spawn_action(app, |a| state::toggle_lights(a).map(|off| if off { "Luzes apagadas".into() } else { "Luzes acesas".into() })),
                Code::KeyT => spawn_action(app, |a| state::sync_clock(a).map(|t| format!("Relógio sincronizado ({t})"))),
                Code::KeyP => {
                    let st = app.state::<AppState>();
                    let active = st.stream.lock().unwrap().is_some();
                    if active {
                        state::set_stream(app, None);
                        notify(app, "info", "RGB do PC desligado");
                    } else if let Some(cfg) = st.settings().stream {
                        state::set_stream(app, Some(cfg));
                        notify(app, "info", "RGB do PC ligado");
                    } else {
                        notify(app, "error", "Configure o RGB do PC na aba Iluminação primeiro");
                    }
                }
                c => {
                    let idx = [Code::Digit1, Code::Digit2, Code::Digit3, Code::Digit4, Code::Digit5].iter().position(|d| *d == c);
                    if let Some(i) = idx {
                        spawn_action(app, move |a| state::apply_profile_index(a, i).map(|n| format!("Perfil “{n}” aplicado")));
                    }
                }
            }
        })
        .build()
}

pub fn set_shortcuts(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if enabled {
        let mut failed = 0;
        for s in shortcut_list() {
            if gs.register(s).is_err() {
                failed += 1;
            }
        }
        if failed > 0 {
            state::log(app, "error", format!("{failed} atalho(s) já estão em uso por outro programa"));
        }
    }
    Ok(())
}

// ------------------------------------------------------------------ bandeja

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn tray_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let state = app.state::<AppState>();
    let open = MenuItem::with_id(app, "open", "Abrir AK820 Studio", true, None::<&str>)?;

    let items = state.gallery.list();
    let mut favs: Vec<_> = items.iter().filter(|i| i.favorite).collect();
    if favs.is_empty() {
        favs = items.iter().take(10).collect();
    }
    let screens = Submenu::with_id(app, "screens", "Trocar tela", !favs.is_empty())?;
    for i in favs.iter().take(15) {
        screens.append(&MenuItem::with_id(app, format!("screen:{}", i.id), &i.name, true, None::<&str>)?)?;
    }
    let next = MenuItem::with_id(app, "next", "Próxima tela", !items.is_empty(), None::<&str>)?;

    let profiles = state.settings().profiles;
    let prof = Submenu::with_id(app, "profiles", "Perfis de luz", !profiles.is_empty())?;
    for p in profiles.iter().take(20) {
        prof.append(&MenuItem::with_id(app, format!("profile:{}", p.id), &p.name, true, None::<&str>)?)?;
    }
    let lights = MenuItem::with_id(app, "lights", "Ligar/desligar luzes", true, None::<&str>)?;
    let stream = MenuItem::with_id(app, "stream", "Ligar/desligar RGB do PC", true, None::<&str>)?;
    let sync = MenuItem::with_id(app, "sync", "Sincronizar relógio agora", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    Menu::with_items(
        app,
        &[
            &open,
            &PredefinedMenuItem::separator(app)?,
            &screens,
            &next,
            &prof,
            &lights,
            &stream,
            &sync,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )
}

pub fn refresh_tray(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id("main"), tray_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = tray_menu(app)?;
    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().expect("ícone"))
        .tooltip("AK820 Studio")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id = event.id.as_ref().to_string();
            let rot = app.state::<AppState>().settings().rotation;
            match id.as_str() {
                "open" => show_main(app),
                "quit" => app.exit(0),
                "sync" => spawn_action(app, |a| state::sync_clock(a).map(|t| format!("Relógio sincronizado ({t})"))),
                "lights" => spawn_action(app, |a| state::toggle_lights(a).map(|off| if off { "Luzes apagadas".into() } else { "Luzes acesas".into() })),
                "next" => spawn_action(app, move |a| state::step_screen(a, 1, &rot.source, false).map(|n| format!("Tela “{n}” enviada"))),
                "stream" => {
                    let st = app.state::<AppState>();
                    let active = st.stream.lock().unwrap().is_some();
                    let cfg = if active { None } else { st.settings().stream };
                    if !active && cfg.is_none() {
                        notify(app, "error", "Configure o RGB do PC na aba Iluminação primeiro");
                    } else {
                        state::set_stream(app, cfg);
                    }
                }
                other => {
                    if let Some(sid) = other.strip_prefix("screen:") {
                        let sid = sid.to_string();
                        spawn_action(app, move |a| state::upload_item(a, &sid).map(|n| format!("Tela “{n}” enviada")));
                    } else if let Some(pid) = other.strip_prefix("profile:") {
                        let pid = pid.to_string();
                        spawn_action(app, move |a| state::apply_profile(a, &pid).map(|n| format!("Perfil “{n}” aplicado")));
                    }
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
