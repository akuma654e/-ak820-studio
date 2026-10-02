import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useApp } from "../App";
import { api, onLighting, onStream, uid, type Lighting, type Profile, type StreamConfig, type StreamMode } from "../lib/api";
import { DIRECTIONS, EFFECTS, SWATCHES } from "../lib/effects";
import { KEY_COUNT, KEY_ROWS, KEYS } from "../lib/layout";
import { FxPreview, meterPreview, PC_EFFECTS } from "../lib/pcfx";
import { dominantColor, rgb565ToImageData } from "../lib/imaging";
import { Card, ColorField, Icon, Segmented, Slider, Toggle } from "../components/ui";

const DEFAULT: Lighting = { mode: 1, color: "#7c4dff", rainbow: false, brightness: 4, speed: 3, direction: 0 };
export const DEFAULT_STREAM: StreamConfig = {
  mode: "effect",
  effect: "rainbowWave",
  speed: 1,
  colorA: "#8b6cff",
  colorB: "#00e5ff",
  brightness: 0.8,
  reverse: false,
  colors: [],
  musicStyle: "spectrum",
  sensitivity: 1,
  saturation: 1.4,
  workMin: 25,
  breakMin: 5,
  ambiSource: "screen",
  ambiTarget: "",
};

export function LightingPage() {
  const [tab, setTab] = useState<"firmware" | "pc">("firmware");
  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Iluminação</h1>
          <p className="muted">Efeitos gravados no teclado ou RGB por tecla controlado pelo PC.</p>
        </div>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "firmware", label: "Efeitos do teclado" },
            { value: "pc", label: "RGB do PC (por tecla)" },
          ]}
        />
      </header>
      <div hidden={tab !== "firmware"}>
        <FirmwareLighting />
      </div>
      <div hidden={tab !== "pc"}>
        <PcLighting />
      </div>
    </div>
  );
}

// ================================================================== firmware

