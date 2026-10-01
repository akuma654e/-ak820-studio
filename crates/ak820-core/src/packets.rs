//! Construtores de pacotes de 64 bytes do AK820 Pro.
//!
//! Todos os pacotes aqui são o conteúdo "cru" do relatório (64 bytes). O
//! relatório HID real não usa Report ID numerado, então a camada de transporte
//! deve prefixar `0x00` antes de chamar o hidapi.
//!
//! Layout baseado no driver oficial de Windows (framing "AKS075"), conforme
//! documentado e testado em hardware pelos projetos MIT
//! CraigSDel/ajazz-ak820-config e aar-rafi/aks075-linux.

pub const PACKET_LEN: usize = 64;
pub type Packet = [u8; PACKET_LEN];

pub const PREFIX: u8 = 0x04;
pub const CMD_SAVE: u8 = 0x02;
pub const CMD_MODE: u8 = 0x13;
pub const CMD_SLEEP: u8 = 0x17;
pub const CMD_START: u8 = 0x18;
pub const CMD_TIME: u8 = 0x28;
pub const CMD_IMAGE: u8 = 0x72;
pub const CMD_FINISH: u8 = 0xF0;

const ENABLE_INDEX: usize = 8;

/// Pacote de controle genérico: `04 cmd 00 .. (byte 8 = enable)`.
pub fn control(cmd: u8, enable: u8) -> Packet {
    let mut p = [0u8; PACKET_LEN];
    p[0] = PREFIX;
    p[1] = cmd;
    p[ENABLE_INDEX] = enable;
    p
}

pub fn start(enable: bool) -> Packet {
    control(CMD_START, enable as u8)
}

pub fn save() -> Packet {
    control(CMD_SAVE, 0)
}

pub fn finish() -> Packet {
    control(CMD_FINISH, 1)
}

// ---------------------------------------------------------------- relógio

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DateTime {
    pub year: u16,
    pub month: u8,
    pub day: u8,
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
}

pub fn time_preamble() -> Packet {
    control(CMD_TIME, 1)
}

/// `00 01 5A YY MM DD hh mm ss 00 04 ... AA 55`
pub fn time_data(dt: DateTime) -> Packet {
    let mut p = [0u8; PACKET_LEN];
    p[0] = 0x00;
    p[1] = 0x01;
    p[2] = 0x5A;
    p[3] = dt.year.saturating_sub(2000).min(255) as u8;
    p[4] = dt.month;
    p[5] = dt.day;
    p[6] = dt.hour;
    p[7] = dt.minute;
    p[8] = dt.second;
    p[9] = 0x00;
    p[10] = 0x04;
    p[62] = 0xAA;
    p[63] = 0x55;
    p
}

// ---------------------------------------------------------------- RGB

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Lighting {
    /// 0 = desligado, 1..=19 = efeitos.
    pub mode: u8,
    pub red: u8,
    pub green: u8,
    pub blue: u8,
    pub rainbow: bool,
    /// 0..=5
    pub brightness: u8,
    /// 0..=5
    pub speed: u8,
    /// 0 = esquerda, 1 = baixo, 2 = cima, 3 = direita
    pub direction: u8,
}

pub const MAX_MODE: u8 = 19;
pub const MAX_LEVEL: u8 = 5;

impl Lighting {
    pub fn validate(&self) -> Result<(), String> {
        if self.mode > MAX_MODE {
            return Err(format!("modo de iluminação inválido: {}", self.mode));
        }
        if self.brightness > MAX_LEVEL || self.speed > MAX_LEVEL {
            return Err("brilho e velocidade vão de 0 a 5".into());
        }
        if self.direction > 3 {
            return Err(format!("direção inválida: {}", self.direction));
        }
        Ok(())
    }
}

pub fn mode_preamble() -> Packet {
    control(CMD_MODE, 1)
}

/// Pacote de dados do efeito. O primeiro byte é o próprio número do modo.
pub fn lighting_data(l: &Lighting) -> Packet {
    let off = l.mode == 0;
    let mut p = [0u8; PACKET_LEN];
    p[0] = l.mode;
    p[1] = l.red;
    p[2] = l.green;
    p[3] = l.blue;
    p[8] = l.rainbow as u8;
    p[9] = if off { 0 } else { l.brightness.min(MAX_LEVEL) };
    p[10] = if off { 0 } else { l.speed.min(MAX_LEVEL) };
    p[11] = l.direction.min(3);
    p[14] = 0x55;
    p[15] = 0xAA;
    p
}

// ---------------------------------------------------------------- suspensão

/// 0 = nunca, 1 = 1 min, 2 = 5 min, 3 = 30 min
pub fn sleep_preamble() -> Packet {
    let mut p = control(CMD_SLEEP, 1);
    p[2] = 0x01;
    p
}

pub fn sleep_data(value: u8) -> Packet {
    let mut p = [0u8; PACKET_LEN];
    p[ENABLE_INDEX] = value.min(3);
    p[62] = 0xAA;
    p[63] = 0x55;
    p
}

