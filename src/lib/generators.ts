// Geradores de conteúdo animado: letreiro, fundos animados e slideshow.

import { decodeFile, planFrames, SIZE, type Source, type SourceFrame } from "./imaging";

async function toFrames(canvases: { canvas: OffscreenCanvas; delay: number }[]): Promise<SourceFrame[]> {
  // Quadros repetidos (GIF em loop) compartilham o mesmo bitmap.
  const cache = new Map<OffscreenCanvas, Promise<ImageBitmap>>();
  return Promise.all(
    canvases.map(async (c) => {
      let b = cache.get(c.canvas);
      if (!b) {
        b = createImageBitmap(c.canvas);
        cache.set(c.canvas, b);
      }
      return { bitmap: await b, delay: c.delay };
    }),
  );
}

// ------------------------------------------------------------------ letreiro

export type MarqueeOpts = {
  text: string;
  color: string;
  bg: string;
  size: number;
  font: string;
  speed: number; // pixels por segundo
  direction: "left" | "right" | "up";
  maxFrames: number;
  glow: boolean;
};

export async function marquee(o: MarqueeOpts): Promise<Source> {
  const measure = new OffscreenCanvas(8, 8).getContext("2d")!;
  measure.font = `700 ${o.size}px ${o.font}`;
  const text = o.text.trim() || "AK820";
  const tw = Math.ceil(measure.measureText(text).width);
  const vertical = o.direction === "up";
  const travel = vertical ? SIZE + o.size * 1.4 : tw + SIZE;
  const frameCount = Math.max(8, Math.min(o.maxFrames, Math.ceil(travel / 2)));
  const step = travel / frameCount;
  const delay = Math.max(20, Math.round((step / Math.max(5, o.speed)) * 1000));
  const out: { canvas: OffscreenCanvas; delay: number }[] = [];
  for (let i = 0; i < frameCount; i++) {
    const c = new OffscreenCanvas(SIZE, SIZE);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = o.bg;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.font = `700 ${o.size}px ${o.font}`;
    ctx.textBaseline = "middle";
    ctx.fillStyle = o.color;
    if (o.glow) {
      ctx.shadowColor = o.color;
      ctx.shadowBlur = Math.max(4, o.size / 3);
    }
    const p = i * step;
    if (vertical) {
      ctx.textAlign = "center";
      ctx.fillText(text, SIZE / 2, SIZE + o.size * 0.7 - p, SIZE - 4);
    } else {
      ctx.textAlign = "left";
      const x = o.direction === "left" ? SIZE - p : p - tw;
      ctx.fillText(text, x, SIZE / 2);
    }
    out.push({ canvas: c, delay });
  }
  return { name: `Letreiro – ${text}`, width: SIZE, height: SIZE, frames: await toFrames(out), animated: true, truncated: false };
}

// ------------------------------------------------------------------ fundos animados

export type BackgroundKind = "rainbow" | "plasma" | "waves" | "stars" | "matrix" | "fire" | "pulse" | "tunnel";
export const BACKGROUNDS: { value: BackgroundKind; label: string }[] = [
  { value: "rainbow", label: "Arco-íris" },
  { value: "plasma", label: "Plasma" },
  { value: "waves", label: "Ondas" },
  { value: "stars", label: "Estrelas" },
  { value: "matrix", label: "Matrix" },
  { value: "fire", label: "Fogo" },
  { value: "pulse", label: "Pulso" },
  { value: "tunnel", label: "Túnel" },
];

