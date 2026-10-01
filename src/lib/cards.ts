// Telas geradas: "Tocando agora" e clima. Saem prontas em RGB565.

import { quantize, SIZE, type Rendered } from "./imaging";
import type { NowPlaying } from "./api";

function finish(c: OffscreenCanvas): Rendered {
  const img = c.getContext("2d")!.getImageData(0, 0, SIZE, SIZE);
  const q = quantize(img.data, true);
  return { frames: q.rgb565, previews: [new ImageData(q.preview, SIZE, SIZE)], delays: [] };
}

function ellipsis(ctx: OffscreenCanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t + "…";
}

/** Quebra em até `lines` linhas cabendo em `max` px. */
function wrap(ctx: OffscreenCanvasRenderingContext2D, text: string, max: number, lines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width <= max || !cur) cur = test;
    else {
      out.push(cur);
      cur = w;
      if (out.length === lines - 1) break;
    }
  }
  const rest = words.slice(out.join(" ").split(/\s+/).filter(Boolean).length).join(" ");
  if (out.length < lines) out.push(rest || cur);
  return out.slice(0, lines).map((l, i) => (i === lines - 1 ? ellipsis(ctx, l, max) : l));
}

function cover(ctx: OffscreenCanvasRenderingContext2D, img: ImageBitmap, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

export const NP_TEMPLATES = [
  { value: "cover", label: "Capa" },
  { value: "card", label: "Capa + texto" },
  { value: "text", label: "Só texto" },
];

const FONT = '"Segoe UI", system-ui, sans-serif';

export function renderNowPlaying(np: NowPlaying, art: ImageBitmap | null, template: string, accent = "#8b6cff"): Rendered {
  const c = new OffscreenCanvas(SIZE, SIZE);
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#0b0b12";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const title = np.title || "Sem título";
  const artist = np.artist || np.app.replace(/\.exe$/i, "");

  if (template === "cover" && art) {
    cover(ctx, art, 0, 0, SIZE, SIZE);
    const g = ctx.createLinearGradient(0, 62, 0, SIZE);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.45, "rgba(0,0,0,0.75)");
    g.addColorStop(1, "rgba(0,0,0,0.92)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 62, SIZE, SIZE - 62);
    ctx.fillStyle = "#fff";
    ctx.font = `700 15px ${FONT}`;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(ellipsis(ctx, title, SIZE - 12), 6, 106);
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = `500 12px ${FONT}`;
    ctx.fillText(ellipsis(ctx, artist, SIZE - 12), 6, 121);
  } else if (template === "card" && art) {
    // fundo desfocado da própria capa
    ctx.filter = "blur(10px) brightness(0.45) saturate(1.4)";
    cover(ctx, art, -10, -10, SIZE + 20, SIZE + 20);
    ctx.filter = "none";
    cover(ctx, art, 24, 8, 80, 80);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.strokeRect(24.5, 8.5, 79, 79);
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.font = `700 13px ${FONT}`;
    ctx.fillText(ellipsis(ctx, title, SIZE - 8), SIZE / 2, 106);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = `500 11px ${FONT}`;
    ctx.fillText(ellipsis(ctx, artist, SIZE - 8), SIZE / 2, 121);
  } else {
    const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    g.addColorStop(0, accent);
    g.addColorStop(1, "#0b0b12");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
    // ícone de nota musical
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.ellipse(18, 30, 7, 5.5, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(23, 8, 3, 22);
    ctx.fillRect(23, 8, 12, 4);
    ctx.font = `700 17px ${FONT}`;
    ctx.fillStyle = "#fff";
    wrap(ctx, title, SIZE - 14, 3).forEach((l, i) => ctx.fillText(l, 7, 62 + i * 19));
    ctx.font = `500 12px ${FONT}`;
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillText(ellipsis(ctx, artist, SIZE - 14), 7, 120);
  }
  if (!np.playing) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(SIZE - 22, 4, 18, 18);
    ctx.fillStyle = "#fff";
    ctx.fillRect(SIZE - 17, 8, 3, 10);
    ctx.fillRect(SIZE - 12, 8, 3, 10);
  }
  return finish(c);
}

// ------------------------------------------------------------------ clima

export type Weather = {
  temp: number;
  code: number;
  isDay: boolean;
  humidity: number;
  wind: number;
  max: number;
  min: number;
  city: string;
  updated: Date;
};

export function weatherLabel(code: number): string {
  if (code === 0) return "Céu limpo";
  if (code <= 2) return "Poucas nuvens";
  if (code === 3) return "Nublado";
  if (code <= 48) return "Neblina";
  if (code <= 57) return "Garoa";
  if (code <= 67) return "Chuva";
  if (code <= 77) return "Neve";
  if (code <= 82) return "Pancadas";
  if (code <= 86) return "Neve";
  return "Tempestade";
}

function drawCloud(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, s: number, color = "#e8ecf5") {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x - s * 0.55, y, s * 0.42, 0, Math.PI * 2);
  ctx.arc(x, y - s * 0.25, s * 0.55, 0, Math.PI * 2);
  ctx.arc(x + s * 0.55, y, s * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - s * 0.55, y, s * 1.1, s * 0.42);
}

