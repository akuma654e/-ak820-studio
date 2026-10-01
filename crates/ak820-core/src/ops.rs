//! Sequências de operações (transações) sobre um `Transport` abstrato.
//!
//! As regras de handshake e tempos seguem o que foi validado em hardware:
//! - 50 ms entre relatórios de controle, 100 ms depois do SAVE/FINISH;
//! - iluminação: leitura (GET_FEATURE) depois de START, PREAMBLE e FINISH;
//!   o pacote de dados só é confirmado para os modos 4, 7, 9, 11 e 13;
//!   a transação inteira é enviada duas vezes (o firmware às vezes ignora a 1ª);
//! - imagem: cada bloco de 4096 bytes precisa de um ACK `01 5A 02 00` na
//!   interface de dados antes do próximo. SAVE só depois de todos os ACKs.

use crate::image;
use crate::packets::{self, DateTime, Lighting, Packet};

pub const INTER_PACKET_MS: u64 = 50;
pub const POST_SAVE_MS: u64 = 100;
pub const LIGHTING_RETRY_MS: u64 = 150;
pub const ACK_TIMEOUT_MS: i32 = 600;
const ACK_RETRIES: usize = 2;

const MODE_DATA_HANDSHAKE: [u8; 5] = [0x04, 0x07, 0x09, 0x0B, 0x0D];

pub trait Transport {
    /// Envia um relatório de recurso (feature report) na interface de controle.
    fn send_feature(&mut self, packet: &Packet) -> Result<(), String>;
    /// Lê um relatório de recurso (handshake). Falhas não são fatais.
    fn get_feature(&mut self) -> Result<(), String>;
    /// Envia um bloco de dados (relatório de saída de 4096 bytes) na interface de dados.
    fn send_data(&mut self, chunk: &[u8]) -> Result<(), String>;
    /// Lê um relatório de entrada da interface de dados (ACK).
    fn read_data(&mut self, timeout_ms: i32) -> Result<Option<Vec<u8>>, String>;
    /// Descarta relatórios de entrada pendentes na interface de dados.
    fn drain_data(&mut self);
    fn sleep_ms(&mut self, ms: u64);
}

fn handshake<T: Transport>(t: &mut T) {
    let _ = t.get_feature();
}

pub fn sync_time<T: Transport>(t: &mut T, dt: DateTime) -> Result<(), String> {
    t.send_feature(&packets::start(true))?;
    t.sleep_ms(INTER_PACKET_MS);
    t.send_feature(&packets::time_preamble())?;
    handshake(t);
    t.send_feature(&packets::time_data(dt))?;
    t.sleep_ms(INTER_PACKET_MS);
    t.send_feature(&packets::save())?;
    handshake(t);
    t.sleep_ms(POST_SAVE_MS);
    Ok(())
}

pub fn set_lighting<T: Transport>(t: &mut T, l: &Lighting) -> Result<(), String> {
    l.validate()?;
    let reports = [
        packets::start(true),
        packets::mode_preamble(),
        packets::lighting_data(l),
        packets::finish(),
    ];
    for attempt in 0..2 {
        if attempt > 0 {
            t.sleep_ms(LIGHTING_RETRY_MS);
        }
        for (i, r) in reports.iter().enumerate() {
            t.send_feature(r)?;
            let needs = if i == 2 { MODE_DATA_HANDSHAKE.contains(&l.mode) } else { true };
            if needs {
                handshake(t);
            }
            t.sleep_ms(INTER_PACKET_MS);
        }
        t.sleep_ms(POST_SAVE_MS);
    }
    Ok(())
}

pub fn set_sleep<T: Transport>(t: &mut T, value: u8) -> Result<(), String> {
    if value > 3 {
        return Err("valor de suspensão inválido".into());
    }
    t.send_feature(&packets::start(true))?;
    handshake(t);
    t.sleep_ms(INTER_PACKET_MS);
    t.send_feature(&packets::sleep_preamble())?;
    handshake(t);
    t.sleep_ms(INTER_PACKET_MS);
    t.send_feature(&packets::sleep_data(value))?;
    t.sleep_ms(INTER_PACKET_MS);
    t.sleep_ms(POST_SAVE_MS);
    Ok(())
}

/// Envia um quadro de RGB por tecla (handshake só no início e no commit).
pub fn set_custom_leds<T: Transport>(t: &mut T, colors: &[[u8; 3]; crate::layout::KEY_COUNT]) -> Result<(), String> {
    for p in packets::custom_led(colors) {
        t.send_feature(&p)?;
        if p[0] == packets::PREFIX {
            handshake(t);
        }
    }
    Ok(())
}

pub fn is_image_ack(r: &[u8]) -> bool {
    // Sem report ID: 01 5A 02 00. Alguns backends incluem um 0x00 inicial.
    r.starts_with(&[0x01, 0x5A, 0x02, 0x00]) || r.starts_with(&[0x00, 0x01, 0x5A, 0x02])
}

