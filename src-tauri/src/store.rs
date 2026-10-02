//! Configurações e galeria salvas no disco.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LightingDto {
    pub mode: u8,
    pub color: String,
    pub rainbow: bool,
    pub brightness: u8,
    pub speed: u8,
    pub direction: u8,
}

impl LightingDto {
    pub fn to_core(&self) -> Result<ak820_core::packets::Lighting, String> {
        let hex = self.color.trim_start_matches('#');
        if hex.len() != 6 {
            return Err(format!("cor inválida: {}", self.color));
        }
        let c = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).map_err(|_| format!("cor inválida: {}", self.color));
        let l = ak820_core::packets::Lighting {
            mode: self.mode,
            red: c(0)?,
            green: c(2)?,
            blue: c(4)?,
            rainbow: self.rainbow,
            brightness: self.brightness,
            speed: self.speed,
            direction: self.direction,
        };
        l.validate()?;
        Ok(l)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub auto_sync_on_connect: bool,
    /// Minutos entre sincronizações automáticas (0 = desligado).
    pub sync_interval_min: u32,
    pub minimize_to_tray: bool,
    pub start_with_windows: bool,
    pub lighting: Option<LightingDto>,
    pub sleep: Option<u8>,
    pub max_frames: u32,
    pub dithering: bool,
    pub profiles: Vec<Profile>,
    pub schedules: Vec<Schedule>,
    pub rotation: Rotation,
    pub shortcuts_enabled: bool,
    /// Pintura de RGB por tecla salva (81 cores "#rrggbb").
    pub keymap: Option<Vec<String>>,
    /// Último modo de RGB por tecla configurado (para restaurar ao abrir).
    pub stream: Option<StreamConfig>,
    pub stream_autostart: bool,
    pub now_playing_enabled: bool,
    /// "off" | "windows" | "engine": avisa a interface quando o wallpaper mudar.
    pub wallpaper_watch: String,
    pub app_rules: Vec<AppRule>,
    pub app_rules_enabled: bool,
    /// Preferências só da interface (clima, modelos, etc.).
    pub ui: serde_json::Value,
    /// Procurar atualizações ao abrir o app.
    pub auto_update_check: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub lighting: LightingDto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Schedule {
    pub id: String,
    pub enabled: bool,
    /// "HH:MM"
    pub time: String,
    /// 0 = domingo .. 6 = sábado
    pub days: Vec<u8>,
    /// "screen" | "profile" | "lightsOff" | "lightsOn" | "sync" | "rotationOn" | "rotationOff"
    pub action: String,
    pub target: Option<String>,
}

impl Default for Schedule {
    fn default() -> Self {
        Self { id: String::new(), enabled: true, time: "08:00".into(), days: (0..7).collect(), action: "sync".into(), target: None }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Rotation {
    pub enabled: bool,
    pub interval_min: u32,
    /// "favorites" | "all"
    pub source: String,
    pub shuffle: bool,
}

impl Default for Rotation {
    fn default() -> Self {
        Self { enabled: false, interval_min: 60, source: "favorites".into(), shuffle: false }
    }
}

/// Configuração do RGB por tecla transmitido pelo PC.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct StreamConfig {
    /// "paint" | "effect" | "meter"
    pub mode: String,
    pub effect: String,
    pub speed: f32,
    pub color_a: String,
    pub color_b: String,
    pub brightness: f32,
    pub reverse: bool,
    pub colors: Vec<String>,
    /// Música: "spectrum" | "pulse" | "rainbow" | "ripple"
    pub music_style: String,
    /// Música: 0.3 .. 3.0
    pub sensitivity: f32,
    /// Ambilight: 0 .. 3 (1 = original)
    pub saturation: f32,
    /// Pomodoro: minutos de foco e de pausa
    pub work_min: u32,
    pub break_min: u32,
    /// Ambilight: "screen" | "window" | "wallpaper"
    pub ambi_source: String,
    /// Ambilight: id do monitor, "app|título" da janela ou "windows"/"engine:Monitor0".
    pub ambi_target: String,
}

impl Default for StreamConfig {
    fn default() -> Self {
        Self {
            mode: "effect".into(),
            effect: "rainbowWave".into(),
            speed: 1.0,
            color_a: "#8b6cff".into(),
            color_b: "#00e5ff".into(),
            brightness: 0.8,
            reverse: false,
            colors: vec![],
            music_style: "spectrum".into(),
            sensitivity: 1.0,
            saturation: 1.4,
            work_min: 25,
            break_min: 5,
            ambi_source: "screen".into(),
            ambi_target: String::new(),
        }
    }
}

/// Regra "quando este programa estiver aberto, faça isto".
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppRule {
    pub id: String,
    pub enabled: bool,
    /// Nome do executável, ex.: "valorant.exe" (sem diferenciar maiúsculas).
    pub process: String,
    /// "profile" | "screen" | "stream" | "lightsOff"
    pub action: String,
    pub target: Option<String>,
}

impl Default for AppRule {
    fn default() -> Self {
        Self { id: String::new(), enabled: true, process: String::new(), action: "profile".into(), target: None }
    }
}

pub fn parse_hex(c: &str) -> Option<[u8; 3]> {
    let h = c.trim_start_matches('#');
    if h.len() != 6 {
        return None;
    }
    let v = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
    Some([v(0)?, v(2)?, v(4)?])
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_sync_on_connect: true,
            sync_interval_min: 60,
            minimize_to_tray: true,
            start_with_windows: false,
            lighting: None,
            sleep: None,
            max_frames: ak820_core::image::RECOMMENDED_MAX_FRAMES as u32,
            dithering: true,
            profiles: vec![],
            schedules: vec![],
            rotation: Rotation::default(),
            shortcuts_enabled: true,
            keymap: None,
            stream: None,
            stream_autostart: false,
            now_playing_enabled: false,
            wallpaper_watch: "off".into(),
            app_rules: vec![],
            app_rules_enabled: true,
            ui: serde_json::json!({}),
            auto_update_check: true,
        }
    }
}

