import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../App";
import { api, saveBytes } from "../lib/api";
import {
  blankSource,
  decodeFile,
  defaultEdit,
  FILTERS,
  FONTS,
  FRAME_BYTES,
  HARD_MAX_FRAMES,
  RECOMMENDED_MAX_FRAMES,
  renderAll,
  renderOriginal,
  sequence,
  sourceFromFrames,
  thumbnail,
  totalDuration,
  type Edit,
  type Rendered,
  type Source,
} from "../lib/imaging";
import { background, BACKGROUNDS, marquee, slideshow, type BackgroundKind, type MarqueeOpts, type SlideshowOpts } from "../lib/generators";
import { exportGif, exportPng } from "../lib/exporters";
import { ScreenPreview } from "../components/ScreenPreview";
import { Card, ColorField, Icon, Modal, Segmented, Select, Slider, Toggle } from "../components/ui";

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif,.apng";
const HISTORY_LIMIT = 80;

type Generator = null | "marquee" | "background" | "slideshow";

export function DisplayPage({ active }: { active: boolean }) {
  const { settings, runUpload, toast, busy, status, bumpGallery, go, editorRequest, clearEditorRequest, setLastScreen, editorFile, clearEditorFile } = useApp();
  const [source, setSource] = useState<Source | null>(null);
  const [edit, setEditRaw] = useState<Edit>(() => ({ ...defaultEdit(), dither: settings?.dithering ?? true, maxFrames: settings?.maxFrames ?? RECOMMENDED_MAX_FRAMES }));
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [playing, setPlaying] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [original, setOriginal] = useState<ImageData | null>(null);
  const [generator, setGenerator] = useState<Generator>(null);
  const [slideFiles, setSlideFiles] = useState<File[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------- desfazer / refazer
  const past = useRef<Edit[]>([]);
  const future = useRef<Edit[]>([]);
  const committed = useRef<Edit>(edit);
  const commitTimer = useRef<number>();
  const [, force] = useState(0);

  const flushCommit = useCallback((current: Edit) => {
    window.clearTimeout(commitTimer.current);
    if (current !== committed.current) {
      past.current = [...past.current.slice(-HISTORY_LIMIT), committed.current];
      future.current = [];
      committed.current = current;
      force((n) => n + 1);
    }
  }, []);

  const setEdit = useCallback(
    (updater: Edit | ((e: Edit) => Edit)) => {
      setEditRaw((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        window.clearTimeout(commitTimer.current);
        commitTimer.current = window.setTimeout(() => flushCommit(next), 450);
        return next;
      });
    },
    [flushCommit],
  );

  const resetHistory = (e: Edit) => {
    window.clearTimeout(commitTimer.current);
    past.current = [];
    future.current = [];
    committed.current = e;
    force((n) => n + 1);
  };

  const undo = useCallback(() => {
    flushCommit(edit);
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(committed.current);
    committed.current = prev;
    setEditRaw(prev);
    force((n) => n + 1);
  }, [edit, flushCommit]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(committed.current);
    committed.current = next;
    setEditRaw(next);
    force((n) => n + 1);
  }, []);

  const patch = useCallback((p: Partial<Edit>) => setEdit((e) => ({ ...e, ...p })), [setEdit]);
  const patchText = (p: Partial<Edit["text"]>) => setEdit((e) => ({ ...e, text: { ...e.text, ...p } }));

  // ---------------------------------------------------------------- render
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    const first = renderAll(source, edit, true);
    const many = sequence(source, edit).length > 1 || (edit.text.blink && edit.text.text.trim());
    if (!many) {
      setRendered(first);
      return;
    }
    setRendered((r) => (r && r.previews.length > 1 ? r : first));
    const t = window.setTimeout(() => {
      if (!cancelled) setRendered(renderAll(source, edit));
    }, 90);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [source, edit]);

  const useSource = useCallback(
    (src: Source, nm: string, base?: Partial<Edit>) => {
      setSource((old) => {
        old?.frames.forEach((f) => f.bitmap.close());
        return src;
      });
      setRendered(null);
      setName(nm.slice(0, 60));
      setEditRaw((e) => {
        const next = { ...defaultEdit(), dither: e.dither, maxFrames: e.maxFrames, ...base };
        resetHistory(next);
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const load = async (files: File[]) => {
    if (!files.length) return;
    if (files.length > 1) {
      setSlideFiles(files);
      setGenerator("slideshow");
      return;
    }
    setLoading(true);
    try {
      const src = await decodeFile(files[0]);
      useSource(src, files[0].name.replace(/\.[^.]+$/, ""));
      if (src.truncated) toast("info", "GIF muito longo: só os primeiros 600 quadros foram carregados.");
    } catch (e) {
      toast("error", `Não consegui abrir esse arquivo: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const startBlank = async () => {
    useSource(await blankSource(), "Minha tela", { bg: "#101018", text: { ...defaultEdit().text, text: "AKUMA", y: 64, size: 30 } });
  };

  // Abrir item da galeria no editor
  useEffect(() => {
    if (!editorRequest) return;
    const item = editorRequest;
    clearEditorRequest();
    (async () => {
      try {
        const bytes = await api.galleryFrames(item.id);
        const src = await sourceFromFrames(item.name, bytes, item.delays);
        useSource(src, item.name, { dither: false, fit: "stretch" });
      } catch (e) {
        toast("error", (e as Error).message);
      }
    })();
  }, [editorRequest, clearEditorRequest, useSource, toast]);

  // Abrir arquivo vindo de outra página (ex.: wallpaper)
  useEffect(() => {
    if (!editorFile) return;
    const f = editorFile;
    clearEditorFile();
    void load([f]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorFile, clearEditorFile]);

  // Atalhos: Ctrl+Z / Ctrl+Y / Ctrl+V
  useEffect(() => {
    if (!active) return;
    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!(ev.ctrlKey || ev.metaKey)) return;
      const k = ev.key.toLowerCase();
      if (k === "z" && !ev.shiftKey) {
        ev.preventDefault();
        undo();
      } else if (k === "y" || (k === "z" && ev.shiftKey)) {
        ev.preventDefault();
        redo();
      }
    };
    const onPaste = (ev: ClipboardEvent) => {
      const tag = (ev.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const files = Array.from(ev.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        ev.preventDefault();
        void load(files);
        toast("info", "Imagem colada da área de transferência");
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, undo, redo]);

  // ---------------------------------------------------------------- ações
  const fullRender = () => (source ? renderAll(source, edit) : rendered!);

  const send = () => {
    if (!rendered) return;
    const full = fullRender();
    return runUpload("Enviando para a tela do teclado", async () => {
      await api.upload(full.frames, full.delays);
      setLastScreen(full.previews[0]);
    });
  };

  const save = async (alsoSend: boolean) => {
    if (!source) return;
    const full = fullRender();
    try {
      const item = await api.gallerySave(name || source.name, full.frames, full.delays, thumbnail(full.previews[0]));
      bumpGallery();
      toast("ok", `"${item.name}" salvo na galeria`);
      if (alsoSend)
        await runUpload("Enviando para a tela do teclado", async () => {
          await api.galleryUpload(item.id);
          setLastScreen(full.previews[0]);
        });
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  const doExport = async (kind: "png" | "gif") => {
    setExportOpen(false);
    const full = fullRender();
    const base = (name || "tela").replace(/[\\/:*?"<>|]/g, "_");
    try {
      const ok =
        kind === "png"
          ? await saveBytes(`${base}.png`, [{ name: "Imagem PNG", extensions: ["png"] }], await exportPng(full))
          : await saveBytes(`${base}.gif`, [{ name: "GIF animado", extensions: ["gif"] }], exportGif(full));
      if (ok) toast("ok", `Exportado como ${kind.toUpperCase()}`);
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  const frames = rendered ? rendered.frames.length / FRAME_BYTES : 0;
  const duration = rendered ? totalDuration(rendered.delays) : 0;
  const sizeKb = Math.round((256 + frames * FRAME_BYTES) / 1024);
  const canSend = !!rendered && !busy && status.state === "connected";
  const animated = !!source && source.frames.length > 1;
  const lastIndex = source ? source.frames.length - 1 : 0;

  const onDrop = (ev: React.DragEvent) => {
    ev.preventDefault();
    setDragOver(false);
    void load(Array.from(ev.dataTransfer.files));
  };

  const showOriginal = () => source && setOriginal(renderOriginal(source, edit));

  return (
    <div className="display-page" onDragOver={(e) => (e.preventDefault(), setDragOver(true))} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
      <header className="page-head">
        <div>
          <h1>Tela</h1>
          <p className="muted">Monte a imagem ou animação da telinha de 128×128 e envie para o teclado.</p>
        </div>
        <div className="head-actions">
          {source && (
            <>
              <button className="btn icon ghost" title="Desfazer (Ctrl+Z)" disabled={!past.current.length && edit === committed.current} onClick={undo}>
                <Icon name="undo" />
              </button>
              <button className="btn icon ghost" title="Refazer (Ctrl+Y)" disabled={!future.current.length} onClick={redo}>
                <Icon name="redo" />
              </button>
            </>
          )}
          <CreateMenu onFile={() => fileRef.current?.click()} onGen={setGenerator} onBlank={startBlank} compact={!!source} />
        </div>
      </header>
      <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => (load(Array.from(e.target.files ?? [])), (e.target.value = ""))} />

      {!source ? (
        <div className={`dropzone ${dragOver ? "over" : ""}`}>
          <div className="dz-art" aria-hidden>
            <div className="dz-screen">
              <span />
            </div>
          </div>
          <h2>{loading ? "Abrindo…" : "Arraste uma imagem ou GIF aqui"}</h2>
          <p className="muted">PNG, JPG, WebP ou GIF. Várias imagens ou GIFs viram um slideshow. Também dá para colar com Ctrl+V.</p>
          <div className="row">
            <button className="btn primary" disabled={loading} onClick={() => fileRef.current?.click()}>
              <Icon name="file" /> Escolher arquivo
            </button>
            <button className="btn" onClick={() => setGenerator("marquee")}>
              <Icon name="text" /> Letreiro animado
            </button>
            <button className="btn" onClick={() => setGenerator("background")}>
              <Icon name="sparkles" /> Fundo animado
            </button>
            <button className="btn ghost" onClick={startBlank}>
              Em branco
            </button>
            <button className="btn ghost" onClick={() => go("gallery")}>
              <Icon name="gallery" /> Galeria
            </button>
          </div>
        </div>
      ) : (
        <div className="editor">
          <div className="stage">
            <div className={`tft ${dragOver ? "over" : ""}`}>
              <div className="tft-glass">
                {original ? (
                  <ScreenPreview className="tft-canvas" previews={[original]} delays={[]} />
                ) : rendered ? (
                  <ScreenPreview
                    className="tft-canvas"
                    previews={rendered.previews}
                    delays={rendered.delays}
                    playing={playing}
                    onPan={(dx, dy) => patch({ panX: edit.panX + dx, panY: edit.panY + dy })}
                    onWheel={(d) => patch({ zoom: Math.min(4, Math.max(0.2, +(edit.zoom * (d > 0 ? 0.92 : 1.08)).toFixed(3))) })}
                  />
                ) : (
                  <div className="tft-canvas placeholder" />
                )}
                {original && <span className="tft-flag">Original</span>}
              </div>
              <span className="tft-label">128 × 128 · RGB565</span>
            </div>
            <p className="hint small muted">Arraste para posicionar · role para dar zoom · Ctrl+Z desfaz</p>
            <div className="stats">
              <Stat label="Quadros" value={String(frames)} />
              <Stat label="Duração" value={frames > 1 ? `${(duration / 1000).toFixed(1)} s` : "Estática"} />
              <Stat label="Tamanho" value={`${sizeKb} KB`} />
              {frames > 1 && (
                <button className="btn icon" title={playing ? "Pausar" : "Reproduzir"} onClick={() => setPlaying((p) => !p)}>
                  <Icon name={playing ? "pause" : "play"} />
                </button>
              )}
              <button
                className="btn icon"
                title="Segure para ver o original"
                onPointerDown={showOriginal}
                onPointerUp={() => setOriginal(null)}
                onPointerLeave={() => setOriginal(null)}
              >
                <Icon name="eye" />
              </button>
            </div>
            {frames > RECOMMENDED_MAX_FRAMES && <p className="warn small">Mais de {RECOMMENDED_MAX_FRAMES} quadros passa do limite do software oficial e pode falhar.</p>}
          </div>

          <div className="controls">
            <Card title="Enquadramento">
              <Segmented
                value={edit.fit}
                onChange={(fit) => patch({ fit, zoom: 1, panX: 0, panY: 0 })}
                options={[
                  { value: "cover", label: "Preencher", title: "Preenche a tela cortando as sobras" },
                  { value: "contain", label: "Caber", title: "Mostra a imagem inteira com bordas" },
                  { value: "stretch", label: "Esticar", title: "Distorce para ocupar tudo" },
                ]}
              />
              <Slider label="Zoom" value={edit.zoom} min={0.2} max={4} step={0.01} onChange={(zoom) => patch({ zoom })} format={(v) => `${Math.round(v * 100)}%`} />
              <div className="row tight">
                <button className="btn sm" onClick={() => patch({ rotate: ((edit.rotate + 90) % 360) as Edit["rotate"] })}>
                  <Icon name="rotate" size={16} /> Girar
                </button>
                <button className={`btn sm ${edit.flip ? "on" : ""}`} onClick={() => patch({ flip: !edit.flip })}>
                  <Icon name="flip" size={16} /> Espelhar
                </button>
                <button className="btn sm ghost" onClick={() => patch({ zoom: 1, panX: 0, panY: 0, rotate: 0, flip: false })}>
                  Centralizar
                </button>
              </div>
              <ColorField label="Cor de fundo" value={edit.bg} onChange={(bg) => patch({ bg })} />
            </Card>

            {animated && (
              <Card title="Animação" subtitle={`${source.frames.length} quadros no arquivo original`}>
                <Segmented
                  value={edit.playback}
                  onChange={(playback) => patch({ playback })}
                  options={[
                    { value: "normal", label: "Normal" },
                    { value: "reverse", label: "Invertido" },
                    { value: "pingpong", label: "Vaivém" },
                  ]}
                />
                <Slider label="Velocidade" value={edit.speed} min={0.25} max={4} step={0.05} onChange={(speed) => patch({ speed })} format={(v) => `${v.toFixed(2)}×`} />
                <Slider label="Começa no quadro" value={edit.trimStart} min={0} max={lastIndex} onChange={(trimStart) => patch({ trimStart, trimEnd: edit.trimEnd >= 0 && edit.trimEnd < trimStart ? trimStart : edit.trimEnd })} format={(v) => String(v + 1)} />
                <Slider label="Termina no quadro" value={edit.trimEnd < 0 ? lastIndex : edit.trimEnd} min={0} max={lastIndex} onChange={(v) => patch({ trimEnd: v >= lastIndex ? -1 : Math.max(v, edit.trimStart) })} format={(v) => String(v + 1)} />
                <Slider label="Máximo de quadros" value={edit.maxFrames} min={2} max={HARD_MAX_FRAMES} onChange={(maxFrames) => patch({ maxFrames })} format={(v) => (v > RECOMMENDED_MAX_FRAMES ? `${v} ⚠` : String(v))} />
              </Card>
            )}

            <Card title="Efeitos">
              <div className="chips">
                {FILTERS.map((f) => (
                  <button key={f.value} className={`chip ${edit.filter === f.value ? "on" : ""}`} onClick={() => patch({ filter: f.value })}>
                    {f.label}
                  </button>
                ))}
              </div>
              <Slider label="Matiz" value={edit.hue} min={-180} max={180} onChange={(hue) => patch({ hue })} format={(v) => `${v}°`} />
              <Slider label="Pixel art" value={edit.pixelate} min={1} max={16} onChange={(pixelate) => patch({ pixelate })} format={(v) => (v <= 1 ? "Desligado" : `${v}px`)} />
              <Slider label="Vinheta" value={edit.vignette} min={0} max={1} step={0.05} onChange={(vignette) => patch({ vignette })} format={(v) => `${Math.round(v * 100)}%`} />
              <Slider label="Desfoque" value={edit.blur} min={0} max={4} step={0.25} onChange={(blur) => patch({ blur })} format={(v) => `${v}px`} />
            </Card>

            <Card title="Cor e imagem">
              <Slider label="Brilho" value={edit.brightness} min={30} max={200} onChange={(brightness) => patch({ brightness })} format={(v) => `${v}%`} />
              <Slider label="Contraste" value={edit.contrast} min={30} max={200} onChange={(contrast) => patch({ contrast })} format={(v) => `${v}%`} />
              <Slider label="Saturação" value={edit.saturation} min={0} max={250} onChange={(saturation) => patch({ saturation })} format={(v) => `${v}%`} />
              <Toggle label="Dithering" hint="Suaviza degradês na tela de 16 bits" checked={edit.dither} onChange={(dither) => patch({ dither })} />
            </Card>

            <Card title="Texto">
              <input className="input" placeholder="Escreva algo para a tela…" maxLength={24} value={edit.text.text} onChange={(e) => patchText({ text: e.target.value })} />
              {edit.text.text && (
                <>
                  <Select label="Fonte" value={edit.text.font} onChange={(font) => patchText({ font })} options={FONTS} />
                  <Slider label="Tamanho" value={edit.text.size} min={8} max={64} onChange={(size) => patchText({ size })} format={(v) => `${v}px`} />
                  <Slider label="Posição horizontal" value={edit.text.x} min={0} max={128} onChange={(x) => patchText({ x })} />
                  <Slider label="Posição vertical" value={edit.text.y} min={0} max={128} onChange={(y) => patchText({ y })} />
                  <ColorField label="Cor do texto" value={edit.text.color} onChange={(color) => patchText({ color })} />
                  <div className="toggle-grid">
                    <Toggle label="Contorno" checked={edit.text.stroke} onChange={(stroke) => patchText({ stroke })} />
                    <Toggle label="Negrito" checked={edit.text.bold} onChange={(bold) => patchText({ bold })} />
                    <Toggle label="Brilho neon" checked={edit.text.glow} onChange={(glow) => patchText({ glow })} />
                    <Toggle label="Piscar" checked={edit.text.blink} onChange={(blink) => patchText({ blink })} />
                  </div>
                </>
              )}
            </Card>
          </div>
        </div>
      )}

      {source && (
        <footer className="actionbar">
          <input className="input name" value={name} maxLength={60} placeholder="Nome na galeria" onChange={(e) => setName(e.target.value)} />
          <div className="spacer" />
          <div className="menu-wrap">
            <button className="btn" disabled={!rendered} onClick={() => setExportOpen((o) => !o)}>
              <Icon name="download" /> Exportar
            </button>
            {exportOpen && (
              <div className="menu up" onMouseLeave={() => setExportOpen(false)}>
                <button onClick={() => doExport("png")}>PNG (512×512)</button>
                <button onClick={() => doExport("gif")}>GIF animado (256×256)</button>
              </div>
            )}
          </div>
          <button className="btn" disabled={!rendered || busy} onClick={() => save(false)}>
            <Icon name="save" /> Salvar na galeria
          </button>
          <button className="btn" disabled={!canSend} onClick={() => save(true)}>
            Salvar e enviar
          </button>
          <button className="btn primary" disabled={!canSend} onClick={send} title={status.state !== "connected" ? status.message : undefined}>
            <Icon name="upload" /> Enviar para o teclado
          </button>
        </footer>
      )}

      {generator === "marquee" && (
        <MarqueeDialog
          maxFrames={edit.maxFrames}
          onClose={() => setGenerator(null)}
          onCreate={async (o) => {
            setGenerator(null);
            setLoading(true);
            try {
              useSource(await marquee(o), `Letreiro ${o.text}`.trim(), { fit: "stretch", dither: false });
            } finally {
              setLoading(false);
            }
          }}
        />
      )}
      {generator === "background" && (
        <BackgroundDialog
          onClose={() => setGenerator(null)}
          onCreate={async (kind, a, b) => {
            setGenerator(null);
            setLoading(true);
            try {
              const src = await background(kind, a, b);
              useSource(src, src.name, { fit: "stretch" });
            } finally {
              setLoading(false);
            }
          }}
        />
      )}
      {generator === "slideshow" && (
        <SlideshowDialog
          files={slideFiles}
          onClose={() => setGenerator(null)}
          onPick={() => fileRef.current?.click()}
          onCreate={async (opts) => {
            setGenerator(null);
            setLoading(true);
            try {
              const src = await slideshow(slideFiles, opts);
              useSource(src, src.name);
            } catch (e) {
              toast("error", (e as Error).message);
            } finally {
              setLoading(false);
            }
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="small muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CreateMenu({ onFile, onGen, onBlank, compact }: { onFile: () => void; onGen: (g: Generator) => void; onBlank: () => void; compact: boolean }) {
  const [open, setOpen] = useState(false);
  if (!compact) return null;
  return (
    <div className="menu-wrap">
      <button className="btn" onClick={() => setOpen((o) => !o)}>
        <Icon name="plus" /> Novo
      </button>
      {open && (
        <div className="menu" onMouseLeave={() => setOpen(false)} onClick={() => setOpen(false)}>
          <button onClick={onFile}>
            <Icon name="file" size={15} /> Abrir arquivo(s)…
          </button>
          <button onClick={() => onGen("marquee")}>
            <Icon name="text" size={15} /> Letreiro animado
          </button>
          <button onClick={() => onGen("background")}>
            <Icon name="sparkles" size={15} /> Fundo animado
          </button>
          <button onClick={() => onGen("slideshow")}>
            <Icon name="layers" size={15} /> Slideshow
          </button>
          <button onClick={onBlank}>
            <Icon name="screen" size={15} /> Em branco
          </button>
        </div>
      )}
    </div>
  );
}

function MarqueeDialog({ maxFrames, onClose, onCreate }: { maxFrames: number; onClose: () => void; onCreate: (o: MarqueeOpts) => void }) {
  const [o, setO] = useState<MarqueeOpts>({ text: "AKUMA ✦ AK820 PRO", color: "#00e5ff", bg: "#0b0b14", size: 44, font: FONTS[1].value, speed: 70, direction: "left", maxFrames, glow: true });
  const p = (x: Partial<MarqueeOpts>) => setO((v) => ({ ...v, ...x }));
  return (
    <Modal
      title="Letreiro animado"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" onClick={() => onCreate(o)}>
            Criar letreiro
          </button>
        </>
      }
    >
      <input className="input" autoFocus value={o.text} maxLength={80} onChange={(e) => p({ text: e.target.value })} placeholder="Texto que vai passar na tela" />
      <Segmented
        value={o.direction}
        onChange={(direction) => p({ direction })}
        options={[
          { value: "left", label: "← Para a esquerda" },
          { value: "right", label: "Para a direita →" },
          { value: "up", label: "↑ Subindo" },
        ]}
      />
      <Select label="Fonte" value={o.font} onChange={(font) => p({ font })} options={FONTS} />
      <Slider label="Tamanho" value={o.size} min={14} max={110} onChange={(size) => p({ size })} format={(v) => `${v}px`} />
      <Slider label="Velocidade" value={o.speed} min={15} max={220} onChange={(speed) => p({ speed })} format={(v) => `${v} px/s`} />
      <ColorField label="Cor do texto" value={o.color} onChange={(color) => p({ color })} />
      <ColorField label="Cor de fundo" value={o.bg} onChange={(bg) => p({ bg })} />
      <Toggle label="Brilho neon" checked={o.glow} onChange={(glow) => p({ glow })} />
    </Modal>
  );
}

function BackgroundDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (k: BackgroundKind, a: string, b: string) => void }) {
  const [kind, setKind] = useState<BackgroundKind>("plasma");
  const [a, setA] = useState("#7c4dff");
  const [b, setB] = useState("#00e5ff");
  return (
    <Modal
      title="Fundo animado"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" onClick={() => onCreate(kind, a, b)}>
            Criar fundo
          </button>
        </>
      }
    >
      <div className="chips">
        {BACKGROUNDS.map((bg) => (
          <button key={bg.value} className={`chip ${kind === bg.value ? "on" : ""}`} onClick={() => setKind(bg.value)}>
            {bg.label}
          </button>
        ))}
      </div>
      <ColorField label="Cor 1" value={a} onChange={setA} />
      <ColorField label="Cor 2" value={b} onChange={setB} />
      <p className="small muted">Depois de criar, dá para escrever um texto por cima na seção Texto.</p>
    </Modal>
  );
}

function SlideshowDialog({ files, onClose, onPick, onCreate }: { files: File[]; onClose: () => void; onPick: () => void; onCreate: (o: SlideshowOpts) => void }) {
  const [hold, setHold] = useState(2500);
  const [transition, setTransition] = useState<"none" | "fade" | "slide">("fade");
  const [tf, setTf] = useState(6);
  const [gifMode, setGifMode] = useState<"once" | "fill">("fill");
  const hasGif = files.some((f) => /gif|webp/i.test(f.type || f.name));
  return (
    <Modal
      title="Slideshow"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={files.length < 2} onClick={() => onCreate({ holdMs: hold, transition, transitionFrames: tf, gifMode })}>
            Criar slideshow
          </button>
        </>
      }
    >
      {files.length < 2 ? (
        <div className="row">
          <p className="muted">Escolha duas ou mais imagens ou GIFs.</p>
          <button className="btn" onClick={onPick}>
            <Icon name="file" /> Escolher imagens
          </button>
        </div>
      ) : (
        <p className="muted">
          {files.length} arquivos: {files.map((f) => f.name).join(", ").slice(0, 160)}
        </p>
      )}
      {hasGif && (
        <div className="field">
          <span>GIFs animados</span>
          <Segmented
            value={gifMode}
            onChange={setGifMode}
            options={[
              { value: "fill", label: "Repetir até completar o tempo" },
              { value: "once", label: "Tocar uma vez" },
            ]}
          />
        </div>
      )}
      <Slider label={hasGif ? "Tempo de cada slide (imagens e GIFs repetidos)" : "Tempo de cada imagem"} value={hold} min={500} max={10000} step={250} onChange={setHold} format={(v) => `${(v / 1000).toFixed(1)} s`} />
      <Segmented
        value={transition}
        onChange={setTransition}
        options={[
          { value: "none", label: "Sem transição" },
          { value: "fade", label: "Esmaecer" },
          { value: "slide", label: "Deslizar" },
        ]}
      />
      {transition !== "none" && <Slider label="Suavidade da transição" value={tf} min={2} max={12} onChange={setTf} format={(v) => `${v} quadros`} />}
      <p className="small muted">Imagens longas viram quadros repetidos — o limite de quadros continua valendo.</p>
    </Modal>
  );
}