/// Envia um payload já montado por [`image::build_payload`].
/// `progress(blocos_enviados, total)` é chamado após cada ACK.
pub fn upload_payload<T: Transport>(
    t: &mut T,
    payload: &[u8],
    mut progress: impl FnMut(usize, usize),
) -> Result<(), String> {
    if payload.is_empty() || payload.len() % image::CHUNK_SIZE != 0 {
        return Err("payload deve ser múltiplo de 4096 bytes".into());
    }
    let total = image::chunk_count(payload.len());
    if total > u16::MAX as usize {
        return Err("payload grande demais".into());
    }
    progress(0, total);

    t.send_feature(&packets::image_start())?;
    handshake(t);
    t.sleep_ms(INTER_PACKET_MS);
    t.send_feature(&packets::image_cfg(total as u16))?;
    handshake(t);
    t.drain_data();

    for (i, chunk) in payload.chunks(image::CHUNK_SIZE).enumerate() {
        t.send_data(chunk)?;
        let mut acked = false;
        for _ in 0..=ACK_RETRIES {
            match t.read_data(ACK_TIMEOUT_MS)? {
                Some(r) if is_image_ack(&r) => {
                    acked = true;
                    break;
                }
                Some(r) => {
                    return Err(format!(
                        "resposta inesperada no bloco {} de {}: {:02X?}",
                        i + 1,
                        total,
                        &r[..r.len().min(8)]
                    ))
                }
                None => continue,
            }
        }
        if !acked {
            return Err(format!(
                "o teclado não confirmou o bloco {} de {} (tempo esgotado)",
                i + 1,
                total
            ));
        }
        progress(i + 1, total);
    }

    t.sleep_ms(INTER_PACKET_MS);
    t.send_feature(&packets::save())?;
    handshake(t);
    t.sleep_ms(POST_SAVE_MS);
    Ok(())
}

pub fn upload_frames<T: Transport>(
    t: &mut T,
    frames: &[u8],
    delays_ms: &[u32],
    progress: impl FnMut(usize, usize),
) -> Result<(), String> {
    let payload = image::build_payload(frames, delays_ms)?;
    upload_payload(t, &payload, progress)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Mock {
        log: Vec<String>,
        acks: bool,
        fail_ack_at: Option<usize>,
        data_sent: usize,
    }

    impl Transport for Mock {
        fn send_feature(&mut self, p: &Packet) -> Result<(), String> {
            self.log.push(format!("F {:02X} {:02X}", p[0], p[1]));
            Ok(())
        }
        fn get_feature(&mut self) -> Result<(), String> {
            self.log.push("G".into());
            Ok(())
        }
        fn send_data(&mut self, c: &[u8]) -> Result<(), String> {
            assert_eq!(c.len(), 4096);
            self.data_sent += 1;
            self.log.push("D".into());
            Ok(())
        }
        fn read_data(&mut self, _t: i32) -> Result<Option<Vec<u8>>, String> {
            if self.fail_ack_at == Some(self.data_sent) {
                return Ok(None);
            }
            Ok(self.acks.then(|| vec![0x01, 0x5A, 0x02, 0x00, 0, 0]))
        }
        fn drain_data(&mut self) {}
        fn sleep_ms(&mut self, _ms: u64) {}
    }

    #[test]
    fn time_sequence() {
        let mut m = Mock::default();
        sync_time(&mut m, DateTime { year: 2026, month: 9, day: 30, hour: 21, minute: 0, second: 0 }).unwrap();
        assert_eq!(m.log, ["F 04 18", "F 04 28", "G", "F 00 01", "F 04 02", "G"]);
    }

    #[test]
    fn lighting_sequence_twice_with_scoped_handshake() {
        let base = Lighting { mode: 1, red: 255, green: 0, blue: 0, rainbow: false, brightness: 5, speed: 3, direction: 0 };
        let mut m = Mock::default();
        set_lighting(&mut m, &base).unwrap();
        let once = ["F 04 18", "G", "F 04 13", "G", "F 01 FF", "F 04 F0", "G"];
        assert_eq!(m.log, [once, once].concat());

        let mut m = Mock::default();
        set_lighting(&mut m, &Lighting { mode: 7, ..base }).unwrap();
        assert_eq!(&m.log[4..6], ["F 07 FF", "G"]);
    }

    #[test]
    fn upload_sequence() {
        let mut m = Mock { acks: true, ..Default::default() };
        let mut last = (0, 0);
        upload_frames(&mut m, &vec![0u8; image::FRAME_BYTES], &[], |a, b| last = (a, b)).unwrap();
        assert_eq!(last, (9, 9));
        assert_eq!(&m.log[..4], ["F 04 18", "G", "F 04 72", "G"]);
        assert_eq!(m.log.iter().filter(|l| *l == "D").count(), 9);
        assert_eq!(&m.log[m.log.len() - 2..], ["F 04 02", "G"]);
    }

    #[test]
    fn upload_aborts_without_save_on_missing_ack() {
        let mut m = Mock { acks: true, fail_ack_at: Some(3), ..Default::default() };
        let err = upload_frames(&mut m, &vec![0u8; image::FRAME_BYTES], &[], |_, _| {}).unwrap_err();
        assert!(err.contains("bloco 3 de 9"), "{err}");
        assert!(!m.log.iter().any(|l| l == "F 04 02"));
    }
}
