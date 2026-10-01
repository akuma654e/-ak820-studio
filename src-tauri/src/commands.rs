//! Comandos chamados pela interface.

use crate::automation;
use crate::hid::{self, DeviceStatus, InterfaceInfo};
use crate::state::{self, AppState, LogEntry};
use crate::store::{self, GalleryItem, LightingDto, Settings, StreamConfig};
use ak820_core::ops;
use serde::{Deserialize, Serialize};
use std::time::Instant;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;

type R<T> = Result<T, String>;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> R<T> + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// Corpo binário: [u32 LE tamanho do JSON][JSON][dados]
fn split_body<'a, T: for<'de> Deserialize<'de>>(request: &'a Request<'_>) -> R<(T, &'a [u8])> {
    let InvokeBody::Raw(body) = request.body() else {
        return Err("corpo da requisição deve ser binário".into());
    };
    if body.len() < 4 {
        return Err("corpo vazio".into());
    }
    let len = u32::from_le_bytes([body[0], body[1], body[2], body[3]]) as usize;
    if body.len() < 4 + len {
        return Err("corpo truncado".into());
    }
    let meta = serde_json::from_slice(&body[4..4 + len]).map_err(|e| format!("metadados inválidos: {e}"))?;
    Ok((meta, &body[4 + len..]))
}

fn tray_changed(app: &AppHandle) {
    automation::refresh_tray(app);
}

// ------------------------------------------------------------------ teclado

#[tauri::command]
pub fn device_status(state: State<AppState>) -> R<DeviceStatus> {
    state.with_api(|api| hid::status(api))
}

