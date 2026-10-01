import { useEffect, useMemo, useState } from "react";
import { useApp } from "../App";
import { api, isTauri, onScreenChanged, type GalleryItem, type Rotation } from "../lib/api";
import { FRAME_BYTES, rgb565ToImageData } from "../lib/imaging";
import { ScreenPreview } from "../components/ScreenPreview";
import { Icon, Segmented, Select, Toggle } from "../components/ui";

type Sort = "recent" | "oldest" | "name" | "frames";

const INTERVALS = [5, 15, 30, 60, 120, 360, 720, 1440].map((v) => ({ value: v, label: v < 60 ? `${v} min` : `${v / 60} h` }));

export function GalleryPage() {
  const { galleryVersion, bumpGallery, toast, runUpload, busy, status, go, openInEditor, settings, updateSettings, setLastScreen } = useApp();
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [onlyFav, setOnlyFav] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);

  const reload = () =>
    api
      .galleryList()
      .then(setItems)
      .catch((e) => toast("error", e.message));

  useEffect(() => {
    void reload();
    api.galleryCurrent().then(setCurrent).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryVersion]);

  useEffect(() => {
    const off = onScreenChanged(setCurrent);
    return () => void off.then((f) => f());
  }, []);

  const shown = useMemo(() => {
    const q = query.toLowerCase();
    const list = (items ?? []).filter((i) => i.name.toLowerCase().includes(q) && (!onlyFav || i.favorite));
    const by: Record<Sort, (a: GalleryItem, b: GalleryItem) => number> = {
      recent: (a, b) => b.created - a.created,
      oldest: (a, b) => a.created - b.created,
      name: (a, b) => a.name.localeCompare(b.name, "pt-BR"),
      frames: (a, b) => b.frames - a.frames,
    };
    return [...list].sort((a, b) => Number(b.favorite) - Number(a.favorite) || by[sort](a, b));
  }, [items, query, sort, onlyFav]);

  const canSend = status.state === "connected" && !busy;
  const favCount = (items ?? []).filter((i) => i.favorite).length;
  const rot = settings?.rotation;
  const setRot = (p: Partial<Rotation>) => rot && updateSettings({ rotation: { ...rot, ...p } });

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast("ok", ok);
      bumpGallery();
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  const sendItem = (item: GalleryItem) =>
    runUpload(`Enviando “${item.name}”`, async () => {
      await api.galleryUpload(item.id);
      setCurrent(item.id);
      const bytes = await api.galleryFrames(item.id);
      setLastScreen(rgb565ToImageData(bytes, 0));
    });

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Galeria</h1>
          <p className="muted">Suas imagens e GIFs salvos. Um clique troca a tela do teclado.</p>
        </div>
        <div className="head-actions">
          {isTauri && (
            <button className="btn ghost" onClick={() => act(async () => { const it = await api.galleryImport(); if (it) toast("ok", `“${it.name}” importado`); })}>
              <Icon name="download" /> Importar .ak820
            </button>
          )}
          <button className="btn primary" onClick={() => go("display")}>
            <Icon name="plus" /> Nova imagem
          </button>
        </div>
      </header>

      {rot && (items?.length ?? 0) > 1 && (
        <section className={`rotation ${rot.enabled ? "on" : ""}`}>
          <div className="rotation-main">
            <Icon name="shuffle" />
            <div>
              <strong>Rotação automática de telas</strong>
              <span className="small muted">
                Troca a tela sozinho {rot.source === "favorites" && favCount ? `entre os ${favCount} favoritos` : "entre todos os itens"}. Cada troca regrava a tela do teclado.
              </span>
            </div>
          </div>
          <div className="rotation-controls">
            <Select value={rot.intervalMin} onChange={(intervalMin) => setRot({ intervalMin })} options={INTERVALS} />
            <Segmented
              value={rot.source}
              onChange={(source) => setRot({ source })}
              options={[
                { value: "favorites", label: "Favoritos" },
                { value: "all", label: "Todos" },
              ]}
            />
            <Toggle label="Aleatório" checked={rot.shuffle} onChange={(shuffle) => setRot({ shuffle })} />
            <Toggle label={rot.enabled ? "Ligada" : "Desligada"} checked={rot.enabled} onChange={(enabled) => setRot({ enabled })} />
          </div>
        </section>
      )}

      {items && items.length > 0 && (
        <div className="toolbar">
          <input className="input search" placeholder="Buscar…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className={`chip ${onlyFav ? "on" : ""}`} onClick={() => setOnlyFav((v) => !v)}>
            <Icon name="star" size={14} /> Favoritos {favCount ? `(${favCount})` : ""}
          </button>
          <div className="spacer" />
          <Select
            value={sort}
            onChange={setSort}
            options={[
              { value: "recent", label: "Mais recentes" },
              { value: "oldest", label: "Mais antigos" },
              { value: "name", label: "Nome (A–Z)" },
              { value: "frames", label: "Mais quadros" },
            ]}
          />
        </div>
      )}

      {items && items.length === 0 && (
        <div className="empty">
          <div className="empty-art" aria-hidden>
            <Icon name="gallery" size={34} />
          </div>
          <h2>Nada salvo ainda</h2>
          <p className="muted">Abra uma imagem na aba Tela e use “Salvar na galeria”.</p>
          <button className="btn primary" onClick={() => go("display")}>
            Criar a primeira
          </button>
        </div>
      )}

      <div className="gallery-grid">
        {shown.map((item) => (
          <GalleryCard
            key={item.id}
            item={item}
            current={current === item.id}
            canSend={canSend}
            onSend={() => sendItem(item)}
            onFavorite={() => act(() => api.gallerySetFavorite(item.id, !item.favorite))}
            onEdit={() => openInEditor(item)}
            onDuplicate={() => act(() => api.galleryDuplicate(item.id), "Cópia criada")}
            onExport={() => act(async () => { if (await api.galleryExport(item)) toast("ok", "Item exportado"); })}
            onRename={(name) => act(() => api.galleryRename(item.id, name))}
            onDelete={() => act(() => api.galleryDelete(item.id), `“${item.name}” excluído`)}
          />
        ))}
      </div>
    </div>
  );
}