function hexRgb(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

export async function background(kind: BackgroundKind, colorA: string, colorB: string, frames = 48, delay = 60): Promise<Source> {
  const A = hexRgb(colorA);
  const B = hexRgb(colorB);
  const mix = (k: number): [number, number, number] => [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k];
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const stars = Array.from({ length: 70 }, () => ({ x: rnd() * 2 - 1, y: rnd() * 2 - 1, z: rnd() }));
  const cols = Array.from({ length: 16 }, () => ({ off: rnd(), speed: 0.6 + rnd() * 0.8 }));
  const heat = new Float32Array(SIZE * (SIZE + 2));

  const out: { canvas: OffscreenCanvas; delay: number }[] = [];
  for (let f = 0; f < frames; f++) {
    const t = f / frames; // 0..1, loop perfeito
    const c = new OffscreenCanvas(SIZE, SIZE);
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(SIZE, SIZE);
    const d = img.data;
    const put = (x: number, y: number, rgb: [number, number, number]) => {
      const i = (y * SIZE + x) * 4;
      d[i] = rgb[0];
      d[i + 1] = rgb[1];
      d[i + 2] = rgb[2];
      d[i + 3] = 255;
    };
    const T = t * Math.PI * 2;
    if (kind === "stars" || kind === "matrix") {
      for (let i = 3; i < d.length; i += 4) d[i] = 255;
    }
    if (kind === "fire" && f === 0) heat.fill(0);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const u = x / SIZE;
        const v = y / SIZE;
        switch (kind) {
          case "rainbow":
            put(x, y, hsl((u + v * 0.5 + t) % 1, 0.95, 0.55));
            break;
          case "plasma": {
            const k = (Math.sin(u * 10 + T) + Math.sin(v * 8 - T) + Math.sin((u + v) * 7 + T) + Math.sin(Math.hypot(u - 0.5, v - 0.5) * 14 - T)) / 8 + 0.5;
            put(x, y, mix(k));
            break;
          }
          case "waves": {
            const k = 0.5 + 0.5 * Math.sin(v * 14 + Math.sin(u * 6 + T) * 2 - T * 2);
            put(x, y, mix(k));
            break;
          }
          case "pulse": {
            const r = Math.hypot(u - 0.5, v - 0.5);
            const k = 0.5 + 0.5 * Math.sin(r * 30 - T * 3);
            put(x, y, mix(k * Math.max(0, 1 - r * 1.2)));
            break;
          }
          case "tunnel": {
            const dx = u - 0.5, dy = v - 0.5;
            const r = Math.hypot(dx, dy) + 0.0001;
            const a = Math.atan2(dy, dx) / Math.PI;
            const k = ((0.25 / r + t * 2) % 1 + (a * 4 + 8) % 1) % 1;
            const shade = Math.min(1, r * 2.4);
            const [cr, cg, cb] = mix(k > 0.5 ? 1 : 0);
            put(x, y, [cr * shade, cg * shade, cb * shade]);
            break;
          }
        }
      }
    }
    if (kind === "fire") {
      for (let x = 0; x < SIZE; x++) heat[(SIZE + 1) * SIZE + x] = rnd() > 0.45 ? 1 : 0;
      for (let pass = 0; pass < 3; pass++)
        for (let y = 0; y <= SIZE; y++)
          for (let x = 0; x < SIZE; x++) {
            const below = (y + 1) * SIZE;
            const s = heat[below + x] + heat[below + ((x + 1) % SIZE)] + heat[below + ((x + SIZE - 1) % SIZE)] + heat[Math.min(SIZE + 1, y + 2) * SIZE + x];
            heat[y * SIZE + x] = Math.max(0, s / 4.04 - 0.004);
          }
      for (let y = 0; y < SIZE; y++)
        for (let x = 0; x < SIZE; x++) {
          const h = Math.min(1, heat[y * SIZE + x] * 1.6);
          put(x, y, [255 * Math.min(1, h * 1.5), 255 * Math.max(0, Math.min(1, h * 1.5 - 0.5)), 255 * Math.max(0, h * 2 - 1.6)]);
        }
    }
    ctx.putImageData(img, 0, 0);
    if (kind === "stars") {
      for (const s of stars) {
        const z = (s.z - t + 1) % 1 || 1;
        const px = SIZE / 2 + (s.x / z) * 18;
        const py = SIZE / 2 + (s.y / z) * 18;
        const r = Math.max(0.6, (1 - z) * 2.4);
        ctx.fillStyle = `rgba(${A.join(",")},${1 - z * 0.7})`;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (kind === "matrix") {
      ctx.font = "bold 9px Consolas, monospace";
      cols.forEach((col, i) => {
        const head = ((col.off + t * col.speed * 2) % 1.4) * SIZE * 1.1;
        for (let k = 0; k < 12; k++) {
          const y = head - k * 9;
          if (y < -9 || y > SIZE + 9) continue;
          const a = k === 0 ? 1 : 1 - k / 12;
          ctx.fillStyle = k === 0 ? "#ffffff" : `rgba(${A.join(",")},${a})`;
          ctx.fillText(String.fromCharCode(0x30a0 + ((i * 7 + k * 13 + f) % 90)), i * 8, y);
        }
      });
    }
    out.push({ canvas: c, delay });
  }
  const label = BACKGROUNDS.find((b) => b.value === kind)?.label ?? kind;
  return { name: `Fundo – ${label}`, width: SIZE, height: SIZE, frames: await toFrames(out), animated: true, truncated: false };
}

// ------------------------------------------------------------------ slideshow

export type SlideshowOpts = {
  holdMs: number;
  transition: "none" | "fade" | "slide";
  transitionFrames: number;
  /** GIFs: tocar uma vez ou repetir até completar o tempo de cada slide */
  gifMode: "once" | "fill";
};

type Slide = { canvas: OffscreenCanvas; delay: number }[];
const SLIDE_SIZE = 256; // resolução intermediária
const MAX_SLIDESHOW_FRAMES = 600;

function coverCanvas(bmp: ImageBitmap): OffscreenCanvas {
  const S = SLIDE_SIZE;
  const c = new OffscreenCanvas(S, S);
  const ctx = c.getContext("2d")!;
  const s = Math.max(S / bmp.width, S / bmp.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, (S - bmp.width * s) / 2, (S - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
  return c;
}

/** Converte um arquivo (imagem ou GIF) em um slide com seus quadros. */
async function toSlide(file: File, o: SlideshowOpts, budget: number): Promise<Slide> {
  const src = await decodeFile(file);
  try {
    if (src.frames.length <= 1) return [{ canvas: coverCanvas(src.frames[0].bitmap), delay: o.holdMs }];
    // GIF: limita os quadros reamostrando no tempo, mantendo a velocidade original
    const plan = planFrames(src.frames.map((f) => f.delay), 1, Math.max(2, budget));
    const cache = new Map<number, OffscreenCanvas>();
    const once: Slide = plan.map((p) => {
      let c = cache.get(p.index);
      if (!c) {
        c = coverCanvas(src.frames[p.index].bitmap);
        cache.set(p.index, c);
      }
      return { canvas: c, delay: p.delay };
    });
    if (o.gifMode !== "fill") return once;
    const total = once.reduce((a, f) => a + f.delay, 0);
    const out = [...once];
    let t = total;
    while (t < o.holdMs && out.length + once.length <= budget * 2) {
      out.push(...once);
      t += total;
    }
    return out;
  } finally {
    src.frames.forEach((f) => f.bitmap.close());
  }
}

/** Monta um slideshow com várias imagens e/ou GIFs (cada um preenchendo a tela). */
export async function slideshow(files: File[], o: SlideshowOpts): Promise<Source> {
  const S = SLIDE_SIZE;
  const budget = Math.floor(MAX_SLIDESHOW_FRAMES / Math.max(1, files.length));
  const slides: Slide[] = [];
  for (const f of files) {
    try {
      slides.push(await toSlide(f, o, budget));
    } catch {
      /* arquivo inválido: pula */
    }
  }
  if (!slides.length) throw new Error("nenhuma imagem válida");
  const out: Slide = [];
  const tf = o.transition === "none" ? 0 : Math.max(2, o.transitionFrames);
  slides.forEach((slide, i) => {
    out.push(...slide);
    if (slides.length < 2) return;
    const from = slide[slide.length - 1].canvas;
    const to = slides[(i + 1) % slides.length][0].canvas;
    for (let k = 1; k <= tf; k++) {
      const p = k / (tf + 1);
      const c = new OffscreenCanvas(S, S);
      const ctx = c.getContext("2d")!;
      if (o.transition === "fade") {
        ctx.drawImage(from, 0, 0);
        ctx.globalAlpha = p;
        ctx.drawImage(to, 0, 0);
      } else {
        ctx.drawImage(from, -p * S, 0);
        ctx.drawImage(to, S - p * S, 0);
      }
      out.push({ canvas: c, delay: 70 });
    }
  });
  const gifs = files.filter((f) => /gif|webp/i.test(f.type || f.name)).length;
  const label = gifs ? `${files.length} itens, ${gifs} animado${gifs > 1 ? "s" : ""}` : `${files.length} imagens`;
  return { name: `Slideshow (${label})`, width: S, height: S, frames: await toFrames(out), animated: out.length > 1, truncated: false };
}
