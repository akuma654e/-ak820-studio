// Ponte com o backend Rust (Tauri). Fora do Tauri, usa uma simulação para
// permitir testar a interface no navegador.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type DeviceState = "connected" | "wireless" | "bootloader" | "partial" | "disconnected" | "error";
export type DeviceStatus = { state: DeviceState; product: string | null; message: string };
export type InterfaceInfo = {
  vid: string;
  pid: string;
  interface: number;
  usagePage: string;
  usage: string;
  product: string;
  role: string;
  path: string;
};
export type Lighting = {
  mode: number;
  color: string;
  rainbow: boolean;
  brightness: number;
  speed: number;
  direction: number;
};
export type Profile = { id: string; name: string; lighting: Lighting };
export type ScheduleAction = "screen" | "profile" | "lightsOff" | "lightsOn" | "sync" | "rotationOn" | "rotationOff";
export type Schedule = {
  id: string;
  enabled: boolean;
  time: string;
  days: number[];
  action: ScheduleAction;
  target: string | null;
};
export type Rotation = { enabled: boolean; intervalMin: number; source: "favorites" | "all"; shuffle: boolean };
export type StreamMode = "paint" | "effect" | "meter" | "music" | "ambilight" | "pomodoro";
export type StreamConfig = {
  mode: StreamMode;
  effect: string;
  speed: number;
  colorA: string;
  colorB: string;
  brightness: number;
  reverse: boolean;
  colors: string[];
  musicStyle: string;
  sensitivity: number;
  saturation: number;
  workMin: number;
  breakMin: number;
  ambiSource: "screen" | "window" | "wallpaper";
  ambiTarget: string;
};
export type AmbiTargets = {
  monitors: { id: string; name: string; primary: boolean; width: number; height: number }[];
  windows: { key: string; app: string; title: string }[];
};
export type AppRule = { id: string; enabled: boolean; process: string; action: "profile" | "screen" | "stream" | "lightsOff"; target: string | null };
export type NowPlaying = { title: string; artist: string; album: string; app: string; playing: boolean; thumb: string };
export type WallpaperInfo = { source: "windows" | "engine"; title: string; path: string; ext: string; stamp: number };
export type UiPrefs = {
  nowPlaying?: { auto: boolean; template: string; onlyPlaying: boolean };
  wallpaper?: { autoScreen: boolean; autoColor: boolean; source: "windows" | "engine"; monitor?: string };
  weather?: { name: string; lat: number; lon: number; autoHours: number; template: string } | null;
};
export type Settings = {
  autoSyncOnConnect: boolean;
  syncIntervalMin: number;
  minimizeToTray: boolean;
  startWithWindows: boolean;
  lighting: Lighting | null;
  sleep: number | null;
  maxFrames: number;
  dithering: boolean;
  profiles: Profile[];
  schedules: Schedule[];
  rotation: Rotation;
  shortcutsEnabled: boolean;
  keymap: string[] | null;
  stream: StreamConfig | null;
  streamAutostart: boolean;
  nowPlayingEnabled: boolean;
  wallpaperWatch: "off" | "windows" | "engine";
  appRules: AppRule[];
  appRulesEnabled: boolean;
  ui: UiPrefs;
  autoUpdateCheck: boolean;
};
export type BuildInfo = { version: string; commit: string; repo: string; branch: string; sourceDir: string; canUpdate: boolean };
export type GalleryItem = {
  id: string;
  name: string;
  created: number;
  frames: number;
  delays: number[];
  thumb: string;
  favorite: boolean;
};
export type LogEntry = { ts: number; kind: "ok" | "error" | "info"; message: string };
export type Progress = { done: number; total: number };
export type Notice = { kind: "ok" | "error" | "info"; message: string };

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function packBody(meta: unknown, data: Uint8Array): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(meta));
  const body = new Uint8Array(4 + json.length + data.length);
  new DataView(body.buffer).setUint32(0, json.length, true);
  body.set(json, 4);
  body.set(data, 4 + json.length);
  return body;
}

function errText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}

async function call<T>(cmd: string, args?: Record<string, unknown> | Uint8Array): Promise<T> {
  try {
    return await invoke<T>(cmd, args as never);
  } catch (e) {
    throw new Error(errText(e));
  }
}

