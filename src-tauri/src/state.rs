//! Estado global e ações compartilhadas (comandos, atalhos, bandeja e agendador).

use crate::hid::{self, DeviceStatus, HidTransport};
use crate::store::{self, Gallery, LightingDto, Settings, StreamConfig};
use ak820_core::ops;
use ak820_core::packets::DateTime;
use chrono::{Datelike, Local, Timelike};
use hidapi::HidApi;
use serde::Serialize;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub ts: u64,
    /// "ok" | "error" | "info"
    pub kind: String,
    pub message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub done: usize,
    pub total: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Notice {
    kind: String,
    message: String,
}

pub struct AppState {
    pub hid: Mutex<Option<HidApi>>,
    /// Serializa todas as operações no teclado.
    pub op: Mutex<()>,
    pub settings: Mutex<Settings>,
    pub settings_path: PathBuf,
    pub gallery: Gallery,
    pub last_status: Mutex<Option<DeviceStatus>>,
    pub log: Mutex<VecDeque<LogEntry>>,
    pub lights_off: Mutex<bool>,
    /// Modo de RGB por tecla ativo (None = parado).
    pub stream: Mutex<Option<StreamConfig>>,
    /// Stream que estava ativo antes de apagar as luzes.
    pub stream_paused: Mutex<Option<StreamConfig>>,
    pub gallery_cursor: Mutex<Option<String>>,
    pub rotation_last: Mutex<Option<Instant>>,
    pub media_child: Mutex<Option<std::process::Child>>,
    pub media_enabled: Mutex<bool>,
    pub now_playing: Mutex<Option<crate::media::NowPlaying>>,
    pub pomodoro_start: Mutex<Instant>,
    /// Regra de programa ativa e o que restaurar quando ele fechar.
    pub active_rule: Mutex<Option<String>>,
    pub rule_restore: Mutex<Option<(Option<StreamConfig>, Option<String>)>>,
}

impl AppState {
    pub fn new(settings: Settings, settings_path: PathBuf, gallery: Gallery) -> Self {
        Self {
            hid: Mutex::new(None),
            op: Mutex::new(()),
            settings: Mutex::new(settings),
            settings_path,
            gallery,
            last_status: Mutex::new(None),
            log: Mutex::new(VecDeque::new()),
            lights_off: Mutex::new(false),
            stream: Mutex::new(None),
            stream_paused: Mutex::new(None),
            gallery_cursor: Mutex::new(None),
            rotation_last: Mutex::new(None),
            media_child: Mutex::new(None),
            media_enabled: Mutex::new(false),
            now_playing: Mutex::new(None),
            pomodoro_start: Mutex::new(Instant::now()),
            active_rule: Mutex::new(None),
            rule_restore: Mutex::new(None),
        }
    }

    pub fn with_api<R>(&self, f: impl FnOnce(&mut HidApi) -> R) -> Result<R, String> {
        let mut guard = self.hid.lock().map_err(|_| "estado HID corrompido")?;
        if guard.is_none() {
            *guard = Some(HidApi::new().map_err(|e| format!("não foi possível iniciar o HID: {e}"))?);
        }
        let api = guard.as_mut().unwrap();
        let _ = api.refresh_devices();
        Ok(f(api))
    }

    /// Abre o teclado, executa `f` e fecha. Operações são serializadas.
    pub fn run<R>(&self, need_data: bool, f: impl FnOnce(&mut HidTransport) -> Result<R, String>) -> Result<R, String> {
        let _op = self.op.lock().map_err(|_| "operação anterior travou")?;
        let mut t = self.with_api(|api| HidTransport::open(api, need_data))??;
        f(&mut t)
    }

    pub fn settings(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }

    pub fn update_settings(&self, f: impl FnOnce(&mut Settings)) -> Result<Settings, String> {
        let mut s = self.settings.lock().unwrap();
        f(&mut s);
        store::save_settings(&self.settings_path, &s)?;
        Ok(s.clone())
    }
}