type CardProps = {
  item: GalleryItem;
  current: boolean;
  canSend: boolean;
  onSend: () => void;
  onFavorite: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onRename: (n: string) => void;
  onDelete: () => void;
};

function GalleryCard({ item, current, canSend, onSend, onFavorite, onEdit, onDuplicate, onExport, onRename, onDelete }: CardProps) {
  const [hover, setHover] = useState(false);
  const [anim, setAnim] = useState<ImageData[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!hover || anim || item.frames < 2) return;
    let alive = true;
    api.galleryFrames(item.id).then((bytes) => {
      if (!alive) return;
      const n = Math.floor(bytes.length / FRAME_BYTES);
      setAnim(Array.from({ length: n }, (_, i) => rgb565ToImageData(bytes, i * FRAME_BYTES)));
    });
    return () => {
      alive = false;
    };
  }, [hover, anim, item]);

  const seconds = item.delays.reduce((a, b) => a + b, 0) / 1000;

  return (
    <article className={`gcard ${current ? "current" : ""}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => (setHover(false), setConfirm(false), setMenu(false))}>
      <div className="gthumb">
        {hover && anim ? <ScreenPreview previews={anim} delays={item.delays} /> : <img src={item.thumb} alt="" draggable={false} />}
        {item.frames > 1 && <span className="badge">GIF · {item.frames}</span>}
        {current && <span className="badge now">Na tela</span>}
        <button className={`fav ${item.favorite ? "on" : ""}`} onClick={onFavorite} title={item.favorite ? "Remover dos favoritos" : "Favoritar"} aria-pressed={item.favorite}>
          <Icon name="star" size={16} />
        </button>
        <button className="gsend" disabled={!canSend} onClick={onSend} title="Enviar para o teclado">
          <Icon name="upload" size={16} /> Enviar
        </button>
      </div>
      <div className="gmeta">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setEditing(false);
              if (name.trim() && name !== item.name) onRename(name);
            }}
          >
            <input className="input sm" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onBlur={() => setEditing(false)} />
          </form>
        ) : (
          <div className="gname" title={item.name} onDoubleClick={() => (setName(item.name), setEditing(true))}>
            {item.name}
          </div>
        )}
        <div className="gsub small muted">
          {item.frames > 1 ? `${seconds.toFixed(1)} s` : "Estática"} · {new Date(item.created).toLocaleDateString("pt-BR")}
        </div>
        <div className="gactions">
          <button className="btn icon sm ghost" title="Editar de novo" onClick={onEdit}>
            <Icon name="edit" size={15} />
          </button>
          <div className="menu-wrap">
            <button className="btn icon sm ghost" title="Mais" onClick={() => setMenu((m) => !m)} aria-label="Mais opções">
              ⋯
            </button>
            {menu && (
              <div className="menu right" onClick={() => setMenu(false)}>
                <button onClick={() => (setName(item.name), setEditing(true))}>Renomear</button>
                <button onClick={onDuplicate}>Duplicar</button>
                <button onClick={onExport}>Exportar (.ak820)</button>
                <button className="danger" onClick={(e) => (e.stopPropagation(), setConfirm(true), setMenu(false))}>
                  Excluir…
                </button>
              </div>
            )}
          </div>
        </div>
        {confirm && (
          <div className="confirm">
            <span className="small">Excluir “{item.name}”?</span>
            <button className="btn sm danger" onClick={onDelete}>
              Excluir
            </button>
            <button className="btn sm ghost" onClick={() => setConfirm(false)}>
              Não
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
