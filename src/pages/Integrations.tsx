import { useEffect, useRef, useState } from "react";
import { useApp } from "../App";
import { api, api3, isTauri, onStream, type AmbiTargets, type Settings, type StreamConfig, type UiPrefs, type WallpaperInfo } from "../lib/api";
import { NP_TEMPLATES, searchCity, WEATHER_TEMPLATES, type Place } from "../lib/cards";
import { colorOf, coverBitmap, lightingWithColor, loadWallpaper, renderFile, renderNP, renderWeatherFor, upload } from "../lib/integrations";
import { MUSIC_STYLES, MusicPreview } from "../lib/pcfx";
import { type Rendered } from "../lib/imaging";
import { ScreenPreview } from "../components/ScreenPreview";
import { Card, ColorField, Icon, Segmented, Select, Slider, Toggle } from "../components/ui";
import { DEFAULT_STREAM, KeyRows } from "./Lighting";

type Tab = "music" | "wallpaper" | "weather" | "focus";

/** Estado do RGB do PC para um modo específico (música, ambilight, pomodoro). */
function useStreamMode(mode: StreamConfig["mode"]) {
  const { settings, toast, status } = useApp();
  const [cfg, setCfg] = useState<StreamConfig>(() => ({ ...DEFAULT_STREAM, ...settings?.stream, mode }));
  const [activeMode, setActiveMode] = useState<string | null>(null);
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current || !settings) return;
    loaded.current = true;
    setCfg({ ...DEFAULT_STREAM, ...settings.stream, mode });
  }, [settings, mode]);
  useEffect(() => {
    api.streamStatus().then((s) => setActiveMode(s?.mode ?? null));
    const off = onStream((s) => setActiveMode(s?.mode ?? null));
    return () => void off.then((f) => f());
  }, []);
  const active = activeMode === mode;
  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => void api.streamSet(cfg).catch((e) => toast("error", e.message)), 150);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);
  const toggle = async () => {
    try {
      await api.streamSet(active ? null : cfg);
      setActiveMode(active ? null : mode);
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };
  const online = status.state === "connected" || status.state === "partial";
  return { cfg, p: (x: Partial<StreamConfig>) => setCfg((c) => ({ ...c, ...x })), active, otherActive: !!activeMode && !active, toggle, online };
}

function StreamButton({ active, online, toggle, label }: { active: boolean; online: boolean; toggle: () => void; label: string }) {
  return (
    <button className={`btn ${active ? "danger" : "primary"}`} disabled={!online && !active} onClick={toggle}>
      <Icon name={active ? "pause" : "play"} /> {active ? "Parar" : label}
    </button>
  );
}

export function IntegrationsPage() {
  const [tab, setTab] = useState<Tab>("music");
  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Música e wallpaper</h1>
          <p className="muted">O teclado reagindo ao que acontece no PC: som, música, papel de parede, clima e foco.</p>
        </div>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "music", label: "Música" },
            { value: "wallpaper", label: "Wallpaper" },
            { value: "weather", label: "Clima" },
            { value: "focus", label: "Foco" },
          ]}
        />
      </header>
      <div hidden={tab !== "music"}>
        <MusicTab />
      </div>
      <div hidden={tab !== "wallpaper"}>
        <WallpaperTab />
      </div>
      <div hidden={tab !== "weather"}>
        <WeatherTab />
      </div>
      <div hidden={tab !== "focus"}>
        <FocusTab />
      </div>
    </div>
  );
}

function useUi() {
  const { settings, updateSettings } = useApp();
  const ui = settings?.ui ?? {};
  const setUi = <K extends keyof UiPrefs>(k: K, v: UiPrefs[K]) => settings && updateSettings({ ui: { ...settings.ui, [k]: v } } as Partial<Settings>);
  return { ui, setUi };
}

// ================================================================== música