const toBytes = (buf: ArrayBuffer | number[]) => (buf instanceof ArrayBuffer ? new Uint8Array(buf) : Uint8Array.from(buf));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ------------------------------------------------------------------ simulação

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
type Listener<T> = Set<(v: T) => void>;
const mock = {
  settings: {
    autoSyncOnConnect: true,
    syncIntervalMin: 60,
    minimizeToTray: true,
    startWithWindows: false,
    lighting: null,
    sleep: null,
    maxFrames: 140,
    dithering: true,
    profiles: [],
    schedules: [],
    rotation: { enabled: false, intervalMin: 60, source: "favorites", shuffle: false },
    shortcutsEnabled: true,
    keymap: null,
    stream: null,
    streamAutostart: false,
    nowPlayingEnabled: false,
    wallpaperWatch: "off",
    appRules: [],
    appRulesEnabled: true,
    ui: {},
    autoUpdateCheck: true,
  } as Settings,
  nowPlaying: null as NowPlaying | null,
  npL: new Set() as Listener<NowPlaying | null>,
  gallery: [] as (GalleryItem & { data: Uint8Array })[],
  current: null as string | null,
  stream: null as StreamConfig | null,
  lightsOff: false,
  log: [] as LogEntry[],
  progress: new Set() as Listener<Progress>,
  activity: new Set() as Listener<LogEntry>,
  streamL: new Set() as Listener<StreamConfig | null>,
  addLog(kind: LogEntry["kind"], message: string) {
    const e = { ts: Date.now(), kind, message };
    mock.log.unshift(e);
    mock.activity.forEach((f) => f(e));
  },
  async fakeUpload(frames: number) {
    const total = Math.ceil((256 + frames * 32768) / 4096);
    for (let i = 0; i <= total; i++) {
      mock.progress.forEach((f) => f({ done: i, total }));
      await sleep(25);
    }
  },
};

