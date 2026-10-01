// Exportar o resultado como PNG ou GIF (ampliado, com os pixels nítidos).

import { GIFEncoder, applyPalette, quantize } from "gifenc";
import { SIZE, type Rendered } from "./imaging";

function scaled(img: ImageData, scale: number): ImageData {
  const S = SIZE * scale;
  const c = new OffscreenCanvas(S, S);
  const ctx = c.getContext("2d")!;
  const src = new OffscreenCanvas(SIZE, SIZE);
  src.getContext("2d")!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, S, S);
  return ctx.getImageData(0, 0, S, S);
}

export async function exportPng(r: Rendered, scale = 4): Promise<Uint8Array> {
  const img = scaled(r.previews[0], scale);
  const c = new OffscreenCanvas(img.width, img.height);
  c.getContext("2d")!.putImageData(img, 0, 0);
  const blob = await c.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}

export function exportGif(r: Rendered, scale = 2): Uint8Array {
  const gif = GIFEncoder();
  const S = SIZE * scale;
  r.previews.forEach((p, i) => {
    const data = scaled(p, scale).data;
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, S, S, { palette, delay: r.delays[i] ?? 100, repeat: 0 });
  });
  gif.finish();
  return gif.bytes();
}
