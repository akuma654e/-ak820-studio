//! Transmissão contínua de RGB por tecla (pintura, efeitos do PC e medidor).
//!
//! O firmware só mantém as cores enquanto a tabela é reenviada; ao parar,
//! o teclado volta sozinho ao efeito salvo.

use crate::audio::Audio;
use crate::hid::HidTransport;
use crate::screen::Capturer;
use crate::state::{log, notify, AppState};
use crate::store::{parse_hex, StreamConfig};
use ak820_core::effects::{meter, pomodoro, Engine, Frame, Kind, MusicFx, MusicStyle, Params};
use ak820_core::layout::KEY_COUNT;
use ak820_core::ops;
use std::thread;
use std::time::{Duration, Instant};
use sysinfo::System;
use tauri::{AppHandle, Manager};

const FRAME_MS: u64 = 100;

fn paint_frame(cfg: &StreamConfig) -> Frame {
    let mut f = [[0u8; 3]; KEY_COUNT];
    let b = cfg.brightness.clamp(0.0, 1.0);
    for (i, c) in cfg.colors.iter().take(KEY_COUNT).enumerate() {
        if let Some(rgb) = parse_hex(c) {
            f[i] = rgb.map(|v| (v as f32 * b).round() as u8);
        }
    }
    f
}

fn params(cfg: &StreamConfig) -> Params {
    Params {
        kind: Kind::parse(&cfg.effect).unwrap_or(Kind::RainbowWave),
        speed: cfg.speed.clamp(0.1, 4.0),
        color_a: parse_hex(&cfg.color_a).unwrap_or([139, 108, 255]),
        color_b: parse_hex(&cfg.color_b).unwrap_or([0, 229, 255]),
        brightness: cfg.brightness.clamp(0.0, 1.0),
        reverse: cfg.reverse,
    }
}

