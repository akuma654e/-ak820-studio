//! Efeitos de RGB calculados no PC (enviados quadro a quadro como RGB por tecla).

use crate::layout::{keys, Key, KEY_COUNT};

pub type Frame = [[u8; 3]; KEY_COUNT];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    RainbowWave,
    ColorCycle,
    Breath,
    Fire,
    Rain,
    Stars,
    Gradient,
    Aurora,
}

impl Kind {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "rainbowWave" => Self::RainbowWave,
            "colorCycle" => Self::ColorCycle,
            "breath" => Self::Breath,
            "fire" => Self::Fire,
            "rain" => Self::Rain,
            "stars" => Self::Stars,
            "gradient" => Self::Gradient,
            "aurora" => Self::Aurora,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Params {
    pub kind: Kind,
    /// 0.2 .. 3.0
    pub speed: f32,
    pub color_a: [u8; 3],
    pub color_b: [u8; 3],
    /// 0.0 .. 1.0
    pub brightness: f32,
    /// true = da direita para a esquerda
    pub reverse: bool,
}

pub struct Engine {
    keys: Vec<Key>,
    state: Vec<f32>,
    rng: u64,
    last_t: f32,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

fn hsv(h: f32, s: f32, v: f32) -> [f32; 3] {
    let h = h.rem_euclid(1.0) * 6.0;
    let i = h.floor() as i32;
    let f = h - i as f32;
    let (p, q, t) = (v * (1.0 - s), v * (1.0 - s * f), v * (1.0 - s * (1.0 - f)));
    match i {
        0 => [v, t, p],
        1 => [q, v, p],
        2 => [p, v, t],
        3 => [p, q, v],
        4 => [t, p, v],
        _ => [v, p, q],
    }
}

fn mix(a: [u8; 3], b: [u8; 3], k: f32) -> [f32; 3] {
    let k = k.clamp(0.0, 1.0);
    [0, 1, 2].map(|i| (a[i] as f32 * (1.0 - k) + b[i] as f32 * k) / 255.0)
}

fn to_u8(c: [f32; 3], bright: f32) -> [u8; 3] {
    c.map(|v| (v.clamp(0.0, 1.0) * bright.clamp(0.0, 1.0) * 255.0).round() as u8)
}

impl Engine {
    pub fn new() -> Self {
        Self { keys: keys(), state: vec![0.0; KEY_COUNT], rng: 0x9E3779B97F4A7C15, last_t: 0.0 }
    }

    fn rand(&mut self) -> f32 {
        // xorshift64*
        self.rng ^= self.rng >> 12;
        self.rng ^= self.rng << 25;
        self.rng ^= self.rng >> 27;
        ((self.rng.wrapping_mul(0x2545F4914F6CDD1D) >> 40) as f32) / (1u64 << 24) as f32
    }

