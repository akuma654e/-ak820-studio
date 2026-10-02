import { useEffect, useState } from "react";
import { useApp } from "../App";
import { api3 } from "../lib/api";
import { checkForUpdates, type UpdateCheck } from "../lib/updates";
import { Card, Icon, Toggle } from "./ui";

async function runUpdate(toast: (k: "ok" | "error" | "info", m: string) => void) {
  try {
    await api3.updateRun();
    toast("info", "Atualizando numa janela do PowerShell. O app fecha e abre sozinho quando terminar.");
  } catch (e) {
    toast("error", (e as Error).message);
  }
}

function CommitList({ check }: { check: UpdateCheck }) {
  return (
    <ul className="commits">
      {check.newCommits.slice(0, 12).map((c) => (
        <li key={c.sha}>
          <code>{c.sha.slice(0, 7)}</code> {c.message}
        </li>
      ))}
      {check.newCommits.length > 12 && <li className="muted">… e mais {check.newCommits.length - 12}</li>}
    </ul>
  );
}

/** Aviso no topo quando há commits novos no GitHub (verificado ao abrir). */
export function UpdateBanner() {
  const { settings, toast } = useApp();
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [hidden, setHidden] = useState(false);
  const enabled = settings?.autoUpdateCheck;

  useEffect(() => {
    if (!enabled) return;
    const t = window.setTimeout(() => {
      checkForUpdates()
        .then((c) => !c.upToDate && c.info.canUpdate && setCheck(c))
        .catch(() => undefined);
    }, 8000);
    return () => window.clearTimeout(t);
  }, [enabled]);

  if (!check || hidden) return null;
  return (
    <div className="update-banner" role="status">
      <Icon name="download" />
      <div>
        <strong>Atualização disponível ({check.newCommits.length} {check.newCommits.length === 1 ? "mudança" : "mudanças"})</strong>
        <span className="small muted">{check.newCommits[check.newCommits.length - 1]?.message}</span>
      </div>
      <button className="btn sm ghost" onClick={() => setHidden(true)}>
        Depois
      </button>
      <button className="btn sm primary" onClick={() => (setHidden(true), runUpdate(toast))}>
        Atualizar agora
      </button>
    </div>
  );
}

/** Cartão na página Relógio e sistema. */
export function UpdatesCard() {
  const { settings, updateSettings, toast } = useApp();
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [info, setInfo] = useState<UpdateCheck["info"] | null>(null);

  useEffect(() => {
    api3.buildInfo().then(setInfo).catch(() => undefined);
  }, []);

  const doCheck = async () => {
    setChecking(true);
    try {
      const c = await checkForUpdates();
      setCheck(c);
      if (c.problem) toast("info", c.problem);
      else if (c.upToDate) toast("ok", "Você já está com a versão mais recente do GitHub");
    } catch (e) {
      toast("error", `Não consegui consultar o GitHub: ${(e as Error).message}`);
    } finally {
      setChecking(false);
    }
  };

  const sub = info ? `Versão ${info.version}${info.commit ? ` · commit ${info.commit.slice(0, 7)}` : ""}${info.repo ? ` · github.com/${info.repo}` : ""}` : "…";

  return (
    <Card title="Atualizações" subtitle={sub}>
      {check && !check.upToDate ? (
        <div className="update-found">
          <strong>{check.newCommits.length} {check.newCommits.length === 1 ? "mudança nova" : "mudanças novas"} no GitHub</strong>
          <CommitList check={check} />
          <button className="btn primary" disabled={!check.info.canUpdate} onClick={() => runUpdate(toast)}>
            <Icon name="download" /> Atualizar agora
          </button>
          <span className="small muted">Abre o PowerShell: baixa o código (git pull), compila e reinicia o app. Leva alguns minutos; dá para continuar usando enquanto compila.</span>
        </div>
      ) : (
        <div className="row tight">
          <button className="btn" disabled={checking} onClick={doCheck}>
            <Icon name="refresh" /> {checking ? "Procurando…" : "Procurar atualizações"}
          </button>
          {info?.canUpdate && (
            <button className="btn ghost" onClick={() => runUpdate(toast)} title="Roda o update.ps1 mesmo sem novidades (recompila)">
              Recompilar
            </button>
          )}
        </div>
      )}
      {info && !info.canUpdate && <p className="small warn">Não achei a pasta do código ({info.sourceDir || "desconhecida"}). Rode scripts\update.ps1 dentro da pasta clonada.</p>}
      {settings && <Toggle label="Procurar ao abrir o app" checked={settings.autoUpdateCheck} onChange={(autoUpdateCheck) => updateSettings({ autoUpdateCheck })} />}
    </Card>
  );
}
