// Pipeline de imagem: decodificar → editar → 128×128 → RGB565 LE.

export const SIZE = 128;
export const FRAME_BYTES = SIZE * SIZE * 2;
export const HARD_MAX_FRAMES = 255;
export const RECOMMENDED_MAX_FRAMES = 140;
export const MAX_DELAY_MS = 510;
const MAX_SOURCE_FRAMES = 600;
const MAX_SOURCE_SIDE = 512;

export type SourceFrame = { bitmap: ImageBitmap; delay: number };
export type Source = {
  name: string;
  width: number;
  height: number;
  frames: SourceFrame[];
  animated: boolean;
  truncated: boolean;
};

export type Fit = "cover" | "contain" | "stretch";

export type TextLayer = {
  text: string;
  size: number;
  color: string;
  stroke: boolean;
  y: number; // 0..128
  x: number; // 0..128 (centro)
  bold: boolean;
  font: string;
  glow: boolean;
  blink: boolean;
};

export type FilterPreset = "none" | "grayscale" | "sepia" | "invert" | "vintage" | "neon" | "cold" | "warm";
export type Playback = "normal" | "reverse" | "pingpong";

export const FONTS = [
  { value: '"Segoe UI", system-ui, sans-serif', label: "Segoe UI" },
  { value: "Impact, sans-serif", label: "Impact" },
  { value: '"Arial Black", Arial, sans-serif', label: "Arial Black" },
  { value: 'Consolas, "Cascadia Code", monospace', label: "Consolas" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: '"Comic Sans MS", cursive', label: "Comic Sans" },
  { value: '"Courier New", monospace', label: "Courier" },
  { value: '"Trebuchet MS", sans-serif', label: "Trebuchet" },
];

export const FILTERS: { value: FilterPreset; label: string; css: string }[] = [
  { value: "none", label: "Nenhum", css: "" },
  { value: "grayscale", label: "P&B", css: "grayscale(100%)" },
  { value: "sepia", label: "Sépia", css: "sepia(90%)" },
  { value: "invert", label: "Negativo", css: "invert(100%)" },
  { value: "vintage", label: "Vintage", css: "sepia(45%) contrast(110%) saturate(80%)" },
  { value: "neon", label: "Neon", css: "saturate(220%) contrast(125%)" },
  { value: "cold", label: "Frio", css: "hue-rotate(-18deg) saturate(120%)" },
  { value: "warm", label: "Quente", css: "sepia(25%) saturate(140%) hue-rotate(-8deg)" },
];

export type Edit = {
  fit: Fit;
  zoom: number;
  panX: number;
  panY: number;
  rotate: 0 | 90 | 180 | 270;
  flip: boolean;
  bg: string;
  brightness: number;
  contrast: number;
  saturation: number;
  speed: number;
  dither: boolean;
  maxFrames: number;
  text: TextLayer;
  filter: FilterPreset;
  hue: number; // -180..180
  blur: number; // 0..4 px
  pixelate: number; // 1 = desligado; >1 = tamanho do pixel
  vignette: number; // 0..1
  trimStart: number; // índice do 1º quadro usado
  trimEnd: number; // índice do último quadro usado (inclusive); -1 = até o fim
  playback: Playback;
};

export const defaultEdit = (): Edit => ({
  fit: "cover",
  zoom: 1,
  panX: 0,
  panY: 0,
  rotate: 0,
  flip: false,
  bg: "#000000",
  brightness: 100,
  contrast: 100,
  saturation: 100,
  speed: 1,
  dither: true,
  maxFrames: RECOMMENDED_MAX_FRAMES,
  text: { text: "", size: 22, color: "#ffffff", stroke: true, y: 108, x: 64, bold: true, font: FONTS[0].value, glow: false, blink: false },
  filter: "none",
  hue: 0,
  blur: 0,
  pixelate: 1,
  vignette: 0,
  trimStart: 0,
  trimEnd: -1,
  playback: "normal",
});

// ------------------------------------------------------------------ decodificação