function download(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ------------------------------------------------------------------ API

export const api = {
  async status(): Promise<DeviceStatus> {
    if (!isTauri) return { state: "connected", product: "AK820 Pro (simulação)", message: "Modo demonstração — sem teclado real" };
    return call("device_status");
  },
  async diagnostics(): Promise<InterfaceInfo[]> {
    if (!isTauri)
      return [
        { vid: "0C45", pid: "8009", interface: 2, usagePage: "FF68", usage: "0001", product: "AK820 Pro", role: "dados (tela)", path: "simulado" },
        { vid: "0C45", pid: "8009", interface: 3, usagePage: "FF13", usage: "0001", product: "AK820 Pro", role: "controle", path: "simulado" },
      ];
    return call("diagnostics");
  },
  async ping(): Promise<{ ms: number; imageInterface: boolean }> {
    if (!isTauri) {
      await sleep(120);
      return { ms: 18, imageInterface: true };
    }
    return call("ping");
  },
  async syncTime(): Promise<string> {
    if (!isTauri) {
      await sleep(400);
      const t = new Date().toLocaleTimeString("pt-BR");
      mock.addLog("ok", `Relógio sincronizado (${t})`);
      return t;
    }
    return call("sync_time");
  },
  async setLighting(lighting: Lighting): Promise<void> {
    if (!isTauri) {
      mock.settings.lighting = lighting;
      mock.stream = null;
      mock.streamL.forEach((f) => f(null));
      await sleep(400);
      return;
    }
    return call("set_lighting", { lighting });
  },
  async applyProfile(id: string): Promise<string> {
    if (!isTauri) {
      const p = mock.settings.profiles.find((x) => x.id === id);
      if (!p) throw new Error("perfil não encontrado");
      mock.settings.lighting = p.lighting;
      await sleep(300);
      return p.name;
    }
    return call("apply_profile", { id });
  },
  async toggleLights(): Promise<boolean> {
    if (!isTauri) {
      mock.lightsOff = !mock.lightsOff;
      return mock.lightsOff;
    }
    return call("toggle_lights");
  },
  async lightsState(): Promise<boolean> {
    if (!isTauri) return mock.lightsOff;
    return call("lights_state");
  },
  async setSleep(value: number): Promise<void> {
    if (!isTauri) {
      await sleep(300);
      return;
    }
    return call("set_sleep", { value });
  },
  async streamSet(config: StreamConfig | null): Promise<void> {
    if (!isTauri) {
      mock.stream = config;
      if (config) mock.settings.stream = config;
      mock.streamL.forEach((f) => f(config));
      return;
    }
    return call("stream_set", { config });
  },
  async streamStatus(): Promise<StreamConfig | null> {
    if (!isTauri) return mock.stream;
    return call("stream_status");
  },
  async upload(frames: Uint8Array, delays: number[]): Promise<void> {
    if (!isTauri) {
      await mock.fakeUpload(frames.length / 32768);
      mock.addLog("ok", `Imagem enviada (${frames.length / 32768} quadros)`);
      return;
    }
    return call("upload", packBody({ delays }, frames));
  },
  async gallerySave(name: string, frames: Uint8Array, delays: number[], thumb: string): Promise<GalleryItem> {
    if (!isTauri) {
      const item = { id: uid(), name: name || "Sem nome", created: Date.now(), frames: frames.length / 32768, delays, thumb, favorite: false, data: frames.slice() };
      mock.gallery.unshift(item);
      return item;
    }
    return call("gallery_save", packBody({ name, delays, thumb }, frames));
  },
  async galleryList(): Promise<GalleryItem[]> {
    if (!isTauri) return mock.gallery.map(({ data: _d, ...rest }) => rest);
    return call("gallery_list");
  },
  async galleryFrames(id: string): Promise<Uint8Array> {
    if (!isTauri) return mock.gallery.find((g) => g.id === id)?.data ?? new Uint8Array(32768);
    return toBytes(await call<ArrayBuffer | number[]>("gallery_frames", { id }));
  },
  async galleryUpload(id: string): Promise<void> {
    if (!isTauri) {
      const g = mock.gallery.find((x) => x.id === id);
      await mock.fakeUpload(g?.frames ?? 1);
      mock.current = id;
      mock.addLog("ok", `Tela “${g?.name}” enviada`);
      return;
    }
    return call("gallery_upload", { id });
  },
  async stepScreen(step: number): Promise<string> {
    if (!isTauri) {
      const list = mock.gallery;
      if (!list.length) throw new Error("a galeria está vazia");
      const pos = list.findIndex((g) => g.id === mock.current);
      const next = list[(pos + step + list.length) % list.length];
      await api.galleryUpload(next.id);
      return next.name;
    }
    return call("step_screen", { step });
  },
  async galleryCurrent(): Promise<string | null> {
    if (!isTauri) return mock.current;
    return call("gallery_current");
  },
  async galleryRename(id: string, name: string): Promise<void> {
    if (!isTauri) {
      const g = mock.gallery.find((x) => x.id === id);
      if (g) g.name = name;
      return;
    }
    return call("gallery_rename", { id, name });
  },
  async galleryDelete(id: string): Promise<void> {
    if (!isTauri) {
      mock.gallery = mock.gallery.filter((g) => g.id !== id);
      return;
    }
    return call("gallery_delete", { id });
  },
  async gallerySetFavorite(id: string, favorite: boolean): Promise<void> {
    if (!isTauri) {
      const g = mock.gallery.find((x) => x.id === id);
      if (g) g.favorite = favorite;
      return;
    }
    return call("gallery_set_favorite", { id, favorite });
  },
  async galleryDuplicate(id: string): Promise<GalleryItem> {
    if (!isTauri) {
      const g = mock.gallery.find((x) => x.id === id)!;
      const copy = { ...g, id: uid(), name: `${g.name} (cópia)`, created: Date.now() };
      mock.gallery.unshift(copy);
      return copy;
    }
    return call("gallery_duplicate", { id });
  },
  async galleryExport(item: GalleryItem): Promise<boolean> {
    const name = `${item.name.replace(/[\\/:*?"<>|]/g, "_")}.ak820`;
    if (!isTauri) {
      download(name, mock.gallery.find((g) => g.id === item.id)?.data ?? new Uint8Array());
      return true;
    }
    const bytes = toBytes(await call<ArrayBuffer>("gallery_export", { id: item.id }));
    return saveBytes(name, [{ name: "Item do AK820 Studio", extensions: ["ak820"] }], bytes);
  },
  async galleryImport(): Promise<GalleryItem | null> {
    if (!isTauri) return null;
    const path = await pickFile([{ name: "Item do AK820 Studio", extensions: ["ak820"] }]);
    if (!path) return null;
    return call("gallery_import", { path });
  },
  async getSettings(): Promise<Settings> {
    if (!isTauri) return structuredClone(mock.settings);
    return call("get_settings");
  },
  async saveSettings(settings: Settings): Promise<Settings> {
    if (!isTauri) {
      const keep = { lighting: mock.settings.lighting, sleep: mock.settings.sleep, stream: mock.settings.stream, keymap: mock.settings.keymap };
      mock.settings = { ...structuredClone(settings), ...keep };
      return structuredClone(mock.settings);
    }
    return call("save_settings", { settings });
  },
  async runSchedule(action: ScheduleAction, target: string | null): Promise<string> {
    if (!isTauri) {
      await sleep(300);
      return `Ação "${action}" executada (simulação)`;
    }
    return call("run_schedule", { action, target });
  },
  async shortcutList(): Promise<[string, string][]> {
    const list: [string, string][] = [
      ["Ctrl+Alt+→", "Próxima tela da galeria"],
      ["Ctrl+Alt+←", "Tela anterior"],
      ["Ctrl+Alt+L", "Liga/desliga as luzes"],
      ["Ctrl+Alt+P", "Liga/desliga o RGB do PC"],
      ["Ctrl+Alt+T", "Sincroniza o relógio"],
      ["Ctrl+Alt+1…5", "Aplica o perfil de luz 1 a 5"],
    ];
    if (!isTauri) return list;
    return call("shortcut_list");
  },
  async activityLog(): Promise<LogEntry[]> {
    if (!isTauri) return [...mock.log];
    return call("activity_log");
  },
  async activityClear(): Promise<void> {
    if (!isTauri) {
      mock.log = [];
      return;
    }
    return call("activity_clear");
  },
  async exportBackup(): Promise<boolean> {
    const name = `ak820-studio-backup-${new Date().toISOString().slice(0, 10)}.json`;
    if (!isTauri) {
      download(name, new TextEncoder().encode(JSON.stringify({ app: "AK820 Studio", version: 1, settings: mock.settings }, null, 2)));
      return true;
    }
    const json = await call<string>("export_backup");
    return saveBytes(name, [{ name: "Backup JSON", extensions: ["json"] }], new TextEncoder().encode(json));
  },
  async importBackup(): Promise<Settings | null> {
    if (!isTauri) return null;
    const path = await pickFile([{ name: "Backup JSON", extensions: ["json"] }]);
    if (!path) return null;
    const bytes = toBytes(await call<ArrayBuffer>("read_file", { path }));
    return call("import_backup", { json: new TextDecoder().decode(bytes) });
  },
};

// ------------------------------------------------------------------ v0.3

export const api3 = {
  async nowPlayingSet(enabled: boolean): Promise<void> {
    if (!isTauri) {
      mock.settings.nowPlayingEnabled = enabled;
      mock.nowPlaying = enabled ? { title: "Blinding Lights", artist: "The Weeknd", album: "After Hours", app: "Spotify.exe", playing: true, thumb: "" } : null;
      setTimeout(() => mock.npL.forEach((f) => f(mock.nowPlaying)), 300);
      return;
    }
    return call("now_playing_set", { enabled });
  },
  async nowPlayingGet(): Promise<NowPlaying | null> {
    if (!isTauri) return mock.nowPlaying;
    return call("now_playing_get");
  },
  async wallpaperGet(source: "windows" | "engine", monitor?: string): Promise<WallpaperInfo> {
    if (!isTauri) throw new Error("Disponível só no app do Windows");
    return call("wallpaper_get", { source, monitor: monitor ?? null });
  },
  async wallpaperEngineMonitors(): Promise<{ key: string; title: string }[]> {
    if (!isTauri) return [];
    return call("wallpaper_engine_monitors");
  },
  async readFile(path: string): Promise<Uint8Array> {
    return toBytes(await call<ArrayBuffer>("read_file", { path }));
  },
  async listProcesses(): Promise<string[]> {
    if (!isTauri) return ["chrome.exe", "discord.exe", "explorer.exe", "spotify.exe", "steam.exe", "valorant.exe"];
    return call("list_processes");
  },
  async activeRule(): Promise<string | null> {
    if (!isTauri) return null;
    return call("active_rule");
  },
  async buildInfo(): Promise<BuildInfo> {
    if (!isTauri) return { version: "0.3.0", commit: "0000000000000000000000000000000000000000", repo: "akuma654e/-ak820-studio", branch: "main", sourceDir: "C:\\Users\\voce\\-ak820-studio", canUpdate: true };
    return call("build_info");
  },
  async updateRun(): Promise<void> {
    if (!isTauri) throw new Error("Simulação: no app de verdade abriria o PowerShell com git pull + compilação.");
    return call("update_run");
  },
  async appVersion(): Promise<string> {
    if (!isTauri) return "0.3.0";
    return call("app_version");
  },
  async ambilightTargets(): Promise<AmbiTargets> {
    if (!isTauri)
      return {
        monitors: [
          { id: "65537", name: "\\\\.\\DISPLAY1", primary: true, width: 2560, height: 1440 },
          { id: "65539", name: "\\\\.\\DISPLAY2", primary: false, width: 1920, height: 1080 },
        ],
        windows: [
          { key: "chrome.exe|YouTube - Google Chrome", app: "chrome.exe", title: "YouTube - Google Chrome" },
          { key: "Spotify.exe|Spotify Premium", app: "Spotify.exe", title: "Spotify Premium" },
          { key: "VALORANT.exe|VALORANT", app: "VALORANT.exe", title: "VALORANT" },
        ],
      };
    return call("ambilight_targets");
  },
  async pomodoroReset(): Promise<void> {
    if (!isTauri) return;
    return call("pomodoro_reset");
  },
};

// ------------------------------------------------------------------ arquivos

export type FileFilter = { name: string; extensions: string[] };

/** Abre "Salvar como" e grava os bytes. Retorna false se o usuário cancelar. */
export async function saveBytes(defaultName: string, filters: FileFilter[], bytes: Uint8Array): Promise<boolean> {
  if (!isTauri) {
    download(defaultName, bytes);
    return true;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ defaultPath: defaultName, filters });
  if (!path) return false;
  await call("write_file", packBody({ path }, bytes));
  return true;
}

