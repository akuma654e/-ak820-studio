//! Ambilight: as teclas copiam as cores de uma fonte de imagem:
//! - "screen": um monitor inteiro;
//! - "window": a janela de um aplicativo específico;
//! - "wallpaper": o papel de parede (Windows ou Wallpaper Engine, com GIF animado).

use ak820_core::effects::Frame;
use ak820_core::layout::{keys, Key, KEY_COUNT, ROWS, WIDTH_UNITS};
use image::{AnimationDecoder, RgbaImage};
use serde::Serialize;
use std::io::Cursor;
use std::time::{Duration, Instant};

/// Calcula a cor de cada tecla amostrando a região correspondente da imagem.
/// `get(x, y)` devolve o pixel RGB. `saturation` 1.0 = original.
pub fn key_colors(width: u32, height: u32, get: impl Fn(u32, u32) -> [u8; 3], saturation: f32, ks: &[Key]) -> Frame {
    let mut out = [[0u8; 3]; KEY_COUNT];
    if width == 0 || height == 0 {
        return out;
    }
    for (i, k) in ks.iter().enumerate().take(KEY_COUNT) {
        let x0 = k.x / WIDTH_UNITS * width as f32;
        let x1 = (k.x + k.w) / WIDTH_UNITS * width as f32;
        let y0 = k.row as f32 / ROWS as f32 * height as f32;
        let y1 = (k.row as f32 + 1.0) / ROWS as f32 * height as f32;
        let (mut r, mut g, mut b, mut n) = (0f32, 0f32, 0f32, 0f32);
        const S: u32 = 5;
        for sy in 0..S {
            for sx in 0..S {
                let px = (x0 + (x1 - x0) * (sx as f32 + 0.5) / S as f32) as u32;
                let py = (y0 + (y1 - y0) * (sy as f32 + 0.5) / S as f32) as u32;
                let c = get(px.min(width - 1), py.min(height - 1));
                r += c[0] as f32;
                g += c[1] as f32;
                b += c[2] as f32;
                n += 1.0;
            }
        }
        let (r, g, b) = (r / n, g / n, b / n);
        let l = (r + g + b) / 3.0;
        let s = saturation.clamp(0.0, 3.0);
        out[i] = [r, g, b].map(|v| (l + (v - l) * s).clamp(0.0, 255.0) as u8);
    }
    out
}

fn image_colors(img: &RgbaImage, saturation: f32, ks: &[Key]) -> Frame {
    let (w, h) = (img.width(), img.height());
    let raw = img.as_raw();
    key_colors(
        w,
        h,
        |x, y| {
            let i = ((y * w + x) * 4) as usize;
            [raw[i], raw[i + 1], raw[i + 2]]
        },
        saturation,
        ks,
    )
}

// ------------------------------------------------------------------ wallpaper

/// Quadros já convertidos em cores por tecla (barato de tocar a cada 100 ms).
pub struct KeyAnimation {
    frames: Vec<(Frame, u32)>,
    total_ms: u32,
}

impl KeyAnimation {
    /// Decodifica PNG/JPG/WebP/BMP (1 quadro) ou GIF animado.
    pub fn decode(bytes: &[u8], saturation: f32, ks: &[Key]) -> Result<Self, String> {
        let mut frames = vec![];
        if bytes.starts_with(b"GIF") {
            let dec = image::codecs::gif::GifDecoder::new(Cursor::new(bytes)).map_err(|e| format!("GIF inválido: {e}"))?;
            for f in dec.into_frames().take(300) {
                let f = f.map_err(|e| format!("GIF inválido: {e}"))?;
                let (n, d) = f.delay().numer_denom_ms();
                let ms = if d == 0 { 100 } else { (n / d).max(20) };
                let img = f.into_buffer();
                frames.push((image_colors(&img, saturation, ks), ms));
            }
        }
        if frames.is_empty() {
            let img = image::load_from_memory(bytes).map_err(|e| format!("imagem inválida: {e}"))?.to_rgba8();
            frames.push((image_colors(&img, saturation, ks), 1000));
        }
        let total_ms = frames.iter().map(|(_, d)| *d).sum::<u32>().max(1);
        Ok(Self { frames, total_ms })
    }

    pub fn at(&self, t: Duration) -> Frame {
        let mut ms = (t.as_millis() as u64 % self.total_ms as u64) as u32;
        for (f, d) in &self.frames {
            if ms < *d {
                return *f;
            }
            ms -= d;
        }
        self.frames[0].0
    }

    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.frames.len()
    }
}

