import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, api3, isTauri, onNotice, onNowPlaying, onProgress, onSettingsChanged, onStatus, onWallpaperChanged, type DeviceStatus, type GalleryItem, type NowPlaying, type Settings } from "./lib/api";
import { UpdateBanner } from "./components/Updates";
import { colorOf, lightingWithColor, loadWallpaper, renderFile, renderNP, renderWeatherFor, upload as quietUpload } from "./lib/integrations";
import { Icon } from "./components/ui";
import { DisplayPage } from "./pages/Display";
import { GalleryPage } from "./pages/Gallery";
import { LightingPage } from "./pages/Lighting";
import { SystemPage } from "./pages/System";
import { AutomationPage } from "./pages/Automation";
import { IntegrationsPage } from "./pages/Integrations";

type Page = "display" | "gallery" | "lighting" | "integrations" | "automation" | "system";
type Toast = { id: number; kind: "ok" | "error" | "info"; message: string };
type UploadState = { label: string; done: number; total: number } | null;

type Ctx = {
  status: DeviceStatus;
  ready: boolean;
  settings: Settings | null;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  toast: (kind: Toast["kind"], message: string) => void;
  upload: UploadState;
  runUpload: (label: string, fn: () => Promise<void>) => Promise<boolean>;
  busy: boolean;
  go: (p: Page) => void;
  galleryVersion: number;
  bumpGallery: () => void;
  editorRequest: GalleryItem | null;
  openInEditor: (item: GalleryItem) => void;
  clearEditorRequest: () => void;
  lastScreen: ImageData | null;
  setLastScreen: (img: ImageData | null) => void;
  reloadSettings: () => void;
  nowPlaying: NowPlaying | null;
  editorFile: File | null;
  openFileInEditor: (file: File) => void;
  clearEditorFile: () => void;
};

const AppCtx = createContext<Ctx>(null as never);
export const useApp = () => useContext(AppCtx);

const NAV: { id: Page; label: string; icon: Parameters<typeof Icon>[0]["name"] }[] = [
  { id: "display", label: "Tela", icon: "screen" },
  { id: "gallery", label: "Galeria", icon: "gallery" },
  { id: "lighting", label: "Iluminação", icon: "light" },
  { id: "integrations", label: "Música e wallpaper", icon: "music" },
  { id: "automation", label: "Automação", icon: "calendar" },
  { id: "system", label: "Relógio e sistema", icon: "clock" },
];

const STATUS_LABEL: Record<DeviceStatus["state"], string> = {
  connected: "Conectado",
  partial: "Conexão parcial",
  wireless: "Sem fio",
  bootloader: "Bootloader",
  disconnected: "Desconectado",
  error: "Erro",
};