function FirmwareLighting() {
  const { settings, updateSettings, toast, status, busy, lastScreen } = useApp();
  const [cfg, setCfg] = useState<Lighting>(settings?.lighting ?? DEFAULT);
  const [auto, setAuto] = useState(true);
  const [applying, setApplying] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [profileName, setProfileName] = useState("");
  const inflight = useRef(false);
  const queued = useRef<Lighting | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (!loaded.current && settings?.lighting) {
      setCfg(settings.lighting);
      loaded.current = true;
    }
  }, [settings]);

  useEffect(() => {
    const off = onLighting((l) => {
      if (l.mode !== 0) setCfg(l);
    });
    return () => void off.then((f) => f());
  }, []);

  const effect = EFFECTS.find((e) => e.id === cfg.mode) ?? EFFECTS[1];
  const online = status.state === "connected" || status.state === "partial";
  const profiles = settings?.profiles ?? [];

  const apply = async (c: Lighting) => {
    if (inflight.current) {
      queued.current = c;
      return;
    }
    inflight.current = true;
    setApplying(true);
    try {
      await api.setLighting(c);
      setDirty(false);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      inflight.current = false;
      const next = queued.current;
      queued.current = null;
      if (next) void apply(next);
      else setApplying(false);
    }
  };

  const change = (p: Partial<Lighting>) => {
    setCfg((c) => {
      const next = { ...c, ...p };
      const ef = EFFECTS.find((e) => e.id === next.mode)!;
      const dirs = DIRECTIONS[ef.dir];
      if (dirs.length && !dirs.some((d) => d.value === next.direction)) next.direction = dirs[0].value;
      return next;
    });
    setDirty(true);
  };

  useEffect(() => {
    if (!auto || !dirty || !online || busy) return;
    const t = window.setTimeout(() => void apply(cfg), 450);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, auto, dirty, online, busy]);

  const colorFromScreen = async () => {
    try {
      let img = lastScreen;
      if (!img) {
        const id = await api.galleryCurrent();
        if (id) img = rgb565ToImageData(await api.galleryFrames(id), 0);
      }
      if (!img) {
        toast("info", "Envie uma imagem para a tela primeiro (pela aba Tela ou Galeria).");
        return;
      }
      const c = dominantColor(img);
      change({ color: c, rainbow: false, mode: effect.color ? cfg.mode : 1 });
      toast("ok", `Cor da tela aplicada: ${c.toUpperCase()}`);
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  const saveProfile = () => {
    const name = profileName.trim() || `${effect.name} ${profiles.length + 1}`;
    void updateSettings({ profiles: [...profiles, { id: uid(), name, lighting: cfg }] });
    setProfileName("");
    toast("ok", `Perfil “${name}” salvo`);
  };

  const applyProfile = async (p: Profile) => {
    setCfg(p.lighting);
    setDirty(false);
    try {
      await api.applyProfile(p.id);
      toast("ok", `Perfil “${p.name}” aplicado`);
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  const moveProfile = (i: number, d: number) => {
    const list = [...profiles];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    void updateSettings({ profiles: list });
  };

  return (
    <>
      <div className="row between" style={{ marginBottom: 14 }}>
        <Toggle label="Aplicar ao mudar" checked={auto} onChange={setAuto} />
        <button className="btn primary" disabled={!online || busy || applying} onClick={() => apply(cfg)}>
          <Icon name="bolt" /> {applying ? "Aplicando…" : "Aplicar"}
        </button>
      </div>

      <KeyboardPreview cfg={cfg} />

      <div className="lighting-layout">
        <div className="stack">
          <Card title="Efeito" subtitle={effect.desc}>
            <div className="effects-grid">
              {EFFECTS.map((e) => (
                <button key={e.id} className={`effect ${cfg.mode === e.id ? "on" : ""}`} onClick={() => change({ mode: e.id })} title={e.desc}>
                  <span className={`effect-swatch anim-${e.anim}`} style={{ ["--c" as string]: cfg.color } as CSSProperties} />
                  <span>{e.name}</span>
                </button>
              ))}
            </div>
          </Card>

          <Card title="Perfis" subtitle="Combinações salvas. Os 5 primeiros têm atalho Ctrl+Alt+1…5 e todos aparecem na bandeja.">
            {profiles.length === 0 && <p className="small muted">Nenhum perfil ainda. Ajuste a iluminação e salve abaixo.</p>}
            <div className="profile-list">
              {profiles.map((p, i) => {
                const ef = EFFECTS.find((e) => e.id === p.lighting.mode);
                return (
                  <div key={p.id} className="profile">
                    <span className="profile-dot" style={{ background: p.lighting.rainbow || !ef?.color ? "conic-gradient(#ff2d55,#ffd60a,#30d158,#00e5ff,#7c4dff,#ff2d55)" : p.lighting.color }} />
                    <div className="profile-text">
                      <strong>{p.name}</strong>
                      <span className="small muted">
                        {ef?.name ?? "?"} · brilho {p.lighting.brightness}
                        {i < 5 ? ` · Ctrl+Alt+${i + 1}` : ""}
                      </span>
                    </div>
                    <button className="btn icon sm ghost" title="Subir" disabled={i === 0} onClick={() => moveProfile(i, -1)}>
                      ↑
                    </button>
                    <button className="btn icon sm ghost" title="Excluir" onClick={() => updateSettings({ profiles: profiles.filter((x) => x.id !== p.id) })}>
                      <Icon name="trash" size={14} />
                    </button>
                    <button className="btn sm" disabled={!online || busy} onClick={() => applyProfile(p)}>
                      Aplicar
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="row tight">
              <input className="input" style={{ flex: 1 }} placeholder="Nome do perfil (ex.: Jogo, Noite)" value={profileName} maxLength={40} onChange={(e) => setProfileName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveProfile()} />
              <button className="btn" onClick={saveProfile}>
                <Icon name="save" size={16} /> Salvar atual
              </button>
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card title="Cor">
            <div className={`color-panel ${!effect.color ? "disabled" : ""}`}>
              <div className="swatches">
                {SWATCHES.map((s) => (
                  <button key={s} className={`swatch ${cfg.color.toLowerCase() === s && !cfg.rainbow ? "on" : ""}`} style={{ background: s }} onClick={() => change({ color: s, rainbow: false })} disabled={!effect.color} aria-label={s} />
                ))}
                <label className="swatch custom" title="Cor personalizada">
                  <input type="color" value={cfg.color} disabled={!effect.color} onChange={(e) => change({ color: e.target.value, rainbow: false })} />
                  <Icon name="plus" size={14} />
                </label>
              </div>
              <Toggle label="Arco-íris" hint="Usa todas as cores no lugar da cor escolhida" checked={cfg.rainbow} disabled={!effect.rainbow} onChange={(rainbow) => change({ rainbow })} />
            </div>
            <button className="btn sm" onClick={colorFromScreen} title="Pega a cor predominante da imagem que está na tela do teclado">
              <Icon name="screen" size={15} /> Usar a cor da tela
            </button>
            {!effect.color && <p className="small muted">Este efeito usa cores fixas do firmware.</p>}
          </Card>

          <Card title="Ajustes">
            <Slider label="Brilho" value={cfg.brightness} min={1} max={5} disabled={cfg.mode === 0} onChange={(brightness) => change({ brightness })} />
            <Slider label="Velocidade" value={cfg.speed} min={1} max={5} disabled={!effect.speed} onChange={(speed) => change({ speed })} />
            {effect.dir !== "none" && (
              <div className="field">
                <span>Direção</span>
                <Segmented value={cfg.direction} onChange={(direction) => change({ direction })} options={DIRECTIONS[effect.dir].map((d) => ({ value: d.value, label: d.label }))} />
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

// ================================================================== prévia (firmware)

const DUR = [0, 6, 4.4, 3.2, 2.3, 1.6];

function KeyboardPreview({ cfg }: { cfg: Lighting }) {
  const effect = EFFECTS.find((e) => e.id === cfg.mode) ?? EFFECTS[1];
  const anim = effect.anim;
  const rainbow = cfg.rainbow || !effect.color;
  const reverse = cfg.direction === 0 || cfg.direction === 2;
  const seeds = useMemo(() => Array.from({ length: KEY_COUNT }, () => Math.random()), []);
  const style = {
    ["--c" as string]: cfg.color,
    ["--dur" as string]: `${DUR[effect.speed ? cfg.speed : 3]}s`,
    filter: cfg.mode === 0 ? undefined : `brightness(${0.45 + cfg.brightness * 0.13})`,
  } as CSSProperties;
  return (
    <div className={`kb mode-${anim} ${rainbow ? "rainbow" : ""} ${reverse ? "rev" : ""}`} style={style} aria-label="Prévia aproximada do teclado">
      <KeyRows render={(k) => ({ style: { ["--x" as string]: ((k.x + k.w / 2) / 17).toFixed(3), ["--y" as string]: k.row / 5, ["--r" as string]: seeds[k.index].toFixed(3) } as CSSProperties })} />
      <span className="kb-note small">{anim === "reactive" ? "Efeito reativo — passe o mouse nas teclas" : "Prévia aproximada"}</span>
    </div>
  );
}

type KeyProps = { style?: CSSProperties; className?: string; onPointerDown?: () => void; onPointerEnter?: () => void };

export function KeyRows({ render }: { render: (k: (typeof KEYS)[number]) => KeyProps }) {
  return (
    <>
      {KEY_ROWS.map((row, y) => (
        <div className="kb-row" key={y}>
          {row.map((c, i) => {
            if (c.kind === "gap") return <span key={i} style={{ flex: `${c.w} 0 0` }} />;
            if (c.kind === "screen")
              return (
                <span key={i} className="kb-screen" style={{ flex: `${c.w} 0 0` }}>
                  <span />
                </span>
              );
            const p = render(c);
            return (
              <span key={i} {...p} className={`key ${p.className ?? ""}`} style={{ flex: `${c.w} 0 0`, ...p.style }}>
                <i>{c.label}</i>
              </span>
            );
          })}
        </div>
      ))}
    </>
  );
}

// ================================================================== RGB do PC

const PAINT_PRESETS: { label: string; make: (c: string) => string[] }[] = [
  { label: "Tudo na cor", make: (c) => Array(KEY_COUNT).fill(c) },
  {
    label: "WASD destacado",
    make: (c) => KEYS.map((k) => (["W", "A", "S", "D", "Shift", "Ctrl", "Space", ""].includes(k.label) && k.row >= 2 ? c : "#141420")),
  },
  { label: "Arco-íris", make: () => KEYS.map((k) => `hsl(${Math.round(((k.x + k.w / 2) / 17) * 330)} 95% 55%)`).map(hslToHex) },
  { label: "Por linha", make: () => KEYS.map((k) => ["#ff2d55", "#ff8a00", "#ffd60a", "#30d158", "#00e5ff", "#7c4dff"][k.row]) },
  { label: "Setas e navegação", make: (c) => KEYS.map((k) => (["↑", "↓", "←", "→", "Home", "PgUp", "PgDn", "Del"].includes(k.label) ? c : "#141420")) },
];

function hslToHex(hsl: string): string {
  const m = hsl.match(/hsl\((\d+) (\d+)% (\d+)%\)/)!;
  const h = +m[1] / 360, s = +m[2] / 100, l = +m[3] / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function PcLighting() {
  const { settings, updateSettings, toast, status } = useApp();
  const [cfg, setCfg] = useState<StreamConfig>(() => ({ ...DEFAULT_STREAM, ...settings?.stream, mode: pcMode(settings?.stream?.mode) }));
  const [colors, setColors] = useState<string[]>(() => settings?.keymap ?? Array(KEY_COUNT).fill("#8b6cff"));
  const [active, setActive] = useState(false);
  const [brush, setBrush] = useState("#00e5ff");
  const [tool, setTool] = useState<"brush" | "picker">("brush");
  const [live, setLive] = useState<string[]>(colors);
  const painting = useRef(false);
  const loaded = useRef(false);
  const fx = useRef(new FxPreview());
  const online = status.state === "connected" || status.state === "partial";

  useEffect(() => {
    if (loaded.current || !settings) return;
    loaded.current = true;
    if (settings.stream) setCfg({ ...DEFAULT_STREAM, ...settings.stream, mode: pcMode(settings.stream.mode) });
    if (settings.keymap?.length === KEY_COUNT) setColors(settings.keymap);
  }, [settings]);

  useEffect(() => {
    api.streamStatus().then((s) => setActive(!!s));
    const off = onStream((s) => setActive(!!s));
    return () => void off.then((f) => f());
  }, []);

  const full: StreamConfig = useMemo(() => ({ ...cfg, colors }), [cfg, colors]);

  // Envia mudanças enquanto transmite.
  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => void api.streamSet(full).catch((e) => toast("error", e.message)), 120);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full]);

  // Prévia animada.
  useEffect(() => {
    if (cfg.mode === "paint") {
      setLive(colors.map((c) => scale(c, cfg.brightness)));
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    let last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 66) return;
      last = now;
      const t = (now - t0) / 1000;
      const f = cfg.mode === "meter" ? meterPreview(t, cfg.colorA) : fx.current.frame(cfg.effect, t, cfg.speed, cfg.colorA, cfg.colorB, cfg.reverse);
      setLive(cfg.mode === "meter" ? f : f.map((c) => scaleRgb(c, cfg.brightness)));
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cfg, colors]);

  const p = (x: Partial<StreamConfig>) => setCfg((c) => ({ ...c, ...x }));

  const toggle = async () => {
    try {
      await api.streamSet(active ? null : full);
      setActive(!active);
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  const paintKey = (i: number) => {
    if (cfg.mode !== "paint") return;
    if (tool === "picker") {
      setBrush(colors[i]);
      setTool("brush");
      return;
    }
    setColors((cs) => (cs[i] === brush ? cs : cs.map((c, j) => (j === i ? brush : c))));
  };

  useEffect(() => {
    const up = () => (painting.current = false);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  const effectInfo = PC_EFFECTS.find((e) => e.value === cfg.effect) ?? PC_EFFECTS[0];

  return (
    <>
      <div className={`stream-bar ${active ? "on" : ""}`}>
        <span className="dot" />
        <div>
          <strong>{active ? "Transmitindo para o teclado" : "RGB do PC desligado"}</strong>
          <span className="small muted">
            {active ? "As cores são enviadas 10× por segundo. Ao parar ou fechar o app, o teclado volta ao efeito salvo." : "O PC controla cada tecla individualmente enquanto o app estiver aberto (experimental)."}
          </span>
        </div>
        <Toggle label="Ligar ao conectar" checked={!!settings?.streamAutostart} onChange={(streamAutostart) => updateSettings({ streamAutostart })} />
        <button className={`btn ${active ? "danger" : "primary"}`} disabled={!online && !active} onClick={toggle}>
          <Icon name={active ? "pause" : "play"} /> {active ? "Parar" : "Transmitir"}
        </button>
      </div>

      <div className={`kb live ${cfg.mode === "paint" ? "paintable" : ""} ${tool === "picker" ? "picker" : ""}`} onPointerLeave={() => (painting.current = false)}>
        <KeyRows
          render={(k) => ({
            style: { background: live[k.index], borderColor: "rgba(255,255,255,0.08)" },
            onPointerDown: () => {
              painting.current = true;
              paintKey(k.index);
            },
            onPointerEnter: () => painting.current && paintKey(k.index),
          })}
        />
        <span className="kb-note small">{cfg.mode === "paint" ? (tool === "picker" ? "Clique numa tecla para pegar a cor" : "Clique e arraste para pintar") : cfg.mode === "meter" ? "Prévia com valores de exemplo" : "Prévia do efeito"}</span>
      </div>

      <div className="lighting-layout">
        <Card title="Modo">
          <Segmented
            value={cfg.mode}
            onChange={(mode: StreamMode) => p({ mode })}
            options={[
              { value: "paint", label: "Pintar teclas" },
              { value: "effect", label: "Efeitos do PC" },
              { value: "meter", label: "Medidor CPU/RAM" },
            ]}
          />

          {cfg.mode === "paint" && (
            <>
              <div className="row tight">
                <span className="swatch big" style={{ background: brush }} />
                <div className="swatches">
                  {SWATCHES.map((s) => (
                    <button key={s} className={`swatch ${brush === s ? "on" : ""}`} style={{ background: s }} onClick={() => setBrush(s)} aria-label={s} />
                  ))}
                  <label className="swatch custom" title="Cor personalizada">
                    <input type="color" value={brush} onChange={(e) => setBrush(e.target.value)} />
                    <Icon name="plus" size={14} />
                  </label>
                </div>
              </div>
              <div className="row tight">
                <button className={`btn sm ${tool === "picker" ? "on" : ""}`} onClick={() => setTool(tool === "picker" ? "brush" : "picker")}>
                  Conta-gotas
                </button>
                <button className="btn sm" onClick={() => setColors(Array(KEY_COUNT).fill(brush))}>
                  Preencher tudo
                </button>
                <button className="btn sm ghost" onClick={() => setColors(Array(KEY_COUNT).fill("#000000"))}>
                  Apagar tudo
                </button>
              </div>
              <div className="chips">
                {PAINT_PRESETS.map((pr) => (
                  <button key={pr.label} className="chip" onClick={() => setColors(pr.make(brush))}>
                    {pr.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {cfg.mode === "effect" && (
            <div className="chips">
              {PC_EFFECTS.map((e) => (
                <button key={e.value} className={`chip ${cfg.effect === e.value ? "on" : ""}`} onClick={() => p({ effect: e.value })}>
                  {e.label}
                </button>
              ))}
            </div>
          )}

          {cfg.mode === "meter" && <p className="small muted">A fileira de números (1 a 0) mostra o uso da CPU e as teclas F1–F12 mostram o uso da memória RAM, de verde a vermelho. As outras teclas ficam na cor base.</p>}
        </Card>

        <Card title="Ajustes">
          <Slider label="Brilho" value={cfg.brightness} min={0.05} max={1} step={0.05} onChange={(brightness) => p({ brightness })} format={(v) => `${Math.round(v * 100)}%`} />
          {cfg.mode === "effect" && <Slider label="Velocidade" value={cfg.speed} min={0.2} max={3} step={0.1} onChange={(speed) => p({ speed })} format={(v) => `${v.toFixed(1)}×`} />}
          {(cfg.mode === "meter" || (cfg.mode === "effect" && effectInfo.colors >= 1)) && <ColorField label={cfg.mode === "meter" ? "Cor base" : "Cor 1"} value={cfg.colorA} onChange={(colorA) => p({ colorA })} />}
          {cfg.mode === "effect" && effectInfo.colors >= 2 && <ColorField label="Cor 2" value={cfg.colorB} onChange={(colorB) => p({ colorB })} />}
          {cfg.mode === "effect" && effectInfo.dir && <Toggle label="Inverter direção" checked={cfg.reverse} onChange={(reverse) => p({ reverse })} />}
          <p className="small muted">Atalho: Ctrl+Alt+P liga/desliga. Também no menu da bandeja.</p>
        </Card>
      </div>
    </>
  );
}

function pcMode(m?: StreamMode): StreamMode {
  return m === "paint" || m === "meter" || m === "effect" ? m : "effect";
}

function scale(hex: string, k: number): string {
  const v = parseInt(hex.slice(1), 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => Math.round(x * k));
  return `rgb(${c.join(",")})`;
}

function scaleRgb(rgb: string, k: number): string {
  const m = rgb.match(/\d+/g)!.map(Number);
  return `rgb(${m.map((x) => Math.round(x * k)).join(",")})`;
}