pub fn load_settings(path: &Path) -> Settings {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_settings(path: &Path, s: &Settings) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    write_atomic(path, json.as_bytes())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

// ------------------------------------------------------------------ galeria

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryItem {
    pub id: String,
    pub name: String,
    pub created: u64,
    pub frames: usize,
    pub delays: Vec<u32>,
    /// PNG do primeiro quadro como data URL.
    pub thumb: String,
    #[serde(default)]
    pub favorite: bool,
}

const MAGIC: &[u8; 8] = b"AK820GAL";

pub struct Gallery {
    pub dir: PathBuf,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn valid_id(id: &str) -> Result<(), String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("id inválido".into());
    }
    Ok(())
}

impl Gallery {
    pub fn list(&self) -> Vec<GalleryItem> {
        let mut items: Vec<GalleryItem> = fs::read_dir(&self.dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| fs::read_to_string(e.path().join("meta.json")).ok())
            .filter_map(|s| serde_json::from_str(&s).ok())
            .collect();
        items.sort_by(|a, b| b.created.cmp(&a.created));
        items
    }

    pub fn save(&self, name: String, delays: Vec<u32>, thumb: String, frames: &[u8]) -> Result<GalleryItem, String> {
        let n = frames.len() / ak820_core::image::FRAME_BYTES;
        ak820_core::image::build_payload(frames, &delays)?; // valida
        let created = now_ms();
        static SEQ: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let id = format!("{created:x}-{:04x}", (seq.wrapping_mul(2654435761) >> 16) & 0xFFFF);
        let dir = self.dir.join(&id);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let item = GalleryItem {
            id,
            name: if name.trim().is_empty() { "Sem nome".into() } else { name.trim().chars().take(60).collect() },
            created,
            frames: n,
            delays,
            thumb,
            favorite: false,
        };
        fs::write(dir.join("frames.bin"), frames).map_err(|e| e.to_string())?;
        write_atomic(&dir.join("meta.json"), serde_json::to_string(&item).map_err(|e| e.to_string())?.as_bytes())?;
        Ok(item)
    }

    pub fn get(&self, id: &str) -> Result<(GalleryItem, Vec<u8>), String> {
        valid_id(id)?;
        let dir = self.dir.join(id);
        let meta = fs::read_to_string(dir.join("meta.json")).map_err(|_| "item não encontrado".to_string())?;
        let item: GalleryItem = serde_json::from_str(&meta).map_err(|e| e.to_string())?;
        let frames = fs::read(dir.join("frames.bin")).map_err(|e| e.to_string())?;
        Ok((item, frames))
    }

    fn write_meta(&self, item: &GalleryItem) -> Result<(), String> {
        write_atomic(&self.dir.join(&item.id).join("meta.json"), serde_json::to_string(item).map_err(|e| e.to_string())?.as_bytes())
    }

    pub fn rename(&self, id: &str, name: &str) -> Result<(), String> {
        let (mut item, _) = self.get(id)?;
        item.name = name.trim().chars().take(60).collect();
        self.write_meta(&item)
    }

    pub fn set_favorite(&self, id: &str, favorite: bool) -> Result<(), String> {
        let (mut item, _) = self.get(id)?;
        item.favorite = favorite;
        self.write_meta(&item)
    }

    pub fn duplicate(&self, id: &str) -> Result<GalleryItem, String> {
        let (item, frames) = self.get(id)?;
        let mut copy = self.save(format!("{} (cópia)", item.name), item.delays, item.thumb, &frames)?;
        copy.favorite = item.favorite;
        self.write_meta(&copy)?;
        Ok(copy)
    }

    /// Arquivo .ak820: "AK820GAL" + u32 LE tamanho do JSON + JSON + quadros.
    pub fn export(&self, id: &str) -> Result<Vec<u8>, String> {
        let (item, frames) = self.get(id)?;
        let meta = serde_json::to_vec(&serde_json::json!({
            "name": item.name, "delays": item.delays, "thumb": item.thumb, "favorite": item.favorite
        }))
        .map_err(|e| e.to_string())?;
        let mut out = Vec::with_capacity(12 + meta.len() + frames.len());
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&(meta.len() as u32).to_le_bytes());
        out.extend_from_slice(&meta);
        out.extend_from_slice(&frames);
        Ok(out)
    }

    pub fn import(&self, bytes: &[u8]) -> Result<GalleryItem, String> {
        if bytes.len() < 12 || &bytes[..8] != MAGIC {
            return Err("arquivo não é um item da galeria do AK820 Studio (.ak820)".into());
        }
        let len = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]) as usize;
        if bytes.len() < 12 + len {
            return Err("arquivo .ak820 corrompido".into());
        }
        #[derive(Deserialize)]
        struct Meta {
            name: String,
            delays: Vec<u32>,
            thumb: String,
            #[serde(default)]
            favorite: bool,
        }
        let m: Meta = serde_json::from_slice(&bytes[12..12 + len]).map_err(|e| format!("arquivo .ak820 inválido: {e}"))?;
        let mut item = self.save(m.name, m.delays, m.thumb, &bytes[12 + len..])?;
        item.favorite = m.favorite;
        self.write_meta(&item)?;
        Ok(item)
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        valid_id(id)?;
        fs::remove_dir_all(self.dir.join(id)).map_err(|e| e.to_string())
    }
}