    /// Calcula o quadro no instante `t` (segundos).
    pub fn frame(&mut self, p: &Params, t: f32) -> Frame {
        let dt = (t - self.last_t).clamp(0.0, 0.5);
        self.last_t = t;
        let ts = t * p.speed;
        let dir = if p.reverse { -1.0 } else { 1.0 };
        let mut out = [[0u8; 3]; KEY_COUNT];
        for i in 0..KEY_COUNT {
            let (x, y) = self.keys[i].center();
            let c: [f32; 3] = match p.kind {
                Kind::RainbowWave => hsv(x * dir - ts * 0.35, 1.0, 1.0),
                Kind::ColorCycle => hsv(ts * 0.12, 1.0, 1.0),
                Kind::Breath => {
                    let k = 0.5 - 0.5 * (ts * 2.0).cos();
                    mix([0, 0, 0], p.color_a, 0.05 + 0.95 * k)
                }
                Kind::Gradient => mix(p.color_a, p.color_b, x),
                Kind::Aurora => {
                    let w = (x * 6.0 + ts * 1.3 * dir).sin() * 0.5 + (y * 4.0 - ts * 0.9).sin() * 0.5;
                    mix(p.color_a, p.color_b, 0.5 + 0.5 * w)
                }
                Kind::Fire => {
                    // calor sobe da base; ruído por tecla
                    let target = (y * 1.1 - 0.1) + self.rand() * 0.35;
                    self.state[i] += (target - self.state[i]) * (dt * 6.0 * p.speed).min(1.0);
                    let h = self.state[i].clamp(0.0, 1.0);
                    let r = h.min(1.0);
                    let g = (h * h * 0.8).min(1.0);
                    let b = (h.powi(4) * 0.3).min(1.0);
                    [r, g, b]
                }
                Kind::Rain => {
                    // gotas: cada coluna acende de cima pra baixo
                    let col = (x * 16.0).floor();
                    let phase = (ts * 0.8 + col * 0.37).fract();
                    let d = (y - phase).abs();
                    let k = (1.0 - d * 4.0).max(0.0);
                    mix([0, 0, 0], p.color_a, k)
                }
                Kind::Stars => {
                    if self.rand() < 0.012 * p.speed {
                        self.state[i] = 1.0;
                    }
                    self.state[i] = (self.state[i] - dt * 0.9 * p.speed).max(0.0);
                    mix(p.color_b, p.color_a, self.state[i])
                }
            };
            out[i] = to_u8(c, p.brightness);
        }
        out
    }
}

/// Barra que vai de verde a vermelho conforme `level` (0..1) sobre `slots` teclas.
fn bar(out: &mut Frame, slots: &[usize], level: f32, bright: f32) {
    let n = slots.len() as f32;
    for (j, &i) in slots.iter().enumerate() {
        let pos = (j as f32 + 0.5) / n;
        let on = pos <= level.clamp(0.0, 1.0) + 0.5 / n * 0.999;
        let c = if pos < 0.6 {
            mix([40, 220, 90], [255, 200, 0], pos / 0.6)
        } else {
            mix([255, 200, 0], [255, 30, 40], (pos - 0.6) / 0.4)
        };
        out[i] = if on { to_u8(c, bright) } else { to_u8(c, bright * 0.06) };
    }
}

/// Medidor: uso de CPU na fileira de números (1..0) e de RAM nas teclas F1..F12.
pub fn meter(cpu: f32, ram: f32, base: [u8; 3], bright: f32) -> Frame {
    let ks = keys();
    let mut out = [to_u8(mix(base, base, 0.0), bright * 0.25); KEY_COUNT];
    let find = |labels: &[&str], row: u8| -> Vec<usize> {
        labels
            .iter()
            .filter_map(|l| ks.iter().position(|k| k.row == row && k.label == *l))
            .collect()
    };
    let cpu_keys = find(&["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"], 1);
    let ram_keys = find(&["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"], 0);
    bar(&mut out, &cpu_keys, cpu, bright);
    bar(&mut out, &ram_keys, ram, bright);
    out
}

// ------------------------------------------------------------------ música

pub const BANDS: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MusicStyle {
    /// Barras do equalizador subindo de baixo para cima, uma por coluna.
    Spectrum,
    /// O teclado inteiro pulsa com a batida, trocando de cor.
    Pulse,
    /// Cada coluna tem uma cor do arco-íris e brilha conforme sua frequência.
    Rainbow,
    /// Onda que sai do centro a cada batida.
    Ripple,
}

impl MusicStyle {
    pub fn parse(s: &str) -> Self {
        match s {
            "pulse" => Self::Pulse,
            "rainbow" => Self::Rainbow,
            "ripple" => Self::Ripple,
            _ => Self::Spectrum,
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct AudioFrame {
    /// 0..1 por banda, graves → agudos.
    pub bands: [f32; BANDS],
    /// Volume geral 0..1.
    pub level: f32,
    /// Intensidade da batida 0..1 (decai rápido).
    pub beat: f32,
}

pub struct MusicFx {
    keys: Vec<Key>,
    hue: f32,
    ripples: Vec<(f32, f32)>, // (instante, força)
    last_beat: f32,
}

impl Default for MusicFx {
    fn default() -> Self {
        Self::new()
    }
}

impl MusicFx {
    pub fn new() -> Self {
        Self { keys: keys(), hue: 0.0, ripples: vec![], last_beat: 0.0 }
    }

    pub fn frame(&mut self, style: MusicStyle, a: &AudioFrame, color_a: [u8; 3], color_b: [u8; 3], bright: f32, t: f32) -> Frame {
        let mut out = [[0u8; 3]; KEY_COUNT];
        let rising = a.beat > 0.55 && self.last_beat <= 0.55;
        self.last_beat = a.beat;
        if rising {
            self.hue = (self.hue + 0.13) % 1.0;
            self.ripples.push((t, a.beat));
        }
        self.ripples.retain(|(t0, _)| t - t0 < 1.2);
        for (i, k) in self.keys.iter().enumerate() {
            let (x, y) = k.center();
            let band = ((x * BANDS as f32) as usize).min(BANDS - 1);
            let v = a.bands[band].clamp(0.0, 1.0);
            let c = match style {
                MusicStyle::Spectrum => {
                    // linha 5 (base) acende primeiro, linha 0 (topo) por último
                    // altura a partir da base: ~0.08 na base .. ~0.92 no topo
                    let h = 1.0 - y;
                    let c = mix(color_a, color_b, h);
                    if v >= h * 0.95 {
                        c
                    } else {
                        c.map(|x| x * 0.04)
                    }
                }
                MusicStyle::Pulse => {
                    let k = (0.08 + a.level * 0.6 + a.beat * 0.6).min(1.0);
                    hsv(self.hue + x * 0.15, 1.0, k)
                }
                MusicStyle::Rainbow => hsv(x * 0.85 + t * 0.03, 1.0, (0.05 + v * 1.1).min(1.0)),
                MusicStyle::Ripple => {
                    let mut k: f32 = 0.04 + a.level * 0.25;
                    for (t0, f) in &self.ripples {
                        let r = (t - t0) * 0.9;
                        let d = ((x - 0.5) * 1.6).hypot(y - 0.5);
                        k += (1.0 - ((d - r).abs() * 7.0)).max(0.0) * f * (1.0 - (t - t0) / 1.2);
                    }
                    let c = mix(color_a, color_b, x);
                    c.map(|v| v * k.min(1.0))
                }
            };
            out[i] = to_u8(c, bright);
        }
        out
    }
}

/// Pomodoro: barra de progresso que atravessa o teclado. `progress` 0..1;
/// `flash` > 0 pisca tudo em branco na troca de fase.
pub fn pomodoro(progress: f32, color: [u8; 3], bright: f32, flash: f32) -> Frame {
    let ks = keys();
    let mut out = [[0u8; 3]; KEY_COUNT];
    for (i, k) in ks.iter().enumerate() {
        let (x, _) = k.center();
        let on = x <= progress.clamp(0.0, 1.0);
        let base = mix(color, color, 0.0);
        let c = if flash > 0.0 { mix(color, [255, 255, 255], flash) } else if on { base } else { base.map(|v| v * 0.06) };
        out[i] = to_u8(c, bright);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(kind: Kind) -> Params {
        Params { kind, speed: 1.0, color_a: [255, 0, 0], color_b: [0, 0, 255], brightness: 1.0, reverse: false }
    }

    #[test]
    fn all_effects_render() {
        for k in [Kind::RainbowWave, Kind::ColorCycle, Kind::Breath, Kind::Fire, Kind::Rain, Kind::Stars, Kind::Gradient, Kind::Aurora] {
            let mut e = Engine::new();
            for f in 0..30 {
                let fr = e.frame(&params(k), f as f32 * 0.1);
                assert_eq!(fr.len(), KEY_COUNT);
            }
        }
    }

    #[test]
    fn gradient_goes_from_a_to_b() {
        let mut e = Engine::new();
        let f = e.frame(&params(Kind::Gradient), 0.0);
        assert!(f[0][0] > 200 && f[0][2] < 60); // Esc ~ vermelho
        assert!(f[80][2] > 150); // seta direita ~ azul
    }

    #[test]
    fn meter_lights_proportionally() {
        let f = meter(0.5, 1.0, [0, 0, 0], 1.0);
        let ks = keys();
        let one = ks.iter().position(|k| k.label == "1").unwrap();
        let zero = ks.iter().position(|k| k.label == "0" && k.row == 1).unwrap();
        let sum = |c: [u8; 3]| c.iter().map(|&v| v as u32).sum::<u32>();
        assert!(sum(f[one]) > 100);
        assert!(sum(f[zero]) < 40);
        let f12 = ks.iter().position(|k| k.label == "F12").unwrap();
        assert!(sum(f[f12]) > 100);
    }

    #[test]
    fn spectrum_bars_rise_from_bottom() {
        let mut fx = MusicFx::new();
        let mut a = AudioFrame::default();
        a.bands = [0.5; BANDS];
        let f = fx.frame(MusicStyle::Spectrum, &a, [0, 255, 0], [255, 0, 0], 1.0, 0.0);
        let ks = keys();
        let sum = |c: [u8; 3]| c.iter().map(|&v| v as u32).sum::<u32>();
        let space = ks.iter().position(|k| k.label == "Space").unwrap();
        let esc = ks.iter().position(|k| k.label == "Esc").unwrap();
        assert!(sum(f[space]) > 150, "base acesa");
        assert!(sum(f[esc]) < 30, "topo apagado");
        a.bands = [1.0; BANDS];
        let f = fx.frame(MusicStyle::Spectrum, &a, [0, 255, 0], [255, 0, 0], 1.0, 0.1);
        assert!(sum(f[esc]) > 150, "tudo aceso no máximo");
    }

    #[test]
    fn music_styles_render_and_silence_is_dark() {
        for st in [MusicStyle::Spectrum, MusicStyle::Pulse, MusicStyle::Rainbow, MusicStyle::Ripple] {
            let mut fx = MusicFx::new();
            let f = fx.frame(st, &AudioFrame::default(), [255, 0, 0], [0, 0, 255], 1.0, 0.0);
            let total: u32 = f.iter().flat_map(|c| c.iter()).map(|&v| v as u32).sum();
            assert!(total < 81 * 3 * 70, "{st:?} deveria ficar escuro no silêncio");
        }
    }

    #[test]
    fn pomodoro_progress() {
        let f = pomodoro(0.5, [255, 0, 0], 1.0, 0.0);
        assert!(f[0][0] > 200); // Esc (esquerda) aceso
        assert!(f[13][0] < 30); // Del (direita) apagado
        let f = pomodoro(0.1, [255, 0, 0], 1.0, 1.0);
        assert!(f.iter().all(|c| c[1] > 200)); // flash branco
    }

    #[test]
    fn brightness_zero_is_black() {
        let mut e = Engine::new();
        let mut p = params(Kind::RainbowWave);
        p.brightness = 0.0;
        assert!(e.frame(&p, 1.0).iter().all(|c| *c == [0, 0, 0]));
    }
}