function drawSun(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.strokeStyle = "#ffd60a";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 1.35, y + Math.sin(a) * r * 1.35);
    ctx.lineTo(x + Math.cos(a) * r * 1.75, y + Math.sin(a) * r * 1.75);
    ctx.stroke();
  }
  ctx.fillStyle = "#ffcc00";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawMoon(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = "#f2f0d8";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(x + r * 0.5, y - r * 0.35, r * 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

export function drawWeatherIcon(ctx: OffscreenCanvasRenderingContext2D, code: number, day: boolean, x: number, y: number, s: number) {
  const clear = code <= 2;
  if (clear || code === 3) {
    if (day) drawSun(ctx, x - (code ? s * 0.3 : 0), y - (code ? s * 0.25 : 0), s * 0.38);
    else drawMoon(ctx, x - (code ? s * 0.3 : 0), y - (code ? s * 0.25 : 0), s * 0.42);
  }
  if (code === 0) return;
  if (code <= 2) {
    drawCloud(ctx, x + s * 0.2, y + s * 0.2, s * 0.55);
    return;
  }
  const dark = code >= 61 ? "#b8c0d4" : "#e8ecf5";
  drawCloud(ctx, x, y, s * 0.7, code >= 95 ? "#8c93a8" : dark);
  ctx.lineCap = "round";
  if (code >= 45 && code <= 48) {
    ctx.strokeStyle = "#cfd5e3";
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(x - s * 0.6, y + s * (0.5 + i * 0.18));
      ctx.lineTo(x + s * 0.6, y + s * (0.5 + i * 0.18));
      ctx.stroke();
    }
  } else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    ctx.strokeStyle = "#4fc3ff";
    ctx.lineWidth = 2.2;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(x + i * s * 0.35, y + s * 0.42);
      ctx.lineTo(x + i * s * 0.35 - s * 0.12, y + s * 0.72);
      ctx.stroke();
    }
  } else if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    ctx.fillStyle = "#fff";
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.arc(x + i * s * 0.35, y + s * 0.6, s * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (code >= 95) {
    ctx.fillStyle = "#ffd60a";
    ctx.beginPath();
    ctx.moveTo(x + s * 0.05, y + s * 0.3);
    ctx.lineTo(x - s * 0.2, y + s * 0.72);
    ctx.lineTo(x, y + s * 0.68);
    ctx.lineTo(x - s * 0.1, y + s * 0.98);
    ctx.lineTo(x + s * 0.22, y + s * 0.55);
    ctx.lineTo(x + s * 0.02, y + s * 0.58);
    ctx.closePath();
    ctx.fill();
  }
}

export const WEATHER_TEMPLATES = [
  { value: "card", label: "Cartão completo" },
  { value: "big", label: "Temperatura grande" },
];

export function renderWeather(w: Weather, template: string): Rendered {
  const c = new OffscreenCanvas(SIZE, SIZE);
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, SIZE);
  if (!w.isDay) {
    g.addColorStop(0, "#0d1330");
    g.addColorStop(1, "#05060f");
  } else if (w.code >= 61) {
    g.addColorStop(0, "#3a4660");
    g.addColorStop(1, "#151a28");
  } else {
    g.addColorStop(0, "#2a7bd6");
    g.addColorStop(1, "#0e2a55");
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  const t = `${Math.round(w.temp)}°`;
  if (template === "big") {
    drawWeatherIcon(ctx, w.code, w.isDay, 98, 30, 34);
    ctx.font = `700 58px ${FONT}`;
    ctx.fillText(t, 6, 92);
    ctx.font = `600 12px ${FONT}`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(ellipsis(ctx, w.city, SIZE - 12), 7, 114);
  } else {
    ctx.font = `600 12px ${FONT}`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(ellipsis(ctx, w.city, SIZE - 12), 7, 17);
    drawWeatherIcon(ctx, w.code, w.isDay, 38, 52, 40);
    ctx.fillStyle = "#fff";
    ctx.font = `700 34px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(t, SIZE - 6, 64);
    ctx.textAlign = "left";
    ctx.font = `600 11px ${FONT}`;
    ctx.fillText(ellipsis(ctx, weatherLabel(w.code), SIZE - 12), 7, 94);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = `500 10.5px ${FONT}`;
    ctx.fillText(`↑${Math.round(w.max)}° ↓${Math.round(w.min)}°  💧${w.humidity}%`, 7, 109);
    ctx.fillText(`Vento ${Math.round(w.wind)} km/h · ${w.updated.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`, 7, 122);
  }
  return finish(c);
}

export async function fetchWeather(lat: number, lon: number, city: string): Promise<Weather> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`serviço de clima respondeu ${r.status}`);
  const j = await r.json();
  return {
    temp: j.current.temperature_2m,
    code: j.current.weather_code,
    isDay: !!j.current.is_day,
    humidity: j.current.relative_humidity_2m,
    wind: j.current.wind_speed_10m,
    max: j.daily.temperature_2m_max[0],
    min: j.daily.temperature_2m_min[0],
    city,
    updated: new Date(),
  };
}

export type Place = { name: string; admin1?: string; country?: string; latitude: number; longitude: number };

export async function searchCity(q: string): Promise<Place[]> {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=pt&format=json`);
  if (!r.ok) throw new Error(`busca de cidade respondeu ${r.status}`);
  const j = await r.json();
  return j.results ?? [];
}
