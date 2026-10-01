import { useEffect, useState } from "react";
import { useApp } from "../App";
import { api, isTauri, onActivity, type InterfaceInfo, type LogEntry } from "../lib/api";
import { Card, Icon, Segmented, Toggle } from "../components/ui";
import { UpdatesCard } from "../components/Updates";

const INTERVALS = [
  { value: 0, label: "Nunca" },
  { value: 15, label: "15 min" },
  { value: 60, label: "1 h" },
  { value: 360, label: "6 h" },
];

const SLEEP = [
  { value: 0, label: "Nunca" },
  { value: 1, label: "1 min" },
  { value: 2, label: "5 min" },
  { value: 3, label: "30 min" },
];

export function SystemPage() {
  const { settings, updateSettings, toast, status, busy, reloadSettings } = useApp();
  const [now, setNow] = useState(new Date());
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [diag, setDiag] = useState<InterfaceInfo[] | null>(null);
  const [sleepVal, setSleepVal] = useState<number>(settings?.sleep ?? 2);
  const online = status.state === "connected" || status.state === "partial";
  const [log, setLog] = useState<LogEntry[]>([]);
  const [logFilter, setLogFilter] = useState<"all" | "error">("all");
  const [pinging, setPinging] = useState(false);

  useEffect(() => {
    api.activityLog().then(setLog).catch(() => undefined);
    const off = onActivity((e) => setLog((l) => [e, ...l].slice(0, 300)));
    return () => void off.then((f) => f());
  }, []);

  const ping = async () => {
    setPinging(true);
    try {
      const r = await api.ping();
      toast("ok", `O teclado respondeu em ${r.ms} ms${r.imageInterface ? "" : " (interface de imagem indisponível)"}`);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setPinging(false);
    }
  };

  const backup = async () => {
    try {
      if (await api.exportBackup()) toast("ok", "Backup salvo");
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  const restore = async () => {
    try {
      const s = await api.importBackup();
      if (s) {
        reloadSettings();
        toast("ok", "Configurações restauradas");
      }
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (settings?.sleep != null) setSleepVal(settings.sleep);
  }, [settings?.sleep]);

  const sync = async () => {
    setSyncing(true);
    try {
      const t = await api.syncTime();
      setLastSync(t);
      toast("ok", `Relógio do teclado acertado para ${t}`);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const loadDiag = () => api.diagnostics().then(setDiag).catch((e) => toast("error", e.message));

  const copyDiag = async () => {
    const text = (diag ?? []).map((d) => `${d.vid}:${d.pid} if=${d.interface} page=${d.usagePage} usage=${d.usage} ${d.role} ${d.product}`).join("\n");
    try {
      await navigator.clipboard.writeText(text || "nenhuma interface");
      toast("ok", "Diagnóstico copiado");
    } catch {
      toast("error", "Não foi possível copiar");
    }
  };

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Relógio e sistema</h1>
          <p className="muted">Hora da telinha, suspensão das luzes e opções do aplicativo.</p>
        </div>
      </header>

      <div className="system-grid">
        <Card title="Relógio da tela" subtitle="O teclado tem um relógio próprio com bateria; aqui ele é acertado com o horário do PC.">
          <div className="clock">
            <span className="clock-time">{now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
            <span className="clock-sec">{String(now.getSeconds()).padStart(2, "0")}</span>
            <span className="clock-date muted">{capitalize(now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }))}</span>
          </div>
          <button className="btn primary wide" disabled={!online || syncing || busy} onClick={sync}>
            <Icon name="refresh" /> {syncing ? "Sincronizando…" : "Sincronizar agora"}
          </button>
          {lastSync && <p className="small muted center">Última sincronização: {lastSync}</p>}
          {settings && (
            <>
              <Toggle label="Sincronizar ao conectar" hint="Acerta a hora sempre que o teclado for ligado ao PC" checked={settings.autoSyncOnConnect} onChange={(autoSyncOnConnect) => updateSettings({ autoSyncOnConnect })} />
              <div className="field">
                <span>Sincronizar periodicamente</span>
                <Segmented value={settings.syncIntervalMin} options={INTERVALS} onChange={(syncIntervalMin) => updateSettings({ syncIntervalMin })} />
              </div>
            </>
          )}
        </Card>

        <div className="stack">
          <Card title="Suspensão das luzes" subtitle="Tempo sem uso até o RGB apagar.">
            <Segmented value={sleepVal} options={SLEEP} onChange={setSleepVal} />
            <button
              className="btn"
              disabled={!online || busy}
              onClick={async () => {
                try {
                  await api.setSleep(sleepVal);
                  toast("ok", "Tempo de suspensão salvo no teclado");
                } catch (e) {
                  toast("error", (e as Error).message);
                }
              }}
            >
              Aplicar
            </button>
          </Card>

          <Card title="Aplicativo">
            {settings && (
              <>
                <Toggle label="Iniciar com o Windows" hint="Abre minimizado na bandeja para manter o relógio certo" checked={settings.startWithWindows} onChange={(startWithWindows) => updateSettings({ startWithWindows })} />
                <Toggle label="Fechar para a bandeja" hint="O X esconde a janela; sair pelo ícone da bandeja" checked={settings.minimizeToTray} onChange={(minimizeToTray) => updateSettings({ minimizeToTray })} />
                <Toggle label="Dithering por padrão" hint="Usado em novas imagens" checked={settings.dithering} onChange={(dithering) => updateSettings({ dithering })} />
              </>
            )}
          </Card>
        </div>

        <Card
          title="Histórico"
          subtitle="Tudo o que o app fez no teclado nesta sessão."
          actions={
            <>
              <button className={`btn sm ${logFilter === "error" ? "on" : "ghost"}`} onClick={() => setLogFilter(logFilter === "error" ? "all" : "error")}>
                Só erros
              </button>
              <button className="btn sm ghost" onClick={() => api.activityClear().then(() => setLog([]))}>
                Limpar
              </button>
            </>
          }
        >
          <div className="log">
            {log.filter((l) => logFilter === "all" || l.kind === "error").length === 0 && <p className="small muted">Nada por aqui ainda.</p>}
            {log
              .filter((l) => logFilter === "all" || l.kind === "error")
              .slice(0, 120)
              .map((l, i) => (
                <div key={i} className={`log-row ${l.kind}`}>
                  <span className="log-time">{new Date(l.ts).toLocaleTimeString("pt-BR")}</span>
                  <span className="log-dot" />
                  <span className="log-msg">{l.message}</span>
                </div>
              ))}
          </div>
        </Card>

        <UpdatesCard />

        <Card title="Backup" subtitle="Perfis, horários, rotação e preferências em um arquivo .json. Os itens da galeria são exportados um a um (.ak820).">
          <div className="row tight">
            <button className="btn" onClick={backup}>
              <Icon name="download" /> Fazer backup
            </button>
            <button className="btn" disabled={!isTauri} onClick={restore}>
              <Icon name="upload" /> Restaurar
            </button>
          </div>
          <div className="row tight">
            <button className="btn" disabled={!online || pinging || busy} onClick={ping}>
              <Icon name="usb" /> {pinging ? "Testando…" : "Testar comunicação"}
            </button>
            <span className="small muted">Abre as interfaces do teclado e mede o tempo de resposta.</span>
          </div>
        </Card>

        <Card
          className="span-2"
          title="Diagnóstico"
          subtitle="Interfaces USB do teclado que o aplicativo enxerga. Útil se algo não funcionar."
          actions={
            <>
              <button className="btn sm" onClick={loadDiag}>
                <Icon name="refresh" size={15} /> Verificar
              </button>
              {diag && (
                <button className="btn sm ghost" onClick={copyDiag}>
                  <Icon name="copy" size={15} /> Copiar
                </button>
              )}
            </>
          }
        >
          {diag === null ? (
            <p className="muted small">Clique em Verificar para listar as interfaces.</p>
          ) : diag.length === 0 ? (
            <p className="warn small">Nenhuma interface da AJAZZ (VID 0C45) encontrada. Confira o cabo e a chave de modo.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>VID:PID</th>
                  <th>Interface</th>
                  <th>Usage page</th>
                  <th>Função</th>
                  <th>Produto</th>
                </tr>
              </thead>
              <tbody>
                {diag.map((d, i) => (
                  <tr key={i} className={d.role ? "hl" : ""}>
                    <td>
                      <code>
                        {d.vid}:{d.pid}
                      </code>
                    </td>
                    <td>{d.interface}</td>
                    <td>
                      <code>{d.usagePage}</code>
                    </td>
                    <td>{d.role || "—"}</td>
                    <td>{d.product}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <ul className="tips small muted">
            <li>Use um cabo USB-C de dados e a chave do teclado no modo com fio. Sem fio e Bluetooth não permitem configurar.</li>
            <li>Feche o software oficial da AJAZZ antes de usar o AK820 Studio — os dois disputam a mesma interface.</li>
            <li>Protocolo com base nos projetos abertos ajazz-ak820-config, aks075-linux e ak820pro-modder.</li>
            {!isTauri && <li>Você está no modo demonstração (navegador). Nada é enviado de verdade.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