export async function pickFile(filters: FileFilter[]): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ multiple: false, directory: false, filters });
  return typeof r === "string" ? r : null;
}

// ------------------------------------------------------------------ eventos

function on<T>(event: string, cb: (v: T) => void, mockSet?: Listener<T>): Promise<UnlistenFn> {
  if (!isTauri) {
    if (!mockSet) return Promise.resolve(() => {});
    const h = (v: T) => cb(v); // função própria: remover não afeta outra inscrição igual
    mockSet.add(h);
    return Promise.resolve(() => void mockSet.delete(h));
  }
  return listen<T>(event, (e) => cb(e.payload));
}

export const onProgress = (cb: (p: Progress) => void) => on("upload-progress", cb, mock.progress);
export const onStatus = (cb: (s: DeviceStatus) => void) => on("device-status", cb);
export const onNotice = (cb: (n: Notice) => void) => on("notice", cb);
export const onActivity = (cb: (e: LogEntry) => void) => on("activity", cb, mock.activity);
export const onStream = (cb: (s: StreamConfig | null) => void) => on("stream-changed", cb, mock.streamL);
export const onLighting = (cb: (l: Lighting) => void) => on("lighting-changed", cb);
export const onSettingsChanged = (cb: () => void) => on("settings-changed", cb);
export const onScreenChanged = (cb: (id: string) => void) => on("screen-changed", cb);
export const onNowPlaying = (cb: (n: NowPlaying | null) => void) => on("now-playing", cb, mock.npL);
export const onWallpaperChanged = (cb: (source: string) => void) => on("wallpaper-changed", cb);
export const onActiveRule = (cb: (id: string | null) => void) => on("active-rule", cb);