// WebCodecs ImageDecoder (WebView2/Chromium). Tipos mínimos.
type DecodedImage = { image: VideoFrame & { duration: number | null } };
interface ImageDecoderLike {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number; animated: boolean } | null };
  completed: Promise<void>;
  decode(opts: { frameIndex: number }): Promise<DecodedImage>;
  close(): void;
}
type ImageDecoderCtor = {
  new (init: { data: ArrayBuffer; type: string }): ImageDecoderLike;
  isTypeSupported(type: string): Promise<boolean>;
};

function fitInside(w: number, h: number, max: number) {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

function mimeOf(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return (
    { gif: "image/gif", png: "image/png", apng: "image/apng", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", bmp: "image/bmp", avif: "image/avif" } as Record<string, string>
  )[ext ?? ""] ?? "application/octet-stream";
}

export function normalizeDelay(ms: number | null | undefined): number {
  // Mesmo comportamento dos navegadores: GIFs com 0–10 ms tocam a 100 ms.
  if (!ms || ms < 20) return 100;
  return ms;
}

export async function decodeFile(file: File): Promise<Source> {
  const type = mimeOf(file);
  const Decoder = (globalThis as unknown as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
  const maybeAnimated = /gif|webp|png|apng|avif/.test(type);

  if (Decoder && maybeAnimated && (await Decoder.isTypeSupported(type).catch(() => false))) {
    const dec = new Decoder({ data: await file.arrayBuffer(), type });
    try {
      await dec.tracks.ready;
      await dec.completed.catch(() => undefined);
      const track = dec.tracks.selectedTrack;
      const count = Math.max(1, track?.frameCount ?? 1);
      const take = Math.min(count, MAX_SOURCE_FRAMES);
      const frames: SourceFrame[] = [];
      let width = 0;
      let height = 0;
      for (let i = 0; i < take; i++) {
        const { image } = await dec.decode({ frameIndex: i });
        width = image.displayWidth;
        height = image.displayHeight;
        const { w, h } = fitInside(width, height, MAX_SOURCE_SIDE);
        const bitmap = await createImageBitmap(image, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
        frames.push({ bitmap, delay: normalizeDelay(image.duration != null ? image.duration / 1000 : null) });
        image.close();
      }
      return { name: file.name, width, height, frames, animated: frames.length > 1, truncated: count > take };
    } finally {
      dec.close();
    }
  }

  const full = await createImageBitmap(file);
  const { w, h } = fitInside(full.width, full.height, MAX_SOURCE_SIDE);
  const bitmap = w === full.width ? full : await createImageBitmap(full, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
  return { name: file.name, width: full.width, height: full.height, frames: [{ bitmap, delay: 100 }], animated: false, truncated: false };
}

export async function blankSource(): Promise<Source> {
  const c = new OffscreenCanvas(SIZE, SIZE);
  const bitmap = await createImageBitmap(c);
  return { name: "Em branco", width: SIZE, height: SIZE, frames: [{ bitmap, delay: 100 }], animated: false, truncated: false };
}

// ------------------------------------------------------------------ planejamento de quadros

export type PlannedFrame = { index: number; delay: number };

/**
 * Decide quais quadros da origem vão para o teclado e com qual atraso.
 * Respeita o limite de quadros reamostrando no tempo, e quebra atrasos acima
 * de 510 ms em quadros repetidos quando há espaço.
 */
export function planFrames(delays: number[], speed: number, maxFrames: number): PlannedFrame[] {
  const max = Math.max(1, Math.min(HARD_MAX_FRAMES, Math.floor(maxFrames)));
  if (delays.length <= 1) return [{ index: 0, delay: 0 }];
  const scaled = delays.map((d) => Math.max(2, normalizeDelay(d) / speed));

  let plan: PlannedFrame[];
  if (scaled.length <= max) {
    plan = scaled.map((delay, index) => ({ index, delay }));
  } else {
    const total = scaled.reduce((a, b) => a + b, 0);
    const step = total / max;
    plan = [];
    let src = 0;
    let acc = scaled[0];
    for (let k = 0; k < max; k++) {
      const t = k * step + step / 2;
      while (t > acc && src < scaled.length - 1) acc += scaled[++src];
      const last = plan[plan.length - 1];
      if (last && last.index === src) last.delay += step;
      else plan.push({ index: src, delay: step });
    }
  }

  const extra = plan.reduce((n, f) => n + Math.ceil(f.delay / MAX_DELAY_MS) - 1, 0);
  if (extra > 0 && plan.length + extra <= max) {
    const split: PlannedFrame[] = [];
    for (const f of plan) {
      const parts = Math.ceil(f.delay / MAX_DELAY_MS);
      for (let i = 0; i < parts; i++) split.push({ index: f.index, delay: f.delay / parts });
    }
    plan = split;
  }
  return plan.map((f) => ({ index: f.index, delay: Math.round(Math.min(MAX_DELAY_MS, Math.max(2, f.delay))) }));
}

// ------------------------------------------------------------------ renderização

let scratch: OffscreenCanvas | null = null;
function ctx128(): OffscreenCanvasRenderingContext2D {
  if (!scratch) scratch = new OffscreenCanvas(SIZE, SIZE);
  return scratch.getContext("2d", { willReadFrequently: true })!;
}

let tiny: OffscreenCanvas | null = null;

export type DrawOpts = { showText?: boolean; raw?: boolean };

export function drawFrame(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, bmp: ImageBitmap, e: Edit, opts: DrawOpts = {}) {
  const raw = !!opts.raw;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = "none";
  ctx.fillStyle = e.bg;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (!raw) {
    const parts: string[] = [];
    if (e.brightness !== 100) parts.push(`brightness(${e.brightness}%)`);
    if (e.contrast !== 100) parts.push(`contrast(${e.contrast}%)`);
    if (e.saturation !== 100) parts.push(`saturate(${e.saturation}%)`);
    if (e.hue) parts.push(`hue-rotate(${e.hue}deg)`);
    if (e.blur > 0) parts.push(`blur(${e.blur}px)`);
    const preset = FILTERS.find((f) => f.value === e.filter)?.css;
    if (preset) parts.push(preset);
    if (parts.length) ctx.filter = parts.join(" ");
  }
  const rotated = e.rotate % 180 !== 0;
  const rw = rotated ? bmp.height : bmp.width;
  const rh = rotated ? bmp.width : bmp.height;
  ctx.translate(SIZE / 2 + e.panX, SIZE / 2 + e.panY);
  ctx.rotate((e.rotate * Math.PI) / 180);
  let sx: number;
  let sy: number;
  if (e.fit === "stretch") {
    // As duas dimensões de saída são 128, então a rotação não muda a escala.
    sx = (SIZE / bmp.width) * e.zoom;
    sy = (SIZE / bmp.height) * e.zoom;
  } else {
    const s = (e.fit === "cover" ? Math.max(SIZE / rw, SIZE / rh) : Math.min(SIZE / rw, SIZE / rh)) * e.zoom;
    sx = s;
    sy = s;
  }
  if (e.flip) ctx.scale(-1, 1);
  const w = bmp.width * sx;
  const h = bmp.height * sy;
  ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
  ctx.restore();
  if (raw) return;

  // Pixel art: reduz e amplia sem suavização.
  if (e.pixelate > 1) {
    const n = Math.max(2, Math.round(SIZE / e.pixelate));
    if (!tiny || tiny.width !== n) tiny = new OffscreenCanvas(n, n);
    const tctx = tiny.getContext("2d")!;
    tctx.imageSmoothingEnabled = true;
    tctx.clearRect(0, 0, n, n);
    tctx.drawImage(ctx.canvas as CanvasImageSource, 0, 0, n, n);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tiny, 0, 0, SIZE, SIZE);
    ctx.restore();
  }

  if (e.vignette > 0) {
    const g = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.25, SIZE / 2, SIZE / 2, SIZE * 0.72);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${Math.min(1, e.vignette)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }

  const t = e.text;
  if (t.text.trim() && opts.showText !== false) {
    ctx.save();
    ctx.font = `${t.bold ? "700" : "500"} ${t.size}px ${t.font || FONTS[0].value}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const x = t.x ?? SIZE / 2;
    const maxW = SIZE - 4;
    if (t.glow) {
      ctx.shadowColor = t.color;
      ctx.shadowBlur = Math.max(4, t.size / 3);
    }
    if (t.stroke) {
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(2, t.size / 6);
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.strokeText(t.text, x, t.y, maxW);
    }
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, x, t.y, maxW);
    ctx.restore();
  }
}

/** RGBA → RGB565 LE, opcionalmente com dithering Floyd–Steinberg. Também
 *  devolve a versão quantizada em RGBA para pré-visualização fiel. */
export function quantize(rgba: Uint8ClampedArray, dither: boolean): { rgb565: Uint8Array; preview: Uint8ClampedArray<ArrayBuffer> } {
  const n = SIZE * SIZE;
  const out = new Uint8Array(n * 2);
  const preview = new Uint8ClampedArray(new ArrayBuffer(n * 4));
  const buf = dither ? Float32Array.from(rgba) : null;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const p = i * 4;
      let r: number, g: number, b: number;
      if (buf) {
        r = clamp255(buf[p]);
        g = clamp255(buf[p + 1]);
        b = clamp255(buf[p + 2]);
      } else {
        r = rgba[p];
        g = rgba[p + 1];
        b = rgba[p + 2];
      }
      const r5 = (r * 31 + 127) / 255 | 0;
      const g6 = (g * 63 + 127) / 255 | 0;
      const b5 = (b * 31 + 127) / 255 | 0;
      const v = (r5 << 11) | (g6 << 5) | b5;
      out[i * 2] = v & 0xff;
      out[i * 2 + 1] = v >> 8;
      const qr = (r5 * 255 + 15) / 31 | 0;
      const qg = (g6 * 255 + 31) / 63 | 0;
      const qb = (b5 * 255 + 15) / 31 | 0;
      preview[p] = qr;
      preview[p + 1] = qg;
      preview[p + 2] = qb;
      preview[p + 3] = 255;
      if (buf) {
        diffuse(buf, x, y, r - qr, g - qg, b - qb);
      }
    }
  }
  return { rgb565: out, preview };
}

function clamp255(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function diffuse(buf: Float32Array, x: number, y: number, er: number, eg: number, eb: number) {
  const add = (dx: number, dy: number, f: number) => {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= SIZE || ny >= SIZE) return;
    const q = (ny * SIZE + nx) * 4;
    buf[q] += er * f;
    buf[q + 1] += eg * f;
    buf[q + 2] += eb * f;
  };
  add(1, 0, 7 / 16);
  add(-1, 1, 3 / 16);
  add(0, 1, 5 / 16);
  add(1, 1, 1 / 16);
}

export function rgb565ToImageData(bytes: Uint8Array, offset = 0): ImageData {
  const img = new ImageData(SIZE, SIZE);
  const d = img.data;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = bytes[offset + i * 2] | (bytes[offset + i * 2 + 1] << 8);
    const r5 = v >> 11;
    const g6 = (v >> 5) & 0x3f;
    const b5 = v & 0x1f;
    d[i * 4] = (r5 * 255 + 15) / 31 | 0;
    d[i * 4 + 1] = (g6 * 255 + 31) / 63 | 0;
    d[i * 4 + 2] = (b5 * 255 + 15) / 31 | 0;
    d[i * 4 + 3] = 255;
  }
  return img;
}

export type Rendered = {
  frames: Uint8Array; // N × 32768
  previews: ImageData[];
  delays: number[]; // ms, um por quadro (vazio = estático)
};

/** Sequência de quadros da origem depois de cortar e aplicar inverter/vaivém. */
export function sequence(src: Source, e: Edit): number[] {
  const last = src.frames.length - 1;
  const a = Math.min(Math.max(0, e.trimStart), last);
  const b = e.trimEnd < 0 ? last : Math.min(Math.max(a, e.trimEnd), last);
  const seq: number[] = [];
  for (let i = a; i <= b; i++) seq.push(i);
  if (e.playback === "reverse") seq.reverse();
  else if (e.playback === "pingpong" && seq.length > 2) seq.push(...seq.slice(1, -1).reverse());
  return seq;
}

const BLINK_MS = 500;

export function renderAll(src: Source, e: Edit, onlyFirst = false): Rendered {
  const seq = sequence(src, e);
  const blink = e.text.blink && e.text.text.trim().length > 0;
  let plan: { index: number; delay: number; show: boolean }[];
  if (seq.length === 1) {
    plan = blink ? [{ index: seq[0], delay: BLINK_MS, show: true }, { index: seq[0], delay: BLINK_MS, show: false }] : [{ index: seq[0], delay: 0, show: true }];
  } else {
    let t = 0;
    plan = planFrames(seq.map((i) => src.frames[i].delay), e.speed, e.maxFrames).map((p) => {
      const show = !blink || Math.floor(t / BLINK_MS) % 2 === 0;
      t += p.delay;
      return { index: seq[p.index], delay: p.delay, show };
    });
  }
  const use = onlyFirst ? plan.slice(0, 1) : plan;
  const ctx = ctx128();
  const cache = new Map<string, { rgb565: Uint8Array; preview: ImageData }>();
  const frames = new Uint8Array(use.length * FRAME_BYTES);
  const previews: ImageData[] = [];
  use.forEach((p, k) => {
    const key = `${p.index}:${p.show}`;
    let r = cache.get(key);
    if (!r) {
      drawFrame(ctx, src.frames[p.index].bitmap, e, { showText: p.show });
      const q = quantize(ctx.getImageData(0, 0, SIZE, SIZE).data, e.dither);
      r = { rgb565: q.rgb565, preview: new ImageData(q.preview, SIZE, SIZE) };
      cache.set(key, r);
    }
    frames.set(r.rgb565, k * FRAME_BYTES);
    previews.push(r.preview);
  });
  return { frames, previews, delays: use.length > 1 ? use.map((p) => p.delay) : [] };
}

/** Primeiro quadro só com o enquadramento (sem filtros/texto/quantização), para comparar. */
export function renderOriginal(src: Source, e: Edit): ImageData {
  const ctx = ctx128();
  drawFrame(ctx, src.frames[sequence(src, e)[0]].bitmap, e, { raw: true });
  return ctx.getImageData(0, 0, SIZE, SIZE);
}

/** Converte quadros RGB565 (ex.: um item da galeria) de volta em uma origem editável. */
export async function sourceFromFrames(name: string, bytes: Uint8Array, delays: number[]): Promise<Source> {
  const n = Math.floor(bytes.length / FRAME_BYTES);
  const frames: SourceFrame[] = [];
  for (let i = 0; i < n; i++) {
    const bitmap = await createImageBitmap(rgb565ToImageData(bytes, i * FRAME_BYTES));
    frames.push({ bitmap, delay: n > 1 ? delays[i] ?? 100 : 100 });
  }
  return { name, width: SIZE, height: SIZE, frames, animated: n > 1, truncated: false };
}

/** Cor dominante (ignora pixels muito escuros/claros), para sincronizar o RGB. */
export function dominantColor(img: ImageData): string {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  const d = img.data;
  for (let i = 0; i < d.length; i += 16) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max < 40 || (max - min < 25 && max > 220)) continue;
    const sat = max === 0 ? 0 : (max - min) / max;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    const w = 1 + sat * 3;
    bin.n += w;
    bin.r += r * w;
    bin.g += g * w;
    bin.b += b * w;
    bins.set(key, bin);
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const v of bins.values()) if (!best || v.n > best.n) best = v;
  if (!best) return "#ffffff";
  const hex = (v: number) => Math.round(v / best!.n).toString(16).padStart(2, "0");
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}

export function thumbnail(preview: ImageData): string {
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  c.getContext("2d")!.putImageData(preview, 0, 0);
  return c.toDataURL("image/png");
}

export function totalDuration(delays: number[]): number {
  return delays.reduce((a, b) => a + b, 0);
}