#[tauri::command]
pub fn diagnostics(state: State<AppState>) -> R<Vec<InterfaceInfo>> {
    state.with_api(|api| hid::diagnostics(api))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResult {
    ms: u64,
    image_interface: bool,
}

/// Testa a comunicação abrindo as interfaces e fazendo uma leitura de handshake.
#[tauri::command]
pub async fn ping(app: AppHandle) -> R<PingResult> {
    blocking(move || {
        let st = app.state::<AppState>();
        let t0 = Instant::now();
        let image = st.run(true, |_| Ok(())).is_ok();
        st.run(false, |t| {
            use ak820_core::ops::Transport;
            t.get_feature().map_err(|e| format!("o teclado não respondeu: {e}"))
        })?;
        let r = PingResult { ms: t0.elapsed().as_millis() as u64, image_interface: image };
        state::log(&app, "ok", format!("Teste de comunicação: {} ms", r.ms));
        Ok(r)
    })
    .await
}

#[tauri::command]
pub async fn sync_time(app: AppHandle) -> R<String> {
    blocking(move || {
        let r = state::sync_clock(&app);
        match &r {
            Ok(t) => state::log(&app, "ok", format!("Relógio sincronizado ({t})")),
            Err(e) => state::log(&app, "error", format!("Falha ao sincronizar: {e}")),
        }
        r
    })
    .await
}

#[tauri::command]
pub async fn set_lighting(app: AppHandle, lighting: LightingDto) -> R<()> {
    blocking(move || {
        state::set_stream(&app, None);
        let r = state::apply_lighting(&app, &lighting, true);
        if let Err(e) = &r {
            state::log(&app, "error", format!("Falha ao aplicar iluminação: {e}"));
        }
        r
    })
    .await
}

#[tauri::command]
pub async fn apply_profile(app: AppHandle, id: String) -> R<String> {
    blocking(move || {
        let r = state::apply_profile(&app, &id);
        match &r {
            Ok(n) => state::log(&app, "ok", format!("Perfil “{n}” aplicado")),
            Err(e) => state::log(&app, "error", e.clone()),
        }
        r
    })
    .await
}

#[tauri::command]
pub async fn toggle_lights(app: AppHandle) -> R<bool> {
    blocking(move || state::toggle_lights(&app)).await
}

#[tauri::command]
pub fn lights_state(state: State<AppState>) -> bool {
    *state.lights_off.lock().unwrap()
}

#[tauri::command]
pub async fn set_sleep(app: AppHandle, value: u8) -> R<()> {
    blocking(move || {
        let st = app.state::<AppState>();
        st.run(false, |t| ops::set_sleep(t, value))?;
        st.update_settings(|s| s.sleep = Some(value))?;
        state::log(&app, "ok", "Tempo de suspensão das luzes alterado");
        Ok(())
    })
    .await
}

// ------------------------------------------------------------------ RGB do PC

#[tauri::command]
pub fn stream_set(app: AppHandle, state: State<AppState>, config: Option<StreamConfig>) -> R<()> {
    if let Some(cfg) = &config {
        state.update_settings(|s| {
            s.stream = Some(cfg.clone());
            if cfg.mode == "paint" {
                s.keymap = Some(cfg.colors.clone());
            }
        })?;
    }
    let was = state.stream.lock().unwrap().is_some();
    state::set_stream(&app, config.clone());
    if was != config.is_some() {
        state::log(&app, "info", if config.is_some() { "RGB do PC ligado" } else { "RGB do PC desligado" });
    }
    Ok(())
}

#[tauri::command]
pub fn stream_status(state: State<AppState>) -> Option<StreamConfig> {
    state.stream.lock().unwrap().clone()
}

// ------------------------------------------------------------------ tela e galeria

#[derive(Deserialize)]
struct UploadMeta {
    delays: Vec<u32>,
}

#[tauri::command]
pub async fn upload(app: AppHandle, request: Request<'_>) -> R<()> {
    let (meta, frames): (UploadMeta, &[u8]) = split_body(&request)?;
    let frames = frames.to_vec();
    blocking(move || {
        let r = state::do_upload(&app, &frames, &meta.delays);
        match &r {
            Ok(()) => state::log(&app, "ok", format!("Imagem enviada ({} quadros)", frames.len() / ak820_core::image::FRAME_BYTES)),
            Err(e) => state::log(&app, "error", format!("Falha no envio: {e}")),
        }
        r
    })
    .await
}

#[derive(Deserialize)]
struct SaveMeta {
    name: String,
    delays: Vec<u32>,
    thumb: String,
}

#[tauri::command]
pub fn gallery_save(app: AppHandle, state: State<AppState>, request: Request<'_>) -> R<GalleryItem> {
    let (meta, frames): (SaveMeta, &[u8]) = split_body(&request)?;
    let item = state.gallery.save(meta.name, meta.delays, meta.thumb, frames)?;
    tray_changed(&app);
    Ok(item)
}

#[tauri::command]
pub fn gallery_list(state: State<AppState>) -> Vec<GalleryItem> {
    state.gallery.list()
}

#[tauri::command]
pub fn gallery_frames(state: State<AppState>, id: String) -> R<Response> {
    let (_, frames) = state.gallery.get(&id)?;
    Ok(Response::new(frames))
}

#[tauri::command]
pub async fn gallery_upload(app: AppHandle, id: String) -> R<()> {
    blocking(move || {
        let r = state::upload_item(&app, &id);
        match &r {
            Ok(n) => state::log(&app, "ok", format!("Tela “{n}” enviada")),
            Err(e) => state::log(&app, "error", format!("Falha no envio: {e}")),
        }
        r.map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn step_screen(app: AppHandle, step: i32) -> R<String> {
    blocking(move || {
        let src = app.state::<AppState>().settings().rotation.source;
        let r = state::step_screen(&app, step, &src, false);
        if let Ok(n) = &r {
            state::log(&app, "ok", format!("Tela “{n}” enviada"));
        }
        r
    })
    .await
}

#[tauri::command]
pub fn gallery_current(state: State<AppState>) -> Option<String> {
    state.gallery_cursor.lock().unwrap().clone()
}

#[tauri::command]
pub fn gallery_rename(app: AppHandle, state: State<AppState>, id: String, name: String) -> R<()> {
    state.gallery.rename(&id, &name)?;
    tray_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn gallery_delete(app: AppHandle, state: State<AppState>, id: String) -> R<()> {
    state.gallery.delete(&id)?;
    state.update_settings(|s| s.schedules.retain(|x| !(x.action == "screen" && x.target.as_deref() == Some(id.as_str()))))?;
    tray_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn gallery_set_favorite(app: AppHandle, state: State<AppState>, id: String, favorite: bool) -> R<()> {
    state.gallery.set_favorite(&id, favorite)?;
    tray_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn gallery_duplicate(app: AppHandle, state: State<AppState>, id: String) -> R<GalleryItem> {
    let item = state.gallery.duplicate(&id)?;
    tray_changed(&app);
    Ok(item)
}

#[tauri::command]
pub fn gallery_export(state: State<AppState>, id: String) -> R<Response> {
    Ok(Response::new(state.gallery.export(&id)?))
}

#[tauri::command]
pub fn gallery_import(app: AppHandle, state: State<AppState>, path: String) -> R<GalleryItem> {
    let bytes = std::fs::read(&path).map_err(|e| format!("não foi possível ler {path}: {e}"))?;
    let item = state.gallery.import(&bytes)?;
    tray_changed(&app);
    state::log(&app, "ok", format!("“{}” importado para a galeria", item.name));
    Ok(item)
}

// ------------------------------------------------------------------ arquivos

#[derive(Deserialize)]
struct WriteMeta {
    path: String,
}

#[tauri::command]
pub fn write_file(request: Request<'_>) -> R<()> {
    let (meta, bytes): (WriteMeta, &[u8]) = split_body(&request)?;
    std::fs::write(&meta.path, bytes).map_err(|e| format!("não foi possível salvar {}: {e}", meta.path))
}

#[tauri::command]
pub fn read_file(path: String) -> R<Response> {
    let bytes = std::fs::read(&path).map_err(|e| format!("não foi possível ler {path}: {e}"))?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("arquivo grande demais".into());
    }
    Ok(Response::new(bytes))
}

// ------------------------------------------------------------------ configurações

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Settings {
    state.settings()
}

#[tauri::command]
pub fn save_settings(app: AppHandle, state: State<AppState>, settings: Settings) -> R<Settings> {
    let autostart = app.autolaunch();
    let currently = autostart.is_enabled().unwrap_or(false);
    if settings.start_with_windows != currently {
        let r = if settings.start_with_windows { autostart.enable() } else { autostart.disable() };
        r.map_err(|e| format!("não foi possível alterar a inicialização com o Windows: {e}"))?;
    }
    let before = state.settings();
    let saved = state.update_settings(|s| {
        // Campos geridos por comandos próprios são preservados.
        let keep = (s.lighting.clone(), s.sleep, s.stream.clone(), s.keymap.clone(), s.now_playing_enabled);
        *s = settings;
        s.lighting = keep.0;
        s.sleep = keep.1;
        s.stream = keep.2;
        s.keymap = keep.3;
        s.now_playing_enabled = keep.4;
        s.rotation.interval_min = s.rotation.interval_min.max(5);
    })?;
    if saved.shortcuts_enabled != before.shortcuts_enabled {
        automation::set_shortcuts(&app, saved.shortcuts_enabled)?;
    }
    if saved.rotation.enabled && !before.rotation.enabled || saved.rotation.interval_min != before.rotation.interval_min {
        *state.rotation_last.lock().unwrap() = Some(Instant::now());
    }
    if serde_json::to_string(&saved.profiles).ok() != serde_json::to_string(&before.profiles).ok() {
        tray_changed(&app);
    }
    Ok(saved)
}

#[tauri::command]
pub async fn run_schedule(app: AppHandle, action: String, target: Option<String>) -> R<String> {
    blocking(move || {
        let r = automation::run_schedule(&app, &action, target.as_deref());
        match &r {
            Ok(m) => state::log(&app, "ok", m.clone()),
            Err(e) => state::log(&app, "error", e.clone()),
        }
        r
    })
    .await
}

#[tauri::command]
pub fn shortcut_list() -> Vec<(String, String)> {
    automation::SHORTCUTS.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect()
}

#[tauri::command]
pub fn activity_log(state: State<AppState>) -> Vec<LogEntry> {
    state.log.lock().unwrap().iter().cloned().collect()
}

#[tauri::command]
pub fn activity_clear(state: State<AppState>) {
    state.log.lock().unwrap().clear();
}

/// Backup das configurações (perfis, agendamentos, preferências) em JSON.
#[tauri::command]
pub fn export_backup(state: State<AppState>) -> R<String> {
    let s = state.settings();
    serde_json::to_string_pretty(&serde_json::json!({ "app": "AK820 Studio", "version": 1, "settings": s })).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_backup(app: AppHandle, state: State<AppState>, json: String) -> R<Settings> {
    #[derive(Deserialize)]
    struct Backup {
        settings: Settings,
    }
    let b: Backup = serde_json::from_str(&json).map_err(|e| format!("backup inválido: {e}"))?;
    let saved = state.update_settings(|s| {
        let start = s.start_with_windows;
        *s = b.settings;
        s.start_with_windows = start;
    })?;
    automation::set_shortcuts(&app, saved.shortcuts_enabled)?;
    tray_changed(&app);
    let _ = app.emit("settings-changed", ());
    state::log(&app, "ok", "Backup de configurações restaurado");
    Ok(saved)
}

#[allow(dead_code)]
fn _assert_store(_: store::Profile) {}

// ------------------------------------------------------------------ v0.3: música, wallpaper, programas

#[tauri::command]
pub fn now_playing_set(app: AppHandle, state: State<AppState>, enabled: bool) -> R<()> {
    state.update_settings(|s| s.now_playing_enabled = enabled)?;
    crate::media::set_enabled(&app, enabled)
}

#[tauri::command]
pub fn now_playing_get(state: State<AppState>) -> Option<crate::media::NowPlaying> {
    state.now_playing.lock().unwrap().clone()
}

#[tauri::command]
pub fn wallpaper_get(source: String, monitor: Option<String>) -> R<crate::wallpaper::WallpaperInfo> {
    match source.as_str() {
        "engine" => crate::wallpaper::engine_info(monitor.as_deref()),
        _ => crate::wallpaper::windows_info(),
    }
}

#[tauri::command]
pub fn wallpaper_engine_monitors() -> R<Vec<crate::wallpaper::EngineMonitor>> {
    crate::wallpaper::engine_monitors()
}

#[tauri::command]
pub fn list_processes() -> Vec<String> {
    crate::apps::list_processes()
}

#[tauri::command]
pub fn active_rule(state: State<AppState>) -> Option<String> {
    state.active_rule.lock().unwrap().clone()
}

#[tauri::command]
pub fn pomodoro_reset(state: State<AppState>) {
    *state.pomodoro_start.lock().unwrap() = Instant::now();
}

// ------------------------------------------------------------------ atualizações

#[tauri::command]
pub async fn update_check(app: AppHandle) -> R<crate::updates::UpdateStatus> {
    crate::updates::check(&app).await
}

#[tauri::command]
pub async fn update_install(app: AppHandle) -> R<()> {
    crate::updates::install(&app).await
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    crate::updates::current(&app)
}
