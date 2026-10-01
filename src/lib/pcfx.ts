// Prévia dos efeitos do PC (espelha crates/ak820-core/src/effects.rs).

import { KEYS, WIDTH_UNITS } from "./layout";

export const PC_EFFECTS = [
  { value: "rainbowWave", label: "Onda arco-íris", colors: 0, dir: true },
  { value: "colorCycle", label: "Ciclo de cores", colors: 0, dir: false },
  { value: "breath", label: "Respiração", colors: 1, dir: false },
  { value: "gradient", label: "Degradê", colors: 2, dir: false },
  { value: "aurora", label: "Aurora", colors: 2, dir: true },
  { value: "fire", label: "Fogo", colors: 0, dir: false },
  { value: "rain", label: "Chuva", colors: 1, dir: false },
  { value: "stars", label: "Estrelas", colors: 2, dir: false },
] as const;

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const hsv = (h: number, s: number, v: number): RGB => {
  h = (((h % 1) + 1) % 1) * 6;
  const i = Math.floor(h);
  const f = h - i;
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  const c = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i] ?? [v, p, q];
  return c.map((x) => x * 255) as RGB;
};
const mix = (a: RGB, b: RGB, k: number): RGB => {
  k = Math.min(1, Math.max(0, k));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
};

const centers = KEYS.map((k) => [(k.x + k.w / 2) / WIDTH_UNITS, (k.row + 0.5) / 6] as const);

export class FxPreview {
  state = new Float32Array(KEYS.length);
  last = 0;
  frame(effect: string, t: number, speed: number, a: string, b: string, reverse: boolean): string[] {
    const dt = Math.min(0.5, Math.max(0, t - this.last));
    this.last = t;
    const ts = t * speed;
    const A = hex(a), B = hex(b);
    const dir = reverse ? -1 : 1;
    return centers.map(([x, y], i) => {
      let c: RGB;
      switch (effect) {
        case "rainbowWave": c = hsv(x * dir - ts * 0.35, 1, 1); break;
        case "colorCycle": c = hsv(ts * 0.12, 1, 1); break;
        case "breath": c = mix([0, 0, 0], A, 0.05 + 0.95 * (0.5 - 0.5 * Math.cos(ts * 2))); break;
        case "gradient": c = mix(A, B, x); break;
        case "aurora": c = mix(A, B, 0.5 + 0.5 * (Math.sin(x * 6 + ts * 1.3 * dir) * 0.5 + Math.sin(y * 4 - ts * 0.9) * 0.5)); break;
        case "fire": {
          const target = y * 1.1 - 0.1 + Math.random() * 0.35;
          this.state[i] += (target - this.state[i]) * Math.min(1, dt * 6 * speed);
          const h = Math.min(1, Math.max(0, this.state[i]));
          c = [h * 255, Math.min(1, h * h * 0.8) * 255, Math.min(1, h ** 4 * 0.3) * 255];
          break;
        }
        case "rain": {
          const phase = (ts * 0.8 + Math.floor(x * 16) * 0.37) % 1;
          c = mix([0, 0, 0], A, Math.max(0, 1 - Math.abs(y - phase) * 4));
          break;
        }
        case "stars": {
          if (Math.random() < 0.012 * speed) this.state[i] = 1;
          this.state[i] = Math.max(0, this.state[i] - dt * 0.9 * speed);
          c = mix(B, A, this.state[i]);
          break;
        }
        default: c = [0, 0, 0];
      }
      return `rgb(${c.map((v) => Math.round(v)).join(",")})`;
    });
  }
}

/** Prévia do medidor de CPU/RAM com valores fictícios animados. */
export function meterPreview(t: number, base: string): string[] {
  const cpu = 0.35 + 0.3 * Math.sin(t * 0.9);
  const ram = 0.55 + 0.1 * Math.sin(t * 0.3);
  const B = hex(base);
  const dim = `rgb(${B.map((v) => Math.round(v * 0.25)).join(",")})`;
  const cpuKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
  const ramKeys = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"];
  const color = (pos: number) => (pos < 0.6 ? mix([40, 220, 90], [255, 200, 0], pos / 0.6) : mix([255, 200, 0], [255, 30, 40], (pos - 0.6) / 0.4));
  return KEYS.map((k) => {
    const list = k.row === 1 ? cpuKeys : k.row === 0 ? ramKeys : null;
    const j = list ? list.indexOf(k.label) : -1;
    if (!list || j < 0) return dim;
    const pos = (j + 0.5) / list.length;
    const level = k.row === 1 ? cpu : ram;
    const c = color(pos);
    const on = pos <= level + 0.5 / list.length;
    return `rgb(${c.map((v) => Math.round(on ? v : v * 0.08)).join(",")})`;
  });
}

// ------------------------------------------------------------------ música (prévia com áudio simulado)

export const MUSIC_STYLES = [
  { value: "spectrum", label: "Equalizador", desc: "Barras sobem da base conforme cada frequência" },
  { value: "pulse", label: "Pulso", desc: "O teclado todo pulsa na batida e troca de cor" },
  { value: "rainbow", label: "Arco-íris", desc: "Cada coluna tem uma cor e brilha com sua frequência" },
  { value: "ripple", label: "Ondas", desc: "Ondas saem do centro a cada batida" },
];

export class MusicPreview {
  hue = 0;
  ripples: [number, number][] = [];
  lastBeat = 0;
  frame(style: string, t: number, a: string, b: string): string[] {
    // áudio fictício: graves com batida a ~120 bpm
    const beatPhase = (t * 2) % 1;
    const beat = Math.max(0, 1 - beatPhase * 4);
    const bands = Array.from({ length: 16 }, (_, i) => Math.max(0, Math.min(1, (i < 4 ? beat * 0.9 : 0.25) + 0.35 * Math.sin(t * (2 + i * 0.7) + i) * (1 - i / 22))));
    const level = 0.3 + beat * 0.4;
    const A = hex(a), B = hex(b);
    if (beat > 0.55 && this.lastBeat <= 0.55) {
      this.hue = (this.hue + 0.13) % 1;
      this.ripples.push([t, beat]);
    }
    this.lastBeat = beat;
    this.ripples = this.ripples.filter(([t0]) => t - t0 < 1.2);
    return centers.map(([x, y]) => {
      const v = bands[Math.min(15, Math.floor(x * 16))];
      let c: RGB;
      if (style === "pulse") c = hsv(this.hue + x * 0.15, 1, Math.min(1, 0.08 + level * 0.6 + beat * 0.6));
      else if (style === "rainbow") c = hsv(x * 0.85 + t * 0.03, 1, Math.min(1, 0.05 + v * 1.1));
      else if (style === "ripple") {
        let k = 0.04 + level * 0.25;
        for (const [t0, f] of this.ripples) {
          const r = (t - t0) * 0.9;
          const d = Math.hypot((x - 0.5) * 1.6, y - 0.5);
          k += Math.max(0, 1 - Math.abs(d - r) * 7) * f * (1 - (t - t0) / 1.2);
        }
        c = mix(A, B, x).map((q) => q * Math.min(1, k)) as RGB;
      } else {
        const h = 1 - y;
        const base = mix(A, B, h);
        c = v >= h * 0.95 ? base : (base.map((q) => q * 0.04) as RGB);
      }
      return `rgb(${c.map((q) => Math.round(q)).join(",")})`;
    });
  }
}