/// `target` do wallpaper: "windows" ou "engine" ou "engine:Monitor1".
fn wallpaper_bytes(target: &str) -> Result<(Vec<u8>, u64), String> {
    let (source, monitor) = match target.split_once(':') {
        Some((s, m)) => (s, Some(m)),
        None => (target, None),
    };
    let info = if source == "engine" { crate::wallpaper::engine_info(monitor)? } else { crate::wallpaper::windows_info()? };
    let bytes = std::fs::read(&info.path).map_err(|e| format!("não consegui ler o wallpaper: {e}"))?;
    Ok((bytes, crate::wallpaper::stamp(source, monitor)))
}

// ------------------------------------------------------------------ alvos

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorTarget {
    pub id: String,
    pub name: String,
    pub primary: bool,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowTarget {
    /// "app|título", usado para reencontrar a janela.
    pub key: String,
    pub app: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Targets {
    pub monitors: Vec<MonitorTarget>,
    pub windows: Vec<WindowTarget>,
}

#[cfg(windows)]
pub fn targets() -> Result<Targets, String> {
    let monitors = xcap::Monitor::all()
        .map_err(|e| e.to_string())?
        .iter()
        .map(|m| MonitorTarget {
            id: m.id().map(|i| i.to_string()).unwrap_or_default(),
            name: m.name().unwrap_or_default(),
            primary: m.is_primary().unwrap_or(false),
            width: m.width().unwrap_or(0),
            height: m.height().unwrap_or(0),
        })
        .collect();
    let own = std::process::id();
    let mut windows: Vec<WindowTarget> = xcap::Window::all()
        .map_err(|e| e.to_string())?
        .iter()
        .filter(|w| w.pid().map(|p| p != own).unwrap_or(true))
        .filter(|w| w.width().unwrap_or(0) > 120 && w.height().unwrap_or(0) > 80)
        .filter_map(|w| {
            let app = w.app_name().ok()?;
            let title = w.title().ok()?;
            if title.trim().is_empty() || app.trim().is_empty() {
                return None;
            }
            Some(WindowTarget { key: format!("{app}|{title}"), app, title })
        })
        .collect();
    windows.sort_by(|a, b| a.app.to_lowercase().cmp(&b.app.to_lowercase()).then(a.title.cmp(&b.title)));
    windows.dedup_by(|a, b| a.key == b.key);
    Ok(Targets { monitors, windows })
}

#[cfg(not(windows))]
pub fn targets() -> Result<Targets, String> {
    Err("disponível só no Windows".into())
}

// ------------------------------------------------------------------ captura

pub struct Capturer {
    ks: Vec<Key>,
    wall: Option<KeyAnimation>,
    wall_key: (String, u64, i32),
    wall_checked: Option<Instant>,
    started: Instant,
}

impl Capturer {
    pub fn new() -> Self {
        Self { ks: keys(), wall: None, wall_key: (String::new(), 0, 0), wall_checked: None, started: Instant::now() }
    }

    pub fn frame(&mut self, source: &str, target: &str, saturation: f32) -> Result<Frame, String> {
        match source {
            "wallpaper" => self.wallpaper(target, saturation),
            "window" => self.window(target, saturation),
            _ => self.screen(target, saturation),
        }
    }

    fn wallpaper(&mut self, target: &str, saturation: f32) -> Result<Frame, String> {
        let target = if target.is_empty() { "windows" } else { target };
        let sat_key = (saturation * 100.0) as i32;
        let due = self.wall_checked.map(|t| t.elapsed() > Duration::from_secs(5)).unwrap_or(true);
        if self.wall.is_none() || due || self.wall_key.0 != target || self.wall_key.2 != sat_key {
            self.wall_checked = Some(Instant::now());
            let (_, source_monitor) = target.split_once(':').unwrap_or((target, ""));
            let source = target.split(':').next().unwrap_or("windows");
            let stamp = crate::wallpaper::stamp(source, if source_monitor.is_empty() { None } else { Some(source_monitor) });
            if self.wall.is_none() || stamp != self.wall_key.1 || self.wall_key.0 != target || self.wall_key.2 != sat_key {
                let (bytes, stamp) = wallpaper_bytes(target)?;
                self.wall = Some(KeyAnimation::decode(&bytes, saturation, &self.ks)?);
                self.wall_key = (target.to_string(), stamp, sat_key);
                self.started = Instant::now();
            }
        }
        Ok(self.wall.as_ref().unwrap().at(self.started.elapsed()))
    }

    #[cfg(windows)]
    fn screen(&mut self, target: &str, saturation: f32) -> Result<Frame, String> {
        let monitors = xcap::Monitor::all().map_err(|e| format!("captura de tela: {e}"))?;
        let mon = monitors
            .iter()
            .find(|m| !target.is_empty() && m.id().map(|i| i.to_string() == target).unwrap_or(false))
            .or_else(|| monitors.iter().find(|m| m.is_primary().unwrap_or(false)))
            .or(monitors.first())
            .ok_or("nenhum monitor encontrado")?;
        let img = mon.capture_image().map_err(|e| format!("captura de tela: {e}"))?;
        Ok(image_colors(&img, saturation, &self.ks))
    }

    #[cfg(windows)]
    fn window(&mut self, target: &str, saturation: f32) -> Result<Frame, String> {
        let (app, title) = target.split_once('|').unwrap_or((target, ""));
        if app.is_empty() {
            return Err("escolha um aplicativo".into());
        }
        let windows = xcap::Window::all().map_err(|e| format!("captura de janela: {e}"))?;
        let usable = |w: &&xcap::Window| !w.is_minimized().unwrap_or(false) && w.width().unwrap_or(0) > 0;
        let win = windows
            .iter()
            .filter(usable)
            .find(|w| w.app_name().map(|a| a == app).unwrap_or(false) && w.title().map(|t| t == title).unwrap_or(false))
            .or_else(|| windows.iter().filter(usable).find(|w| w.app_name().map(|a| a.eq_ignore_ascii_case(app)).unwrap_or(false)));
        let Some(win) = win else {
            // Janela fechada ou minimizada: teclas apagadas até ela voltar.
            return Ok([[0u8; 3]; KEY_COUNT]);
        };
        let img = win.capture_image().map_err(|e| format!("captura de janela: {e}"))?;
        Ok(image_colors(&img, saturation, &self.ks))
    }

    #[cfg(not(windows))]
    fn screen(&mut self, _target: &str, _saturation: f32) -> Result<Frame, String> {
        Err("a captura de tela (Ambilight) só funciona no Windows".into())
    }

    #[cfg(not(windows))]
    fn window(&mut self, _target: &str, _saturation: f32) -> Result<Frame, String> {
        Err("a captura de janela só funciona no Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{codecs::gif::GifEncoder, Delay, Frame as ImgFrame, Rgba};

    #[test]
    fn left_red_right_blue() {
        let ks = keys();
        let f = key_colors(1700, 600, |x, _| if x < 850 { [255, 0, 0] } else { [0, 0, 255] }, 1.0, &ks);
        assert_eq!(f[0], [255, 0, 0]); // Esc
        assert_eq!(f[80], [0, 0, 255]); // seta direita
    }

    #[test]
    fn saturation_zero_is_gray() {
        let ks = keys();
        let f = key_colors(100, 100, |_, _| [255, 0, 0], 0.0, &ks);
        assert_eq!(f[0], [85, 85, 85]);
    }

    #[test]
    fn animated_gif_wallpaper_cycles() {
        let mut bytes = vec![];
        {
            let mut enc = GifEncoder::new(&mut bytes);
            for c in [[255u8, 0, 0, 255], [0, 255, 0, 255]] {
                let img = RgbaImage::from_pixel(64, 36, Rgba(c));
                enc.encode_frame(ImgFrame::from_parts(img, 0, 0, Delay::from_numer_denom_ms(200, 1))).unwrap();
            }
        }
        let ks = keys();
        let a = KeyAnimation::decode(&bytes, 1.0, &ks).unwrap();
        assert_eq!(a.len(), 2);
        assert!(a.at(Duration::from_millis(50))[0][0] > 200);
        assert!(a.at(Duration::from_millis(250))[0][1] > 200);
        assert!(a.at(Duration::from_millis(450))[0][0] > 200); // repete
    }

    #[test]
    fn static_png_wallpaper() {
        let img = RgbaImage::from_pixel(32, 32, Rgba([10, 20, 250, 255]));
        let mut bytes = vec![];
        img.write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Png).unwrap();
        let a = KeyAnimation::decode(&bytes, 1.0, &keys()).unwrap();
        assert_eq!(a.len(), 1);
        assert!(a.at(Duration::from_secs(3))[40][2] > 200);
    }
}