export default function App() {
  const [page, setPage] = useState<Page>("display");
  const [status, setStatus] = useState<DeviceStatus>({ state: "disconnected", product: null, message: "Procurando teclado…" });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [upload, setUpload] = useState<UploadState>(null);
  const [galleryVersion, setGalleryVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const [editorRequest, setEditorRequest] = useState<GalleryItem | null>(null);
  const [lastScreen, setLastScreen] = useState<ImageData | null>(null);
  const [lightsOff, setLightsOff] = useState(false);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [editorFile, setEditorFile] = useState<File | null>(null);
  const toastId = useRef(0);

  const toast = useCallback((kind: Toast["kind"], message: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 9000 : 4500);
  }, []);

  useEffect(() => {
    const offs: Promise<() => void>[] = [onStatus(setStatus), onNotice((n) => toast(n.kind, n.message)), onProgress((p) => setUpload((u) => (u ? { ...u, done: p.done, total: p.total } : u)))];
    api.status().then(setStatus).catch((e) => setStatus({ state: "error", product: null, message: String(e.message ?? e) })).finally(() => setReady(true));
    api.getSettings().then(setSettings).catch(() => undefined);
    api.lightsState().then(setLightsOff).catch(() => undefined);
    offs.push(onSettingsChanged(() => api.getSettings().then(setSettings)));
    offs.push(onNowPlaying(setNowPlaying));
    api3.nowPlayingGet().then(setNowPlaying).catch(() => undefined);
    return () => {
      offs.forEach((p) => p.then((f) => f()));
    };
  }, [toast]);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      if (!settings) return;
      const next = { ...settings, ...patch };
      setSettings(next);
      try {
        setSettings(await api.saveSettings(next));
      } catch (e) {
        setSettings(settings);
        toast("error", (e as Error).message);
      }
    },
    [settings, toast],
  );

  const runUpload = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      if (upload) return false;
      setUpload({ label, done: 0, total: 0 });
      try {
        await fn();
        toast("ok", "Imagem enviada para o teclado");
        return true;
      } catch (e) {
        toast("error", (e as Error).message);
        return false;
      } finally {
        setUpload(null);
      }
    },
    [upload, toast],
  );

  const ctx: Ctx = {
    status,
    ready,
    settings,
    updateSettings,
    toast,
    upload,
    runUpload,
    busy: upload !== null,
    go: setPage,
    galleryVersion,
    bumpGallery: () => setGalleryVersion((v) => v + 1),
    editorRequest,
    openInEditor: (item) => {
      setEditorRequest(item);
      setPage("display");
    },
    clearEditorRequest: useCallback(() => setEditorRequest(null), []),
    lastScreen,
    setLastScreen,
    reloadSettings: () => void api.getSettings().then(setSettings),
    nowPlaying,
    editorFile,
    openFileInEditor: (file) => {
      setEditorFile(file);
      setPage("display");
    },
    clearEditorFile: useCallback(() => setEditorFile(null), []),
  };

  const quick = async (fn: () => Promise<unknown>, ok?: (r: unknown) => string) => {
    try {
      const r = await fn();
      if (ok) toast("ok", ok(r));
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  const online = status.state === "connected" || status.state === "partial";

  return (
    <AppCtx.Provider value={ctx}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark" aria-hidden>
              <span />
            </div>
            <div>
              <strong>AK820 Studio</strong>
              <span className="muted small">AJAZZ AK820 Pro</span>
            </div>
          </div>
          <nav>
            {NAV.map((n) => (
              <button
                key={n.id}
                className={`nav-item ${page === n.id ? "active" : ""}`}
                onClick={() => {
                  setPage(n.id);
                  if (n.id === "gallery") setGalleryVersion((v) => v + 1);
                }}
              >
                <Icon name={n.icon} />
                <span>{n.label}</span>
              </button>
            ))}
          </nav>
          <div className="quick">
            <button
              className={`btn sm ${lightsOff ? "" : "on"}`}
              disabled={!online || upload !== null}
              title="Liga/desliga as luzes (Ctrl+Alt+L)"
              onClick={() =>
                quick(
                  async () => {
                    const off = await api.toggleLights();
                    setLightsOff(off);
                    return off;
                  },
                  (off) => (off ? "Luzes apagadas" : "Luzes acesas"),
                )
              }
            >
              <Icon name="power" size={15} /> Luzes
            </button>
            <button className="btn sm" disabled={!online || upload !== null} title="Próxima tela da galeria (Ctrl+Alt+→)" onClick={() => runUpload("Trocando a tela", async () => void (await api.stepScreen(1)))}>
              <Icon name="next" size={15} /> Tela
            </button>
          </div>
          <div className={`device ${status.state}`} title={status.message}>
            <span className="dot" />
            <div>
              <strong>{STATUS_LABEL[status.state]}</strong>
              <span className="small muted">{online ? status.product ?? "AK820 Pro" : status.message}</span>
            </div>
          </div>
          {!isTauri && <div className="demo-flag">Modo demonstração</div>}
        </aside>

        <main className="content">
          {status.state !== "connected" && ready && <StatusBanner status={status} />}
          {/* As páginas ficam montadas para não perder a edição ao trocar de aba. */}
          <PageView show={page === "display"}>
            <DisplayPage active={page === "display"} />
          </PageView>
          <PageView show={page === "gallery"}>
            <GalleryPage />
          </PageView>
          <PageView show={page === "lighting"}>
            <LightingPage />
          </PageView>
          <PageView show={page === "integrations"}>
            <IntegrationsPage />
          </PageView>
          <PageView show={page === "automation"}>
            <AutomationPage />
          </PageView>
          <PageView show={page === "system"}>
            <SystemPage />
          </PageView>
        </main>

        {upload && <UploadOverlay upload={upload} />}
        <BackgroundJobs />
        <UpdateBanner />

        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`}>
              <Icon name={t.kind === "error" ? "x" : "check"} size={16} />
              <span>{t.message}</span>
            </div>
          ))}
        </div>
      </div>
    </AppCtx.Provider>
  );
}

function PageView({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <div className={`page ${show ? "shown" : ""}`} hidden={!show}>
      {children}
    </div>
  );
}

function StatusBanner({ status }: { status: DeviceStatus }) {
  const tips: Record<string, string> = {
    disconnected: "Ligue o teclado com um cabo USB-C de dados e coloque a chave atrás dele no modo com fio.",
    wireless: "A configuração só funciona com fio. Conecte o cabo USB-C e mude a chave para o modo com fio.",
    partial: "Se o software oficial da AJAZZ estiver aberto, feche (inclusive na bandeja do Windows).",
    bootloader: "O teclado está em modo de gravação de firmware. Desconecte e conecte de novo para voltar ao normal.",
    error: "Tente desconectar e conectar o cabo de novo.",
  };
  return (
    <div className={`banner ${status.state}`}>
      <Icon name="usb" />
      <div>
        <strong>{status.message}</strong>
        <span>{tips[status.state] ?? ""}</span>
      </div>
    </div>
  );
}

function UploadOverlay({ upload }: { upload: NonNullable<UploadState> }) {
  const pct = upload.total ? Math.round((upload.done / upload.total) * 100) : 0;
  return (
    <div className="overlay" role="dialog" aria-label="Enviando">
      <div className="overlay-card">
        <div className="spinner" />
        <h3>{upload.label}</h3>
        <p className="muted">Não desconecte o teclado nem mude a chave de modo.</p>
        <div className="progress">
          <div style={{ width: `${pct}%` }} />
        </div>
        <span className="small muted">{upload.total ? `${upload.done} de ${upload.total} blocos · ${pct}%` : "Preparando…"}</span>
      </div>
    </div>
  );
}

/** Tarefas automáticas das integrações: música, wallpaper e clima. */
function BackgroundJobs() {
  const { settings, status, nowPlaying, toast, setLastScreen, upload } = useApp();
  const lastSong = useRef("");
  const lastWeather = useRef(0);
  const online = status.state === "connected";
  const ref = useRef({ settings, online, upload });
  ref.current = { settings, online, upload };

  // Tocando agora → tela
  useEffect(() => {
    const np = nowPlaying;
    const cfg = settings?.ui.nowPlaying;
    if (!np || !cfg?.auto || !settings?.nowPlayingEnabled || !online) return;
    if (cfg.onlyPlaying && !np.playing) return;
    const key = `${np.title}|${np.artist}`;
    if (key === lastSong.current) return;
    const t = window.setTimeout(async () => {
      if (ref.current.upload) return;
      lastSong.current = key;
      try {
        const r = await renderNP(np, cfg.template || "cover");
        await quietUpload(r);
        setLastScreen(r.previews[0]);
        toast("info", `Tela: ${np.title}`);
      } catch (e) {
        toast("error", `Tocando agora: ${(e as Error).message}`);
      }
    }, 2500);
    return () => window.clearTimeout(t);
  }, [nowPlaying, settings, online, toast, setLastScreen]);

  // Wallpaper mudou
  useEffect(() => {
    const off = onWallpaperChanged(async (source) => {
      const { settings: s, online: on } = ref.current;
      const w = s?.ui.wallpaper;
      if (!s || !w || !on || (!w.autoScreen && !w.autoColor)) return;
      try {
        const { file } = await loadWallpaper(source as "windows" | "engine", w.monitor);
        const r = await renderFile(file, s.maxFrames);
        if (w.autoScreen) {
          await quietUpload(r);
          setLastScreen(r.previews[0]);
        }
        if (w.autoColor) await api.setLighting(lightingWithColor(s.lighting, colorOf(r)));
        toast("info", "Wallpaper novo aplicado ao teclado");
      } catch (e) {
        toast("error", `Wallpaper: ${(e as Error).message}`);
      }
    });
    return () => void off.then((f) => f());
  }, [toast, setLastScreen]);

  // Clima periódico
  useEffect(() => {
    const check = async () => {
      const { settings: s, online: on, upload: busy } = ref.current;
      const w = s?.ui.weather;
      if (!s || !w || !w.autoHours || !on || busy) return;
      if (Date.now() - lastWeather.current < w.autoHours * 3600_000) return;
      lastWeather.current = Date.now();
      try {
        const r = await renderWeatherFor(s);
        await quietUpload(r);
        setLastScreen(r.previews[0]);
      } catch (e) {
        toast("error", `Clima: ${(e as Error).message}`);
      }
    };
    const first = window.setTimeout(check, 20_000);
    const t = window.setInterval(check, 5 * 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, [toast, setLastScreen]);

  return null;
}
