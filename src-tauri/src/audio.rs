//! Captura do som do PC (WASAPI loopback no Windows) e análise de espectro.
//!
//! No Windows, abrir um stream de *entrada* no dispositivo de *saída* padrão
//! liga o modo loopback: ouvimos exatamente o que está tocando, sem precisar
//! de "mixagem estéreo" nem cabo virtual.

use ak820_core::effects::{AudioFrame, BANDS};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use realfft::{RealFftPlanner, RealToComplex};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

const FFT_SIZE: usize = 2048;
const MIN_HZ: f32 = 40.0;
const MAX_HZ: f32 = 16_000.0;

struct Shared {
    samples: VecDeque<f32>,
}

pub struct Audio {
    shared: Arc<Mutex<Shared>>,
    stop: Arc<AtomicBool>,
    pub device: String,
    rate: f32,
    fft: Arc<dyn RealToComplex<f32>>,
    window: Vec<f32>,
    smooth: [f32; BANDS],
    peak: [f32; BANDS],
    level_peak: f32,
    level: f32,
    bass_avg: f32,
    beat: f32,
}

fn push_mono<T: Copy>(shared: &Arc<Mutex<Shared>>, data: &[T], channels: usize, conv: impl Fn(T) -> f32) {
    let mut s = shared.lock().unwrap();
    for frame in data.chunks(channels.max(1)) {
        let v = frame.iter().map(|&x| conv(x)).sum::<f32>() / frame.len() as f32;
        s.samples.push_back(v);
    }
    let excess = s.samples.len().saturating_sub(FFT_SIZE * 2);
    s.samples.drain(..excess);
}

impl Audio {
    /// Começa a capturar. O stream vive numa thread própria até `Audio` ser descartado.
    pub fn start() -> Result<Self, String> {
        let shared = Arc::new(Mutex::new(Shared { samples: VecDeque::with_capacity(FFT_SIZE * 2) }));
        let stop = Arc::new(AtomicBool::new(false));
        let (tx, rx) = mpsc::channel::<Result<(String, f32), String>>();
        {
            let shared = shared.clone();
            let stop = stop.clone();
            thread::spawn(move || {
                let built = build_stream(shared);
                match built {
                    Ok((stream, name, rate)) => {
                        if let Err(e) = stream.play() {
                            let _ = tx.send(Err(format!("não foi possível iniciar o áudio: {e}")));
                            return;
                        }
                        let _ = tx.send(Ok((name, rate)));
                        while !stop.load(Ordering::Relaxed) {
                            thread::sleep(Duration::from_millis(100));
                        }
                        drop(stream);
                    }
                    Err(e) => {
                        let _ = tx.send(Err(e));
                    }
                }
            });
        }
        let (device, rate) = rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "o áudio demorou demais para iniciar".to_string())??;
        Ok(Self::with_shared(shared, stop, device, rate))
    }

    fn with_shared(shared: Arc<Mutex<Shared>>, stop: Arc<AtomicBool>, device: String, rate: f32) -> Self {
        let fft = RealFftPlanner::<f32>::new().plan_fft_forward(FFT_SIZE);
        let window = (0..FFT_SIZE).map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / FFT_SIZE as f32).cos()).collect();
        Self {
            shared,
            stop,
            device,
            rate,
            fft,
            window,
            smooth: [0.0; BANDS],
            peak: [0.05; BANDS],
            level_peak: 0.05,
            level: 0.0,
            bass_avg: 0.0,
            beat: 0.0,
        }
    }

    /// Calcula o quadro de áudio atual (chamar ~10–30×/s). `sensitivity` 0.5..2.
    pub fn frame(&mut self, sensitivity: f32) -> AudioFrame {
        let taken: Option<Vec<f32>> = {
            let s = self.shared.lock().unwrap();
            let n = s.samples.len();
            (n >= FFT_SIZE).then(|| s.samples.iter().skip(n - FFT_SIZE).copied().collect())
        };
        let Some(mut buf) = taken else {
            return self.decay();
        };
        let rms = (buf.iter().map(|v| v * v).sum::<f32>() / FFT_SIZE as f32).sqrt();
        for (v, w) in buf.iter_mut().zip(&self.window) {
            *v *= w;
        }
        let mut spec = self.fft.make_output_vec();
        if self.fft.process(&mut buf, &mut spec).is_err() {
            return self.decay();
        }
        let bin_hz = self.rate / FFT_SIZE as f32;
        let mut raw = [0f32; BANDS];
        for (b, slot) in raw.iter_mut().enumerate() {
            let lo = MIN_HZ * (MAX_HZ / MIN_HZ).powf(b as f32 / BANDS as f32);
            let hi = MIN_HZ * (MAX_HZ / MIN_HZ).powf((b + 1) as f32 / BANDS as f32);
            let (i0, i1) = (((lo / bin_hz) as usize).max(1), ((hi / bin_hz) as usize).max(2));
            let i1 = i1.min(spec.len() - 1).max(i0 + 1);
            let mag = spec[i0..i1].iter().map(|c| c.norm()).fold(0.0f32, f32::max);
            // compensa a queda natural de energia nos agudos
            *slot = mag * (1.0 + b as f32 * 0.35);
        }
        let sens = sensitivity.clamp(0.3, 3.0);
        let mut out = AudioFrame::default();
        for b in 0..BANDS {
            // ganho automático por banda (pico que decai devagar)...
            self.peak[b] = (self.peak[b] * 0.995).max(raw[b]).max(0.02);
        }
        // ...limitado pelo pico geral, para bandas quase mudas não "explodirem"
        let global = self.peak.iter().cloned().fold(0.0f32, f32::max);
        for b in 0..BANDS {
            let norm = (raw[b] / self.peak[b].max(global * 0.3) * sens).clamp(0.0, 1.0);
            let s = &mut self.smooth[b];
            *s = if norm > *s { *s + (norm - *s) * 0.7 } else { *s * 0.82 };
            out.bands[b] = *s;
        }
        self.level_peak = (self.level_peak * 0.997).max(rms).max(0.01);
        let lv = (rms / self.level_peak * sens).clamp(0.0, 1.0);
        self.level = if lv > self.level { lv } else { self.level * 0.85 };
        out.level = if rms < 0.0005 { 0.0 } else { self.level };
        // batida: graves acima da média recente
        let bass = (raw[0] + raw[1] + raw[2]) / 3.0;
        self.bass_avg = self.bass_avg * 0.92 + bass * 0.08;
        if bass > self.bass_avg * 1.5 && bass > 0.01 {
            self.beat = 1.0;
        } else {
            self.beat *= 0.8;
        }
        out.beat = if rms < 0.0005 { 0.0 } else { self.beat };
        if rms < 0.0005 {
            out.bands = [0.0; BANDS];
        }
        out
    }

    fn decay(&mut self) -> AudioFrame {
        let mut out = AudioFrame::default();
        for b in 0..BANDS {
            self.smooth[b] *= 0.8;
            out.bands[b] = self.smooth[b];
        }
        self.level *= 0.8;
        self.beat *= 0.8;
        out.level = self.level;
        out.beat = self.beat;
        out
    }
}