function MusicTab() {
  const { settings, updateSettings, nowPlaying, toast, runUpload, status, busy, setLastScreen } = useApp();
  const { cfg, p, active, otherActive, toggle, online } = useStreamMode("music");
  const { ui, setUi } = useUi();
  const np = ui.nowPlaying ?? { auto: false, template: "cover", onlyPlaying: true };
  const [live, setLive] = useState<string[]>([]);
  const [npPreview, setNpPreview] = useState<Rendered | null>(null);
  const [cover, setCover] = useState<string | null>(null);
  const prev = useRef(new MusicPreview());

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 50) return;
      last = now;
      const b = cfg.brightness;
      setLive(prev.current.frame(cfg.musicStyle, (now - t0) / 1000, cfg.colorA, cfg.colorB).map((c) => c.replace(/\d+/g, (v) => String(Math.round(+v * b)))));
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cfg.musicStyle, cfg.colorA, cfg.colorB, cfg.brightness]);

  // prévia da tela "tocando agora"
  useEffect(() => {
    if (!nowPlaying) {
      setNpPreview(null);
      setCover(null);
      return;
    }
    let alive = true;
    renderNP(nowPlaying, np.template).then((r) => alive && setNpPreview(r));
    coverBitmap(nowPlaying).then((b) => {
      if (!alive || !b) return setCover(null);
      const c = document.createElement("canvas");
      c.width = b.width;
      c.height = b.height;
      c.getContext("2d")!.drawImage(b, 0, 0);
      setCover(c.toDataURL());
      b.close();
    });
    return () => {
      alive = false;
    };
  }, [nowPlaying, np.template]);

  const setNp = (x: Partial<typeof np>) => setUi("nowPlaying", { ...np, ...x });

  const sendNow = () =>
    nowPlaying &&
    runUpload("Enviando “tocando agora”", async () => {
      const r = await renderNP(nowPlaying, np.template);
      await upload(r);
      setLastScreen(r.previews[0]);
    });

  return (
    <>
      <div className="kb live" aria-label="Prévia do visualizador">
        <KeyRows render={(k) => ({ style: { background: live[k.index] ?? "#000", borderColor: "rgba(255,255,255,0.08)" } })} />
        <span className="kb-note small">Prévia com som simulado</span>
      </div>

      <div className="lighting-layout">
        <Card
          title="Visualizador de música nas teclas"
          subtitle="Escuta o som que está tocando no PC (Spotify, YouTube, jogos) e acende as teclas no ritmo."
          actions={<StreamButton active={active} online={online} toggle={toggle} label="Ligar" />}
        >
          {otherActive && <p className="small warn">Outro modo do RGB do PC está ligado; ligar este vai substituí-lo.</p>}
          <div className="style-grid">
            {MUSIC_STYLES.map((s) => (
              <button key={s.value} className={`style-card ${cfg.musicStyle === s.value ? "on" : ""}`} onClick={() => p({ musicStyle: s.value })}>
                <strong>{s.label}</strong>
                <span className="small muted">{s.desc}</span>
              </button>
            ))}
          </div>
          <Slider label="Sensibilidade" value={cfg.sensitivity} min={0.3} max={3} step={0.1} onChange={(sensitivity) => p({ sensitivity })} format={(v) => `${v.toFixed(1)}×`} />
          <Slider label="Brilho" value={cfg.brightness} min={0.1} max={1} step={0.05} onChange={(brightness) => p({ brightness })} format={(v) => `${Math.round(v * 100)}%`} />
          {(cfg.musicStyle === "spectrum" || cfg.musicStyle === "ripple") && (
            <div className="row tight">
              <ColorField label={cfg.musicStyle === "spectrum" ? "Base" : "Cor 1"} value={cfg.colorA} onChange={(colorA) => p({ colorA })} />
              <ColorField label={cfg.musicStyle === "spectrum" ? "Topo" : "Cor 2"} value={cfg.colorB} onChange={(colorB) => p({ colorB })} />
            </div>
          )}
        </Card>

        <Card title="Tocando agora na tela" subtitle="Mostra a capa e o nome da música na telinha. Funciona com Spotify, YouTube no navegador, Apple Music e outros.">
          <Toggle
            label="Detectar a música do Windows"
            checked={!!settings?.nowPlayingEnabled}
            onChange={async (v) => {
              try {
                await api3.nowPlayingSet(v);
                await updateSettings({ nowPlayingEnabled: v });
              } catch (e) {
                toast("error", (e as Error).message);
              }
            }}
          />
          {settings?.nowPlayingEnabled && (
            <>
              <div className="np">
                <div className="np-cover">{cover ? <img src={cover} alt="" /> : <Icon name="music" size={26} />}</div>
                <div className="np-text">
                  <strong>{nowPlaying?.title || "Nada tocando"}</strong>
                  <span className="small muted">{nowPlaying ? `${nowPlaying.artist || "—"} · ${nowPlaying.playing ? "tocando" : "pausado"}` : "Dê play em alguma música"}</span>
                </div>
                {npPreview && (
                  <div className="np-screen">
                    <ScreenPreview previews={npPreview.previews} delays={[]} />
                  </div>
                )}
              </div>
              <Segmented value={np.template} onChange={(template) => setNp({ template })} options={NP_TEMPLATES} />
              <Toggle label="Trocar a tela a cada música" hint="Cada troca regrava a tela do teclado" checked={np.auto} onChange={(auto) => setNp({ auto })} />
              <Toggle label="Só quando estiver tocando" checked={np.onlyPlaying} onChange={(onlyPlaying) => setNp({ onlyPlaying })} />
              <button className="btn" disabled={!nowPlaying || busy || status.state !== "connected"} onClick={sendNow}>
                <Icon name="upload" /> Enviar agora
              </button>
            </>
          )}
        </Card>
      </div>
    </>
  );
}

