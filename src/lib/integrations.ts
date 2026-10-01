// Ações compartilhadas das integrações (usadas pela página e pelos automáticos).

import { api, api3, type Lighting, type NowPlaying, type Settings, type WallpaperInfo } from "./api";
import { decodeFile, defaultEdit, dominantColor, renderAll, type Rendered } from "./imaging";
import { fetchWeather, renderNowPlaying, renderWeather } from "./cards";

const MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };

export async function loadWallpaper(source: "windows" | "engine", monitor?: string): Promise<{ info: WallpaperInfo; file: File }> {
  const info = await api3.wallpaperGet(source, monitor);
  const bytes = await api3.readFile(info.path);
  const file = new File([bytes as BlobPart], `${info.title}.${info.ext}`, { type: MIME[info.ext] ?? "image/jpeg" });
  return { info, file };
}

export async function renderFile(file: File, maxFrames = 140): Promise<Rendered> {
  const src = await decodeFile(file);
  try {
    return renderAll(src, { ...defaultEdit(), maxFrames });
  } finally {
    src.frames.forEach((f) => f.bitmap.close());
  }
}

export async function upload(r: Rendered): Promise<void> {
  await api.upload(r.frames, r.delays);
}

export async function coverBitmap(np: NowPlaying): Promise<ImageBitmap | null> {
  if (!np.thumb) return null;
  try {
    const bytes = await api3.readFile(np.thumb);
    return await createImageBitmap(new Blob([bytes as BlobPart]));
  } catch {
    return null;
  }
}

export async function renderNP(np: NowPlaying, template: string): Promise<Rendered> {
  const art = await coverBitmap(np);
  try {
    return renderNowPlaying(np, art, art ? template : "text");
  } finally {
    art?.close();
  }
}

export async function renderWeatherFor(settings: Settings): Promise<Rendered> {
  const w = settings.ui.weather;
  if (!w) throw new Error("escolha uma cidade primeiro");
  return renderWeather(await fetchWeather(w.lat, w.lon, w.name), w.template || "card");
}

/** Mantém o efeito atual e troca só a cor (ou liga o Estático, se o efeito não usa cor). */
export function lightingWithColor(current: Lighting | null, color: string): Lighting {
  const fixed = [0, 6, 8];
  const base = current ?? { mode: 1, color, rainbow: false, brightness: 4, speed: 3, direction: 0 };
  return { ...base, color, rainbow: false, mode: fixed.includes(base.mode) ? 1 : base.mode };
}

export function colorOf(r: Rendered): string {
  return dominantColor(r.previews[0]);
}