impl Drop for Audio {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

fn build_stream(shared: Arc<Mutex<Shared>>) -> Result<(cpal::Stream, String, f32), String> {
    let host = cpal::default_host();
    let mut errors = vec![];
    // 1º: loopback do dispositivo de saída (Windows); 2º: microfone/entrada padrão.
    let candidates: Vec<(cpal::Device, bool)> = host
        .default_output_device()
        .map(|d| (d, true))
        .into_iter()
        .chain(host.default_input_device().map(|d| (d, false)))
        .collect();
    for (device, is_output) in candidates {
        let name = device.name().unwrap_or_else(|_| "dispositivo de áudio".into());
        let cfg = if is_output { device.default_output_config() } else { device.default_input_config() };
        let cfg = match cfg {
            Ok(c) => c,
            Err(e) => {
                errors.push(format!("{name}: {e}"));
                continue;
            }
        };
        let channels = cfg.channels() as usize;
        let rate = cfg.sample_rate().0 as f32;
        let format = cfg.sample_format();
        let config: cpal::StreamConfig = cfg.into();
        let err_fn = |e| eprintln!("erro no stream de áudio: {e}");
        let sh = shared.clone();
        let stream = match format {
            cpal::SampleFormat::F32 => device.build_input_stream(&config, move |d: &[f32], _: &_| push_mono(&sh, d, channels, |x| x), err_fn, None),
            cpal::SampleFormat::I16 => device.build_input_stream(&config, move |d: &[i16], _: &_| push_mono(&sh, d, channels, |x| x as f32 / 32768.0), err_fn, None),
            cpal::SampleFormat::U16 => device.build_input_stream(&config, move |d: &[u16], _: &_| push_mono(&sh, d, channels, |x| (x as f32 - 32768.0) / 32768.0), err_fn, None),
            cpal::SampleFormat::I32 => device.build_input_stream(&config, move |d: &[i32], _: &_| push_mono(&sh, d, channels, |x| x as f32 / 2147483648.0), err_fn, None),
            other => {
                errors.push(format!("{name}: formato {other:?} não suportado"));
                continue;
            }
        };
        match stream {
            Ok(s) => return Ok((s, if is_output { format!("{name} (som do PC)") } else { format!("{name} (entrada)") }, rate)),
            Err(e) => errors.push(format!("{name}: {e}")),
        }
    }
    Err(format!("nenhum dispositivo de áudio disponível ({})", errors.join("; ")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn analyzer_with(f: impl Fn(f32) -> f32) -> Audio {
        let rate = 48_000.0;
        let samples: VecDeque<f32> = (0..FFT_SIZE * 2).map(|i| f(i as f32 / rate)).collect();
        Audio::with_shared(Arc::new(Mutex::new(Shared { samples })), Arc::new(AtomicBool::new(false)), "teste".into(), rate)
    }

    #[test]
    fn bass_tone_lights_low_bands() {
        let mut a = analyzer_with(|t| (t * 60.0 * std::f32::consts::TAU).sin() * 0.5);
        let mut f = a.frame(1.0);
        for _ in 0..5 {
            f = a.frame(1.0);
        }
        let low = f.bands[..2].iter().cloned().fold(0.0, f32::max);
        let high = f.bands[12..].iter().cloned().fold(0.0, f32::max);
        assert!(low > 0.5, "grave deveria acender: {:?}", f.bands);
        assert!(high < low * 0.6, "agudos deveriam ficar baixos: {:?}", f.bands);
        assert!(f.level > 0.3);
    }

    #[test]
    fn treble_tone_lights_high_bands() {
        let mut a = analyzer_with(|t| (t * 8000.0 * std::f32::consts::TAU).sin() * 0.5);
        let f = a.frame(1.0);
        let idx = f.bands.iter().enumerate().max_by(|x, y| x.1.partial_cmp(y.1).unwrap()).unwrap().0;
        assert!(idx >= 10, "pico deveria estar nos agudos, ficou na banda {idx}: {:?}", f.bands);
    }

    #[test]
    fn silence_is_zero() {
        let mut a = analyzer_with(|_| 0.0);
        let f = a.frame(1.0);
        assert_eq!(f.level, 0.0);
        assert!(f.bands.iter().all(|&b| b == 0.0));
    }
}
