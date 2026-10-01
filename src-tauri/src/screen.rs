//! Ambilight: as teclas copiam as cores da tela do PC.

use ak820_core::effects::Frame;
use ak820_core::layout::{keys, Key, KEY_COUNT, ROWS, WIDTH_UNITS};

/// Calcula a cor de cada tecla amostrando a região correspondente da imagem.
/// `get(x, y)` devolve o pixel RGB. `saturation` 1.0 = original.
#[cfg_attr(not(windows), allow(dead_code))]
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

pub struct Capturer {
    ks: Vec<Key>,
}

impl Capturer {
    pub fn new() -> Self {
        Self { ks: keys() }
    }

    #[cfg(windows)]
    pub fn frame(&mut self, saturation: f32) -> Result<Frame, String> {
        let monitors = xcap::Monitor::all().map_err(|e| format!("captura de tela: {e}"))?;
        let mon = monitors
            .iter()
            .find(|m| m.is_primary().unwrap_or(false))
            .or(monitors.first())
            .ok_or("nenhum monitor encontrado")?;
        let img = mon.capture_image().map_err(|e| format!("captura de tela: {e}"))?;
        let (w, h) = (img.width(), img.height());
        let raw = img.as_raw();
        Ok(key_colors(
            w,
            h,
            |x, y| {
                let i = ((y * w + x) * 4) as usize;
                [raw[i], raw[i + 1], raw[i + 2]]
            },
            saturation,
            &self.ks,
        ))
    }

    #[cfg(not(windows))]
    pub fn frame(&mut self, _saturation: f32) -> Result<Frame, String> {
        let _ = &self.ks;
        Err("a captura de tela (Ambilight) só funciona no Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
