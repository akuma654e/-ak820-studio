//! Montagem do payload da tela TFT (128×128, RGB565 little-endian).
//!
//! ```text
//! [cabeçalho de 256 bytes] [quadro 0: 32768 B] [quadro 1] ... [0xFF até múltiplo de 4096]
//! cabeçalho: byte 0 = nº de quadros; byte 1+i = atraso do quadro i em unidades de 2 ms
//! ```

pub const WIDTH: usize = 128;
pub const HEIGHT: usize = 128;
pub const FRAME_BYTES: usize = WIDTH * HEIGHT * 2;
pub const HEADER_BYTES: usize = 256;
pub const CHUNK_SIZE: usize = 4096;
/// Limite físico do cabeçalho (1 byte para o número de quadros).
pub const MAX_FRAMES: usize = 255;
/// Limite usado pelo software oficial (XML do driver de Windows).
pub const RECOMMENDED_MAX_FRAMES: usize = 140;
/// Maior atraso representável: 255 × 2 ms.
pub const MAX_DELAY_MS: u32 = 510;

/// Converte um atraso em ms para a unidade do teclado (2 ms, mínimo 1).
pub fn delay_unit(ms: u32) -> u8 {
    (ms / 2).clamp(1, 255) as u8
}

/// Monta o payload completo já dividido em blocos de 4096 bytes.
///
/// `frames` é a concatenação de N quadros RGB565 (N × 32768 bytes).
/// `delays_ms` deve ter N itens quando N > 1; para imagem estática pode ser vazio.
pub fn build_payload(frames: &[u8], delays_ms: &[u32]) -> Result<Vec<u8>, String> {
    if frames.is_empty() || frames.len() % FRAME_BYTES != 0 {
        return Err(format!(
            "tamanho de quadros inválido: {} bytes (esperado múltiplo de {FRAME_BYTES})",
            frames.len()
        ));
    }
    let n = frames.len() / FRAME_BYTES;
    if n > MAX_FRAMES {
        return Err(format!("{n} quadros excede o máximo de {MAX_FRAMES}"));
    }
    if n > 1 && delays_ms.len() != n {
        return Err(format!("{} atrasos para {n} quadros", delays_ms.len()));
    }

    let raw = HEADER_BYTES + frames.len();
    let chunks = raw.div_ceil(CHUNK_SIZE);
    let mut payload = vec![0xFFu8; chunks * CHUNK_SIZE];
    payload[0] = n as u8;
    if n == 1 {
        payload[1] = 0x00;
    } else {
        for (i, &d) in delays_ms.iter().enumerate() {
            payload[1 + i] = delay_unit(d);
        }
    }
    payload[HEADER_BYTES..HEADER_BYTES + frames.len()].copy_from_slice(frames);
    Ok(payload)
}

pub fn chunk_count(payload_len: usize) -> usize {
    payload_len.div_ceil(CHUNK_SIZE)
}

/// Converte RGBA8888 em RGB565 LE (útil para testes e para o lado Rust).
pub fn rgba_to_rgb565(rgba: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(rgba.len() / 2);
    for px in rgba.chunks_exact(4) {
        let (r, g, b) = (px[0] as u16, px[1] as u16, px[2] as u16);
        let v = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
        out.push((v & 0xFF) as u8);
        out.push((v >> 8) as u8);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn static_image_is_nine_chunks() {
        let frames = vec![0x12u8; FRAME_BYTES];
        let p = build_payload(&frames, &[]).unwrap();
        assert_eq!(p.len(), 9 * CHUNK_SIZE);
        assert_eq!(p[0], 1);
        assert_eq!(p[1], 0);
        assert!(p[2..HEADER_BYTES].iter().all(|&b| b == 0xFF));
        assert_eq!(p[HEADER_BYTES], 0x12);
        assert_eq!(p[HEADER_BYTES + FRAME_BYTES - 1], 0x12);
        assert!(p[HEADER_BYTES + FRAME_BYTES..].iter().all(|&b| b == 0xFF));
    }

    #[test]
    fn animated_header() {
        let frames = vec![0u8; FRAME_BYTES * 3];
        let p = build_payload(&frames, &[100, 1, 2000]).unwrap();
        assert_eq!(&p[..5], &[3, 50, 1, 255, 0xFF]);
        assert_eq!(p.len() % CHUNK_SIZE, 0);
        assert_eq!(chunk_count(p.len()), (HEADER_BYTES + 3 * FRAME_BYTES).div_ceil(CHUNK_SIZE));
    }

    #[test]
    fn rejects_bad_input() {
        assert!(build_payload(&[], &[]).is_err());
        assert!(build_payload(&[0u8; 10], &[]).is_err());
        assert!(build_payload(&vec![0u8; FRAME_BYTES * 2], &[10]).is_err());
        assert!(build_payload(&vec![0u8; FRAME_BYTES * 256], &vec![10; 256]).is_err());
    }

    #[test]
    fn rgb565_le() {
        assert_eq!(rgba_to_rgb565(&[255, 0, 0, 255]), vec![0x00, 0xF8]);
        assert_eq!(rgba_to_rgb565(&[0, 255, 0, 255]), vec![0xE0, 0x07]);
        assert_eq!(rgba_to_rgb565(&[0, 0, 255, 255]), vec![0x1F, 0x00]);
    }
}
