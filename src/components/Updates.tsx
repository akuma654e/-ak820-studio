import { useEffect, useState } from "react";
import { useApp } from "../App";
import { api3, onUpdateAvailable, onUpdateProgress, type UpdateInfo, type UpdateStatus } from "../lib/api";
import { Card, Icon, Toggle } from "./ui";

/** Baixa e instala; mostra o progresso numa janela por cima de tudo. */
export function useInstaller() {
  const { toast } = useApp();
  const [progress, setProgress] = useState<{ downloaded: number; total: number | null } | null>(null);
  useEffect(() => {
    const off = onUpdateProgress(setProgress);
    return () => void off.then((f) => f());
  }, []);
  const install = async () => {
    setProgress({ downloaded: 0, total: null });
    try {
      await api3.updateInstall(); // no Windows o app fecha e reabre sozinho
    } catch (e) {
      setProgress(null);
      toast("error", (e as Error).message);
    }
  };
  return { progress, install };
}

export function InstallOverlay({ progress, version }: { progress: { downloaded: number; total: number | null }; version?: string }) {
  const pct = progress.total ? Math.round((progress.downloaded / progress.total) * 100) : 0;
  const mb = (n: number) => (n / 1048576).toFixed(1);
  return (
    <div className="overlay" role="dialog" aria-label="Atualizando">
      <div className="overlay-card">
        <div className="spinner" />
        <h3>Atualizando{version ? ` para ${version}` : ""}</h3>
        <p className="muted">O AK820 Studio vai fechar e abrir de novo sozinho. Sua galeria e configurações continuam.</p>
        <div className="progress">
          <div style={{ width: `${progress.total ? pct : 8}%` }} />
        </div>
        <span className="small muted">{progress.total ? `${mb(progress.downloaded)} de ${mb(progress.total)} MB · ${pct}%` : "Baixando…"}</span>
      </div>
    </div>
  );
}

/** Aviso que aparece quando o app encontra uma versão nova ao abrir. */
export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [hidden, setHidden] = useState(false);
  const { progress, install } = useInstaller();
  useEffect(() => {
    const off = onUpdateAvailable(setInfo);
    return () => void off.then((f) => f());
  }, []);
  if (progress) return <InstallOverlay progress={progress} version={info?.version} />;
  if (!info || hidden) return null;
  return (
    <div className="update-banner" role="status">
      <Icon name="download" />
      <div>
        <strong>Versão {info.version} disponível</strong>
        {info.notes && <span className="small muted">{info.notes.split("\n")[0].slice(0, 120)}</span>}
      </div>
      <button className="btn sm ghost" onClick={() => setHidden(true)}>
        Depois
      </button>
      <button className="btn sm primary" onClick={install}>
        Atualizar agora
      </button>
    </div>
  );
}

/** Cartão na página Relógio e sistema. */
export function UpdatesCard() {
  const { settings, updateSettings, toast } = useApp();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [version, setVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const { progress, install } = useInstaller();

  useEffect(() => {
    api3.appVersion().then(setVersion).catch(() => undefined);
  }, []);

  const check = async () => {
    setChecking(true);
    try {
      const s = await api3.updateCheck();
      setStatus(s);
      if (!s.enabled) toast("info", "Esta é uma compilação local: as atualizações automáticas só funcionam nas versões compiladas pelo GitHub.");
      else if (!s.available) toast("ok", `Você já está na versão mais recente (${s.current})`);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <Card title="Atualizações" subtitle={`Versão instalada: ${version || "…"}${status?.repo ? ` · github.com/${status.repo}` : ""}`}>
      {progress && <InstallOverlay progress={progress} version={status?.available?.version} />}
      {status?.available ? (
        <div className="update-found">
          <strong>Nova versão {status.available.version}</strong>
          {status.available.notes && <pre className="notes">{status.available.notes}</pre>}
          <button className="btn primary" onClick={install}>
            <Icon name="download" /> Baixar e instalar
          </button>
        </div>
      ) : (
        <button className="btn" disabled={checking} onClick={check}>
          <Icon name="refresh" /> {checking ? "Procurando…" : "Procurar atualizações"}
        </button>
      )}
      {status && !status.enabled && <p className="small muted">Compilação local: publique pelo GitHub (scripts\release.ps1) para receber atualizações automáticas.</p>}
      {settings && <Toggle label="Procurar ao abrir o app" checked={settings.autoUpdateCheck} onChange={(autoUpdateCheck) => updateSettings({ autoUpdateCheck })} />}
    </Card>
  );
}