pub fn start(app: AppHandle) {
    thread::spawn(move || {
        let mut engine = Engine::new();
        let mut transport: Option<HidTransport> = None;
        let started = Instant::now();
        let mut sys = System::new();
        let mut last_sys: Option<Instant> = None;
        let (mut cpu, mut ram) = (0.0f32, 0.0f32);
        let mut failing = false;
        let mut audio: Option<Audio> = None;
        let mut audio_failed = false;
        let mut music = MusicFx::new();
        let mut capturer = Capturer::new();
        let mut ambi_prev: Option<Frame> = None;
        let mut ambi_failed = false;
        let mut pomo_phase: Option<bool> = None; // Some(true) = foco
        let mut pomo_flash_until: Option<Instant> = None;

        loop {
            let tick = Instant::now();
            let state = app.state::<AppState>();
            let cfg = state.stream.lock().unwrap().clone();
            let Some(cfg) = cfg else {
                transport = None;
                failing = false;
                audio = None;
                audio_failed = false;
                ambi_failed = false;
                pomo_phase = None;
                thread::sleep(Duration::from_millis(250));
                continue;
            };
            if cfg.mode != "music" {
                audio = None;
                audio_failed = false;
            }
            if cfg.mode != "ambilight" {
                ambi_prev = None;
                ambi_failed = false;
            }
            if cfg.mode != "pomodoro" {
                pomo_phase = None;
            }
            let bright = cfg.brightness.clamp(0.0, 1.0);
            let ca = parse_hex(&cfg.color_a).unwrap_or([139, 108, 255]);
            let cb = parse_hex(&cfg.color_b).unwrap_or([0, 229, 255]);

            let frame = match cfg.mode.as_str() {
                "paint" => paint_frame(&cfg),
                "meter" => {
                    if last_sys.map(|t| t.elapsed() >= Duration::from_millis(900)).unwrap_or(true) {
                        sys.refresh_cpu_usage();
                        sys.refresh_memory();
                        cpu = sys.global_cpu_usage() / 100.0;
                        let total = sys.total_memory().max(1) as f32;
                        ram = sys.used_memory() as f32 / total;
                        last_sys = Some(Instant::now());
                    }
                    meter(cpu, ram, parse_hex(&cfg.color_a).unwrap_or([60, 60, 80]), cfg.brightness.clamp(0.0, 1.0))
                }
                "music" => {
                    if audio.is_none() && !audio_failed {
                        match Audio::start() {
                            Ok(a) => {
                                log(&app, "info", format!("Visualizador ouvindo: {}", a.device));
                                audio = Some(a);
                            }
                            Err(e) => {
                                notify(&app, "error", format!("Visualizador de música: {e}"));
                                audio_failed = true;
                            }
                        }
                    }
                    let af = audio.as_mut().map(|a| a.frame(cfg.sensitivity)).unwrap_or_default();
                    music.frame(MusicStyle::parse(&cfg.music_style), &af, ca, cb, bright, started.elapsed().as_secs_f32())
                }
                "ambilight" => match capturer.frame(cfg.saturation) {
                    Ok(f) => {
                        // suaviza para não piscar
                        let out = match ambi_prev {
                            Some(p) => {
                                let mut o = f;
                                for i in 0..KEY_COUNT {
                                    for c in 0..3 {
                                        o[i][c] = ((p[i][c] as f32 * 0.45 + f[i][c] as f32 * 0.55) * bright) as u8;
                                    }
                                }
                                o
                            }
                            None => f.map(|c| c.map(|v| (v as f32 * bright) as u8)),
                        };
                        ambi_prev = Some(f);
                        out
                    }
                    Err(e) => {
                        if !ambi_failed {
                            notify(&app, "error", format!("Ambilight: {e}"));
                            ambi_failed = true;
                        }
                        thread::sleep(Duration::from_millis(900));
                        [[0u8; 3]; KEY_COUNT]
                    }
                },
                "pomodoro" => {
                    let work = cfg.work_min.max(1) as f32 * 60.0;
                    let rest = cfg.break_min.max(1) as f32 * 60.0;
                    let el = state.pomodoro_start.lock().unwrap().elapsed().as_secs_f32() % (work + rest);
                    let focus = el < work;
                    if pomo_phase.is_some() && pomo_phase != Some(focus) {
                        pomo_flash_until = Some(Instant::now() + Duration::from_millis(1800));
                        notify(&app, "info", if focus { "Pomodoro: hora de voltar ao foco!" } else { "Pomodoro: hora da pausa!" });
                    }
                    pomo_phase = Some(focus);
                    let flash = pomo_flash_until
                        .filter(|t| Instant::now() < *t)
                        .map(|t| {
                            let left = t.duration_since(Instant::now()).as_millis() as f32;
                            if (left / 300.0) as i32 % 2 == 0 { 1.0 } else { 0.0 }
                        })
                        .unwrap_or(0.0);
                    let (progress, color) = if focus { (el / work, ca) } else { ((el - work) / rest, cb) };
                    pomodoro(progress, color, bright, flash)
                }
                _ => engine.frame(&params(&cfg), started.elapsed().as_secs_f32()),
            };

            let result = {
                let _op = state.op.lock().unwrap();
                if transport.is_none() {
                    transport = state.with_api(|api| HidTransport::open(api, false)).ok().and_then(|r| r.ok());
                }
                match transport.as_mut() {
                    Some(t) => ops::set_custom_leds(t, &frame),
                    None => Err("teclado não conectado".into()),
                }
            };

            match result {
                Ok(()) => {
                    if failing {
                        log(&app, "info", "RGB por tecla retomado");
                    }
                    failing = false;
                    let spent = tick.elapsed();
                    if spent < Duration::from_millis(FRAME_MS) {
                        thread::sleep(Duration::from_millis(FRAME_MS) - spent);
                    }
                }
                Err(e) => {
                    transport = None;
                    if !failing {
                        log(&app, "error", format!("RGB por tecla pausado: {e}"));
                    }
                    failing = true;
                    thread::sleep(Duration::from_millis(1500));
                }
            }
        }
    });
}