// ================================================================== wallpaper

function WallpaperTab() {
  const { settings, updateSettings, toast, runUpload, status, busy, setLastScreen, openFileInEditor } = useApp();
  const { cfg, p, active, otherActive, toggle, online } = useStreamMode("ambilight");
  const { ui } = useUi();
  const w = ui.wallpaper ?? { autoScreen: false, autoColor: false, source: "windows" as const };
  const [info, setInfo] = useState<WallpaperInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [loading, setLoading] = useState(false);
  const [monitors, setMonitors] = useState<{ key: string; title: string }[]>([]);

  useEffect(() => {
    if (w.source !== "engine" || !isTauri) return setMonitors([]);
    api3.wallpaperEngineMonitors().then(setMonitors).catch(() => setMonitors([]));
  }, [w.source]);

  const setW = async (x: Partial<typeof w>) => {
    const next = { ...w, ...x };
    if (!settings) return;
    await updateSettings({ ui: { ...settings.ui, wallpaper: next }, wallpaperWatch: next.autoScreen || next.autoColor ? next.source : "off" });
  };

  const load = async (source = w.source, monitor = w.monitor) => {
    setLoading(true);
    try {
      if (source === "engine") api3.wallpaperEngineMonitors().then(setMonitors).catch(() => undefined);
      const r = await loadWallpaper(source, monitor);
      setInfo(r.info);
      setFile(r.file);
      setRendered(await renderFile(r.file, settings?.maxFrames ?? 140));
    } catch (e) {
      setInfo(null);
      setRendered(null);
      toast("error", (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const connected = status.state === "connected";

  return (
    <div className="lighting-layout">
      <div className="stack">
        <Card title="Wallpaper no teclado" subtitle="Pega o papel de parede atual e leva para a tela e/ou para o RGB.">
          <Segmented
            value={w.source}
            onChange={(source) => (setW({ source }), setInfo(null), setRendered(null))}
            options={[
              { value: "windows", label: "Windows" },
              { value: "engine", label: "Wallpaper Engine" },
            ]}
          />
          {w.source === "engine" && monitors.length > 1 && (
            <Select
              label="Monitor"
              value={w.monitor ?? monitors[0].key}
              onChange={(monitor) => (setW({ monitor }), void load("engine", monitor))}
              options={monitors.map((m) => ({ value: m.key, label: `${m.key.replace("Monitor", "Monitor ")} — ${m.title}` }))}
            />
          )}
          <div className="wall-row">
            <div className="wall-preview">{rendered ? <ScreenPreview previews={rendered.previews} delays={rendered.delays} /> : <Icon name="image" size={28} />}</div>
            <div className="stack" style={{ gap: 8 }}>
              <strong>{info?.title ?? (w.source === "engine" ? "Wallpaper Engine" : "Papel de parede do Windows")}</strong>
              <span className="small muted">
                {rendered ? `${rendered.previews.length > 1 ? `Animado · ${rendered.previews.length} quadros` : "Imagem estática"}` : w.source === "engine" ? "Usa a prévia do wallpaper ativo (GIFs animados funcionam)." : "Usa a imagem atual da área de trabalho."}
              </span>
              <div className="row tight">
                <button className="btn sm" disabled={loading || !isTauri} onClick={() => load()}>
                  <Icon name="refresh" size={15} /> {loading ? "Carregando…" : "Carregar atual"}
                </button>
                {file && (
                  <button className="btn sm ghost" onClick={() => openFileInEditor(file)}>
                    <Icon name="edit" size={15} /> Abrir no editor
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="row tight">
            <button
              className="btn primary"
              disabled={!rendered || busy || !connected}
              onClick={() =>
                rendered &&
                runUpload("Enviando wallpaper", async () => {
                  await upload(rendered);
                  setLastScreen(rendered.previews[0]);
                })
              }
            >
              <Icon name="upload" /> Enviar para a tela
            </button>
            <button
              className="btn"
              disabled={!rendered || !online}
              onClick={async () => {
                if (!rendered) return;
                const c = colorOf(rendered);
                try {
                  await api.setLighting(lightingWithColor(settings?.lighting ?? null, c));
                  toast("ok", `RGB na cor do wallpaper: ${c.toUpperCase()}`);
                } catch (e) {
                  toast("error", (e as Error).message);
                }
              }}
            >
              <span className="swatch mini" style={{ background: rendered ? colorOf(rendered) : "#333" }} /> Usar a cor no RGB
            </button>
          </div>
          <div className="divider" />
          <span className="small muted">Quando o wallpaper mudar:</span>
          <Toggle label="Enviar para a tela automaticamente" checked={w.autoScreen} onChange={(autoScreen) => setW({ autoScreen })} />
          <Toggle label="Mudar a cor do RGB automaticamente" checked={w.autoColor} onChange={(autoColor) => setW({ autoColor })} />
          {!isTauri && <p className="small muted">Disponível só no app do Windows.</p>}
        </Card>
      </div>

      <Card
        title="Ambilight"
        subtitle="As teclas copiam as cores em tempo real: o lado esquerdo da imagem vira o lado esquerdo do teclado."
        actions={<StreamButton active={active} online={online} toggle={toggle} label="Ligar" />}
      >
        {otherActive && <p className="small warn">Outro modo do RGB do PC está ligado; ligar este vai substituí-lo.</p>}
        <AmbiSourcePicker cfg={cfg} p={p} wallSource={w.source} wallMonitor={w.monitor} />
        <Slider label="Saturação" value={cfg.saturation} min={0.5} max={3} step={0.1} onChange={(saturation) => p({ saturation })} format={(v) => `${v.toFixed(1)}×`} />
        <Slider label="Brilho" value={cfg.brightness} min={0.1} max={1} step={0.05} onChange={(brightness) => p({ brightness })} format={(v) => `${Math.round(v * 100)}%`} />
        <p className="small muted">{cfg.ambiSource === "wallpaper" ? "Lê só a imagem do wallpaper: quase não gasta CPU." : "Gasta um pouco de CPU enquanto estiver ligado."}</p>
      </Card>
    </div>
  );
}

function AmbiSourcePicker({ cfg, p, wallSource, wallMonitor }: { cfg: StreamConfig; p: (x: Partial<StreamConfig>) => void; wallSource: "windows" | "engine"; wallMonitor?: string }) {
  const { toast } = useApp();
  const [targets, setTargets] = useState<AmbiTargets | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setTargets(await api3.ambilightTargets());
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (cfg.ambiSource !== "wallpaper" && !targets) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.ambiSource]);

  const setSource = (ambiSource: StreamConfig["ambiSource"]) => {
    let ambiTarget = "";
    if (ambiSource === "screen") ambiTarget = targets?.monitors.find((m) => m.primary)?.id ?? "";
    if (ambiSource === "window") ambiTarget = targets?.windows[0]?.key ?? "";
    if (ambiSource === "wallpaper") ambiTarget = wallSource === "engine" ? `engine${wallMonitor ? `:${wallMonitor}` : ""}` : "windows";
    p({ ambiSource, ambiTarget });
  };

  const windowMissing = cfg.ambiSource === "window" && cfg.ambiTarget && targets && !targets.windows.some((w) => w.key === cfg.ambiTarget);

  return (
    <div className="ambi-pick">
      <span className="ambi-q">O que o Ambilight deve acompanhar?</span>
      <div className="ambi-options">
        {(
          [
            { v: "screen", icon: "monitor", t: "Tela inteira", d: "Tudo que aparece no monitor" },
            { v: "window", icon: "app", t: "Um aplicativo", d: "Só a janela de um programa ou jogo" },
            { v: "wallpaper", icon: "image", t: "Wallpaper", d: "O papel de parede, mesmo coberto por janelas" },
          ] as const
        ).map((o) => (
          <button key={o.v} className={`ambi-opt ${cfg.ambiSource === o.v ? "on" : ""}`} onClick={() => setSource(o.v)}>
            <Icon name={o.icon} />
            <strong>{o.t}</strong>
            <span className="small muted">{o.d}</span>
          </button>
        ))}
      </div>

      {cfg.ambiSource === "screen" && (
        <div className="row tight">
          <div style={{ flex: 1 }}>
            <Select
              value={cfg.ambiTarget || targets?.monitors.find((m) => m.primary)?.id || ""}
              onChange={(ambiTarget) => p({ ambiTarget })}
              options={(targets?.monitors ?? []).map((m, i) => ({ value: m.id, label: `Monitor ${i + 1}${m.primary ? " (principal)" : ""} — ${m.width}×${m.height}` }))}
            />
          </div>
          <button className="btn icon" title="Atualizar lista" disabled={loading} onClick={load}>
            <Icon name="refresh" size={16} />
          </button>
        </div>
      )}

      {cfg.ambiSource === "window" && (
        <>
          <div className="row tight">
            <div style={{ flex: 1 }}>
              <Select
                value={cfg.ambiTarget}
                onChange={(ambiTarget) => p({ ambiTarget })}
                options={[
                  ...(windowMissing ? [{ value: cfg.ambiTarget, label: `${cfg.ambiTarget.split("|")[0]} (fechado agora)` }] : []),
                  ...(targets?.windows ?? []).map((w) => ({ value: w.key, label: `${w.app.replace(/\.exe$/i, "")} — ${w.title.slice(0, 60)}` })),
                ]}
              />
            </div>
            <button className="btn icon" title="Atualizar lista de janelas" disabled={loading} onClick={load}>
              <Icon name="refresh" size={16} />
            </button>
          </div>
          <span className="small muted">Se a janela fechar ou for minimizada, as teclas apagam até ela voltar. Se o título mudar (ex.: outra aba), ele continua seguindo o mesmo programa.</span>
        </>
      )}

      {cfg.ambiSource === "wallpaper" && (
        <Segmented
          value={cfg.ambiTarget.startsWith("engine") ? "engine" : "windows"}
          onChange={(v) => p({ ambiTarget: v === "engine" ? `engine${wallMonitor ? `:${wallMonitor}` : ""}` : "windows" })}
          options={[
            { value: "windows", label: "Wallpaper do Windows" },
            { value: "engine", label: "Wallpaper Engine (prévia animada)" },
          ]}
        />
      )}
    </div>
  );
}

// ================================================================== clima

function WeatherTab() {
  const { settings, toast, runUpload, status, busy, setLastScreen } = useApp();
  const { ui, setUi } = useUi();
  const w = ui.weather ?? null;
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [preview, setPreview] = useState<Rendered | null>(null);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    if (!q.trim()) return;
    setLoading(true);
    try {
      setResults(await searchCity(q.trim()));
    } catch (e) {
      toast("error", `Não consegui buscar: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const refresh = async (s = settings) => {
    if (!s?.ui.weather) return;
    try {
      setPreview(await renderWeatherFor(s));
    } catch (e) {
      toast("error", `Clima: ${(e as Error).message}`);
    }
  };

  useEffect(() => {
    if (w && !preview) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w?.lat, w?.lon, w?.template]);

  const choose = (pl: Place) => {
    const name = pl.name;
    setUi("weather", { name, lat: pl.latitude, lon: pl.longitude, autoHours: w?.autoHours ?? 3, template: w?.template ?? "card" });
    setResults(null);
    setQ("");
    setPreview(null);
  };

  return (
    <div className="lighting-layout">
      <Card title="Clima na tela" subtitle="Temperatura e previsão da sua cidade na telinha, atualizadas sozinhas. Dados do Open-Meteo (grátis, sem cadastro).">
        <div className="row tight">
          <input className="input" style={{ flex: 1 }} placeholder="Buscar cidade (ex.: São Paulo)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
          <button className="btn" disabled={loading} onClick={search}>
            {loading ? "Buscando…" : "Buscar"}
          </button>
        </div>
        {results && (
          <div className="results">
            {results.length === 0 && <span className="small muted">Nenhuma cidade encontrada.</span>}
            {results.map((r, i) => (
              <button key={i} className="result" onClick={() => choose(r)}>
                <strong>{r.name}</strong>
                <span className="small muted">{[r.admin1, r.country].filter(Boolean).join(", ")}</span>
              </button>
            ))}
          </div>
        )}
        {w && (
          <>
            <div className="row between">
              <span>
                Cidade: <strong>{w.name}</strong>
              </span>
              <button className="btn sm ghost" onClick={() => refresh()}>
                <Icon name="refresh" size={15} /> Atualizar
              </button>
            </div>
            <Segmented value={w.template} onChange={(template) => (setUi("weather", { ...w, template }), setPreview(null))} options={WEATHER_TEMPLATES} />
            <div className="field">
              <span>Atualizar a tela automaticamente</span>
              <Segmented
                value={w.autoHours}
                onChange={(autoHours) => setUi("weather", { ...w, autoHours })}
                options={[
                  { value: 0, label: "Nunca" },
                  { value: 1, label: "1 h" },
                  { value: 3, label: "3 h" },
                  { value: 6, label: "6 h" },
                ]}
              />
            </div>
          </>
        )}
      </Card>
      <Card title="Prévia">
        <div className="weather-preview">{preview ? <ScreenPreview className="big-preview" previews={preview.previews} delays={[]} /> : <Icon name="cloud" size={36} />}</div>
        <button
          className="btn primary"
          disabled={!preview || busy || status.state !== "connected"}
          onClick={() =>
            runUpload("Enviando clima", async () => {
              const r = await renderWeatherFor(settings!);
              setPreview(r);
              await upload(r);
              setLastScreen(r.previews[0]);
            })
          }
        >
          <Icon name="upload" /> Enviar para a tela
        </button>
      </Card>
    </div>
  );
}

// ================================================================== foco

function FocusTab() {
  const { cfg, p, active, otherActive, toggle, online } = useStreamMode("pomodoro");
  const [start, setStart] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (active && start === null) setStart(Date.now());
    if (!active) setStart(null);
  }, [active, start]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);

  const work = cfg.workMin * 60;
  const rest = cfg.breakMin * 60;
  const el = start ? ((now - start) / 1000) % (work + rest) : 0;
  const focus = el < work;
  const left = focus ? work - el : work + rest - el;
  const pct = focus ? el / work : (el - work) / rest;
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(Math.floor(left % 60)).padStart(2, "0");

  return (
    <div className="lighting-layout">
      <Card title="Pomodoro nas teclas" subtitle="Uma barra de progresso atravessa o teclado durante o foco; na pausa muda de cor. Na troca de fase as teclas piscam." actions={<StreamButton active={active} online={online} toggle={toggle} label="Começar" />}>
        {otherActive && <p className="small warn">Outro modo do RGB do PC está ligado; começar vai substituí-lo.</p>}
        <div className={`pomo ${active ? (focus ? "focus" : "rest") : ""}`}>
          <span className="pomo-phase">{active ? (focus ? "Foco" : "Pausa") : "Parado"}</span>
          <span className="pomo-time">{active ? `${mm}:${ss}` : `${String(cfg.workMin).padStart(2, "0")}:00`}</span>
          <div className="progress">
            <div style={{ width: `${active ? pct * 100 : 0}%`, background: focus ? cfg.colorA : cfg.colorB }} />
          </div>
        </div>
        {active && (
          <button
            className="btn sm ghost"
            onClick={async () => {
              await api3.pomodoroReset();
              setStart(Date.now());
            }}
          >
            <Icon name="refresh" size={15} /> Reiniciar
          </button>
        )}
      </Card>
      <Card title="Ajustes">
        <Select label="Foco" value={cfg.workMin} onChange={(workMin) => p({ workMin })} options={[15, 20, 25, 30, 45, 50, 60, 90].map((v) => ({ value: v, label: `${v} min` }))} />
        <Select label="Pausa" value={cfg.breakMin} onChange={(breakMin) => p({ breakMin })} options={[3, 5, 10, 15, 20, 30].map((v) => ({ value: v, label: `${v} min` }))} />
        <ColorField label="Cor do foco" value={cfg.colorA} onChange={(colorA) => p({ colorA })} />
        <ColorField label="Cor da pausa" value={cfg.colorB} onChange={(colorB) => p({ colorB })} />
        <Slider label="Brilho" value={cfg.brightness} min={0.1} max={1} step={0.05} onChange={(brightness) => p({ brightness })} format={(v) => `${Math.round(v * 100)}%`} />
      </Card>
    </div>
  );
}