// ---------------------------------------------------------------- RGB por tecla

pub const CMD_CUSTOM_LED: u8 = 0x20;
const CUSTOM_TABLES: usize = 8;

/// Transação de RGB por tecla: `04 20 (byte 8 = 8)`, 8 tabelas com registros
/// `[id da tecla, R, G, B]` (16 por pacote; as 2 últimas tabelas vão zeradas)
/// e o commit `04 02`.
///
/// O firmware volta ao efeito salvo se a tabela não for reenviada
/// continuamente (~10 vezes por segundo).
pub fn custom_led(colors: &[[u8; 3]; crate::layout::KEY_COUNT]) -> Vec<Packet> {
    let mut out = Vec::with_capacity(CUSTOM_TABLES + 2);
    out.push(control(CMD_CUSTOM_LED, CUSTOM_TABLES as u8));
    let mut tables = [[0u8; PACKET_LEN]; CUSTOM_TABLES];
    for (i, c) in colors.iter().enumerate() {
        let t = &mut tables[i / 16];
        let o = (i % 16) * 4;
        t[o] = crate::layout::DEVICE_KEY_IDS[i];
        t[o + 1] = c[0];
        t[o + 2] = c[1];
        t[o + 3] = c[2];
    }
    out.extend(tables);
    out.push(control(CMD_SAVE, 0));
    out
}

// ---------------------------------------------------------------- imagem

pub fn image_start() -> Packet {
    start(false)
}

pub fn image_cfg(chunk_count: u16) -> Packet {
    let mut p = control(CMD_IMAGE, 0);
    p[2] = 0x03;
    p[8] = (chunk_count & 0xFF) as u8;
    p[9] = (chunk_count >> 8) as u8;
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(p: &[u8]) -> String {
        p.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(" ")
    }

    #[test]
    fn time_packet_matches_documented_example() {
        // Exemplo de protocol-notes.md: 2026-05-16 14:30:45
        let p = time_data(DateTime { year: 2026, month: 5, day: 16, hour: 14, minute: 30, second: 45 });
        assert_eq!(hex(&p[..11]), "00 01 5A 1A 05 10 0E 1E 2D 00 04");
        assert!(p[11..62].iter().all(|&b| b == 0));
        assert_eq!(&p[62..], &[0xAA, 0x55]);
    }

    #[test]
    fn control_packets() {
        assert_eq!(hex(&start(true)[..9]), "04 18 00 00 00 00 00 00 01");
        assert_eq!(hex(&image_start()[..9]), "04 18 00 00 00 00 00 00 00");
        assert_eq!(hex(&time_preamble()[..9]), "04 28 00 00 00 00 00 00 01");
        assert_eq!(hex(&save()[..9]), "04 02 00 00 00 00 00 00 00");
        assert_eq!(hex(&finish()[..9]), "04 F0 00 00 00 00 00 00 01");
        assert_eq!(hex(&mode_preamble()[..9]), "04 13 00 00 00 00 00 00 01");
        assert_eq!(hex(&sleep_preamble()[..9]), "04 17 01 00 00 00 00 00 01");
    }

    #[test]
    fn image_cfg_little_endian_count() {
        let p = image_cfg(9);
        assert_eq!(hex(&p[..10]), "04 72 03 00 00 00 00 00 09 00");
        let p = image_cfg(0x0123);
        assert_eq!((p[8], p[9]), (0x23, 0x01));
    }

    #[test]
    fn lighting_layout() {
        let l = Lighting { mode: 7, red: 0x11, green: 0x22, blue: 0x33, rainbow: true, brightness: 4, speed: 2, direction: 3 };
        let p = lighting_data(&l);
        assert_eq!(hex(&p[..16]), "07 11 22 33 00 00 00 00 01 04 02 03 00 00 55 AA");
        let off = lighting_data(&Lighting { mode: 0, ..l });
        assert_eq!((off[9], off[10]), (0, 0));
    }

    #[test]
    fn custom_led_layout() {
        let mut colors = [[0u8; 3]; crate::layout::KEY_COUNT];
        colors[0] = [1, 2, 3];
        colors[80] = [9, 8, 7];
        let p = custom_led(&colors);
        assert_eq!(p.len(), 10);
        assert_eq!(hex(&p[0][..9]), "04 20 00 00 00 00 00 00 08");
        assert_eq!(&p[1][..4], &[0x01, 1, 2, 3]);
        // tecla 80 = 6º pacote de tabela (índice 80/16 = 5), posição 0
        assert_eq!(&p[6][..4], &[0x66, 9, 8, 7]);
        assert!(p[7].iter().all(|&b| b == 0) && p[8].iter().all(|&b| b == 0));
        assert_eq!(hex(&p[9][..2]), "04 02");
    }

    #[test]
    fn sleep_layout() {
        let p = sleep_data(2);
        assert_eq!(p[0], 0);
        assert_eq!(p[8], 2);
        assert_eq!(&p[62..], &[0xAA, 0x55]);
    }
}
