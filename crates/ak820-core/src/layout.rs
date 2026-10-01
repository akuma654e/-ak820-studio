//! Layout físico das 81 teclas com LED (ANSI) e os IDs usados pelo firmware
//! na transferência de RGB por tecla.
//!
//! Ordem e IDs capturados do driver oficial (CraigSDel/ajazz-ak820-config, MIT).

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Key {
    /// ID da tecla no protocolo de RGB por tecla.
    pub device_id: u8,
    pub label: &'static str,
    pub row: u8,
    /// Posição horizontal do canto esquerdo, em unidades de tecla.
    pub x: f32,
    pub w: f32,
}

impl Key {
    /// Centro normalizado (0..1, 0..1) no teclado.
    pub fn center(&self) -> (f32, f32) {
        ((self.x + self.w / 2.0) / WIDTH_UNITS, (self.row as f32 + 0.5) / ROWS as f32)
    }
}

pub const KEY_COUNT: usize = 81;
pub const ROWS: usize = 6;
pub const WIDTH_UNITS: f32 = 17.0;

/// `(label, largura)`; rótulo começando com `_` é um espaço vazio.
const ROW_SPEC: [&[(&str, f32)]; ROWS] = [
    &[
        ("Esc", 1.0), ("_", 0.35), ("F1", 1.0), ("F2", 1.0), ("F3", 1.0), ("F4", 1.0), ("_", 0.25),
        ("F5", 1.0), ("F6", 1.0), ("F7", 1.0), ("F8", 1.0), ("_", 0.25), ("F9", 1.0), ("F10", 1.0),
        ("F11", 1.0), ("F12", 1.0), ("_", 0.15), ("Del", 1.0),
    ],
    &[
        ("`", 1.0), ("1", 1.0), ("2", 1.0), ("3", 1.0), ("4", 1.0), ("5", 1.0), ("6", 1.0), ("7", 1.0),
        ("8", 1.0), ("9", 1.0), ("0", 1.0), ("-", 1.0), ("=", 1.0), ("Backspace", 2.0), ("_", 0.75),
        ("Home", 1.0),
    ],
    &[
        ("Tab", 1.5), ("Q", 1.0), ("W", 1.0), ("E", 1.0), ("R", 1.0), ("T", 1.0), ("Y", 1.0), ("U", 1.0),
        ("I", 1.0), ("O", 1.0), ("P", 1.0), ("[", 1.0), ("]", 1.0), ("\\", 1.5), ("_", 0.75),
        ("PgUp", 1.0),
    ],
    &[
        ("Caps", 1.75), ("A", 1.0), ("S", 1.0), ("D", 1.0), ("F", 1.0), ("G", 1.0), ("H", 1.0),
        ("J", 1.0), ("K", 1.0), ("L", 1.0), (";", 1.0), ("'", 1.0), ("Enter", 2.25), ("_", 0.75),
        ("PgDn", 1.0),
    ],
    &[
        ("Shift", 2.25), ("Z", 1.0), ("X", 1.0), ("C", 1.0), ("V", 1.0), ("B", 1.0), ("N", 1.0),
        ("M", 1.0), (",", 1.0), (".", 1.0), ("/", 1.0), ("Shift", 1.75), ("_", 0.2), ("Up", 1.0),
    ],
    &[
        ("Ctrl", 1.25), ("Win", 1.25), ("Alt", 1.25), ("Space", 6.25), ("AltGr", 1.25), ("Fn", 1.25),
        ("Ctrl", 1.25), ("_", 0.2), ("Left", 1.0), ("Down", 1.0), ("Right", 1.0),
    ],
];

pub const DEVICE_KEY_IDS: [u8; KEY_COUNT] = [
    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x77, 0x13, 0x14,
    0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x67, 0x75, 0x25, 0x26, 0x27,
    0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x43, 0x76, 0x37, 0x38, 0x39, 0x3a,
    0x3b, 0x3c, 0x3d, 0x3e, 0x3f, 0x40, 0x41, 0x42, 0x55, 0x79, 0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e,
    0x4f, 0x50, 0x51, 0x52, 0x53, 0x54, 0x65, 0x5b, 0x5c, 0x5d, 0x5e, 0x5f, 0x60, 0x62, 0x63, 0x64,
    0x66,
];

/// Lista das 81 teclas na ordem do protocolo (linha a linha, da esquerda para a direita).
pub fn keys() -> Vec<Key> {
    let mut out = Vec::with_capacity(KEY_COUNT);
    for (row, spec) in ROW_SPEC.iter().enumerate() {
        let mut x = 0.0;
        for &(label, w) in spec.iter() {
            if label != "_" {
                let i = out.len();
                out.push(Key { device_id: DEVICE_KEY_IDS[i], label, row: row as u8, x, w });
            }
            x += w;
        }
    }
    debug_assert_eq!(out.len(), KEY_COUNT);
    out
}

/// Índices (na ordem do protocolo) das teclas de uma linha.
pub fn row_indices(row: u8) -> Vec<usize> {
    keys().iter().enumerate().filter(|(_, k)| k.row == row).map(|(i, _)| i).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn has_81_keys_with_unique_ids() {
        let k = keys();
        assert_eq!(k.len(), 81);
        let mut ids: Vec<u8> = k.iter().map(|k| k.device_id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), 81);
        assert_eq!(k[0].label, "Esc");
        assert_eq!(k[13].label, "Del");
        assert_eq!(k[80].label, "Right");
    }

    #[test]
    fn rows_fit_width() {
        for k in keys() {
            assert!(k.x + k.w <= WIDTH_UNITS + 0.01, "{} passa da largura", k.label);
        }
    }
}