pub fn now() -> DateTime {
    let n = Local::now();
    DateTime {
        year: n.year() as u16,
        month: n.month() as u8,
        day: n.day() as u8,
        hour: n.hour() as u8,
        minute: n.minute() as u8,
        second: n.second() as u8,
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Registra no histórico e avisa a interface.
pub fn log(app: &AppHandle, kind: &str, message: impl Into<String>) {
    let entry = LogEntry { ts: now_ms(), kind: kind.into(), message: message.into() };
    {
        let state = app.state::<AppState>();
        let mut l = state.log.lock().unwrap();
        l.push_front(entry.clone());
        l.truncate(300);
    }
    let _ = app.emit("activity", entry);
}

/// Registra e mostra um aviso (toast) na interface.
pub fn notify(app: &AppHandle, kind: &str, message: impl Into<String>) {
    let message = message.into();
    log(app, kind, message.clone());
    let _ = app.emit("notice", Notice { kind: kind.into(), message });
}

pub fn do_upload(app: &AppHandle, frames: &[u8], delays: &[u32]) -> Result<(), String> {
    let state = app.state::<AppState>();
    let payload = ak820_core::image::build_payload(frames, delays)?;
    state.run(true, |t| {
        ops::upload_payload(t, &payload, |done, total| {
            let _ = app.emit("upload-progress", Progress { done, total });
        })
    })
}

pub fn upload_item(app: &AppHandle, id: &str) -> Result<String, String> {
    let state = app.state::<AppState>();
    let (item, frames) = state.gallery.get(id)?;
    do_upload(app, &frames, &item.delays)?;
    *state.gallery_cursor.lock().unwrap() = Some(item.id.clone());
    let _ = app.emit("screen-changed", item.id.clone());
    Ok(item.name)
}

pub fn sync_clock(app: &AppHandle) -> Result<String, String> {
    let dt = now();
    app.state::<AppState>().run(false, |t| ops::sync_time(t, dt))?;
    Ok(format!("{:02}:{:02}:{:02}", dt.hour, dt.minute, dt.second))
}

/// Aplica uma iluminação; `remember` grava como iluminação atual.
pub fn apply_lighting(app: &AppHandle, l: &LightingDto, remember: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let core = l.to_core()?;
    state.run(false, |t| ops::set_lighting(t, &core))?;
    if remember {
        state.update_settings(|s| s.lighting = Some(l.clone()))?;
        *state.lights_off.lock().unwrap() = l.mode == 0;
    }
    let _ = app.emit("lighting-changed", l.clone());
    Ok(())
}

pub fn apply_profile(app: &AppHandle, id: &str) -> Result<String, String> {
    let state = app.state::<AppState>();
    let p = state
        .settings()
        .profiles
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "perfil não encontrado".to_string())?;
    set_stream(app, None);
    apply_lighting(app, &p.lighting, true)?;
    Ok(p.name)
}

pub fn apply_profile_index(app: &AppHandle, index: usize) -> Result<String, String> {
    let id = app
        .state::<AppState>()
        .settings()
        .profiles
        .get(index)
        .map(|p| p.id.clone())
        .ok_or_else(|| format!("não existe perfil {}", index + 1))?;
    apply_profile(app, &id)
}

/// Liga/desliga as luzes. Retorna `true` se ficaram apagadas.
pub fn toggle_lights(app: &AppHandle) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let off = *state.lights_off.lock().unwrap();
    if off {
        lights_on(app)?;
        Ok(false)
    } else {
        lights_off(app)?;
        Ok(true)
    }
}

pub fn lights_off(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let active = state.stream.lock().unwrap().take();
    if active.is_some() {
        *state.stream_paused.lock().unwrap() = active;
        let _ = app.emit("stream-changed", Option::<StreamConfig>::None);
    }
    let base = state.settings().lighting.unwrap_or(LightingDto {
        mode: 1,
        color: "#8b6cff".into(),
        rainbow: false,
        brightness: 4,
        speed: 3,
        direction: 0,
    });
    apply_lighting(app, &LightingDto { mode: 0, ..base }, false)?;
    *state.lights_off.lock().unwrap() = true;
    Ok(())
}

pub fn lights_on(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let base = state.settings().lighting.filter(|l| l.mode != 0).unwrap_or(LightingDto {
        mode: 1,
        color: "#8b6cff".into(),
        rainbow: false,
        brightness: 4,
        speed: 3,
        direction: 0,
    });
    apply_lighting(app, &base, false)?;
    *state.lights_off.lock().unwrap() = false;
    if let Some(s) = state.stream_paused.lock().unwrap().take() {
        set_stream(app, Some(s));
    }
    Ok(())
}

pub fn set_stream(app: &AppHandle, cfg: Option<StreamConfig>) {
    let state = app.state::<AppState>();
    let was_pomodoro = state.stream.lock().unwrap().as_ref().map(|c| c.mode == "pomodoro").unwrap_or(false);
    if cfg.as_ref().map(|c| c.mode == "pomodoro").unwrap_or(false) && !was_pomodoro {
        *state.pomodoro_start.lock().unwrap() = Instant::now();
    }
    *state.stream.lock().unwrap() = cfg.clone();
    if cfg.is_some() {
        *state.lights_off.lock().unwrap() = false;
    }
    let _ = app.emit("stream-changed", cfg);
}

/// Lista usada por atalhos e rotação: favoritos (se houver) ou todos.
pub fn screen_list(state: &AppState, source: &str) -> Vec<String> {
    let all = state.gallery.list();
    let favs: Vec<String> = all.iter().filter(|i| i.favorite).map(|i| i.id.clone()).collect();
    if source == "favorites" && !favs.is_empty() {
        favs
    } else {
        all.into_iter().map(|i| i.id).collect()
    }
}

/// Envia a próxima (step = 1) ou anterior (step = -1) tela da lista.
pub fn step_screen(app: &AppHandle, step: i32, source: &str, shuffle: bool) -> Result<String, String> {
    let state = app.state::<AppState>();
    let list = screen_list(&state, source);
    if list.is_empty() {
        return Err("a galeria está vazia".into());
    }
    let cur = state.gallery_cursor.lock().unwrap().clone();
    let pos = cur.and_then(|c| list.iter().position(|i| *i == c));
    let next = if shuffle && list.len() > 1 {
        let seed = now_ms() as usize;
        let mut n = seed % list.len();
        if Some(n) == pos {
            n = (n + 1) % list.len();
        }
        n
    } else {
        match pos {
            Some(p) => (p as i32 + step).rem_euclid(list.len() as i32) as usize,
            None => 0,
        }
    };
    upload_item(app, &list[next])
}

pub fn status_now(state: &AppState) -> DeviceStatus {
    match state.with_api(|api| hid::status(api)) {
        Ok(s) => s,
        Err(e) => DeviceStatus { state: "error".into(), product: None, message: e },
    }
}
