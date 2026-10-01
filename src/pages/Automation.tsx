import { useEffect, useState } from "react";
import { useApp } from "../App";
import { api, api3, onActiveRule, uid, type AppRule, type GalleryItem, type Schedule, type ScheduleAction } from "../lib/api";
import { Card, Icon, Select, Toggle } from "../components/ui";

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const ACTIONS: { value: ScheduleAction; label: string }[] = [
  { value: "screen", label: "Trocar a tela" },
  { value: "profile", label: "Aplicar perfil de luz" },
  { value: "lightsOff", label: "Apagar as luzes" },
  { value: "lightsOn", label: "Acender as luzes" },
  { value: "sync", label: "Sincronizar relógio" },
  { value: "rotationOn", label: "Ligar rotação de telas" },
  { value: "rotationOff", label: "Desligar rotação de telas" },
];

const TEMPLATES: { label: string; make: () => Omit<Schedule, "id">[] }[] = [
  {
    label: "Apagar às 23h e acender às 8h",
    make: () => [
      { enabled: true, time: "23:00", days: [0, 1, 2, 3, 4, 5, 6], action: "lightsOff", target: null },
      { enabled: true, time: "08:00", days: [0, 1, 2, 3, 4, 5, 6], action: "lightsOn", target: null },
    ],
  },
  { label: "Sincronizar relógio todo dia 9h", make: () => [{ enabled: true, time: "09:00", days: [0, 1, 2, 3, 4, 5, 6], action: "sync", target: null }] },
];

export function AutomationPage() {
  const { settings, updateSettings, toast, galleryVersion } = useApp();
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [shortcuts, setShortcuts] = useState<[string, string][]>([]);

  useEffect(() => {
    api.galleryList().then(setItems).catch(() => undefined);
  }, [galleryVersion]);
  useEffect(() => {
    api.shortcutList().then(setShortcuts).catch(() => undefined);
  }, []);

  const [procs, setProcs] = useState<string[]>([]);
  const [activeRule, setActiveRule] = useState<string | null>(null);
  useEffect(() => {
    api3.listProcesses().then(setProcs).catch(() => undefined);
    api3.activeRule().then(setActiveRule).catch(() => undefined);
    const off = onActiveRule(setActiveRule);
    return () => void off.then((f) => f());
  }, []);

  if (!settings) return null;
  const rules = settings.appRules;
  const saveRules = (list: AppRule[]) => updateSettings({ appRules: list });
  const patchRule = (id: string, p: Partial<AppRule>) => saveRules(rules.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const moveRule = (i: number, d: number) => {
    const l = [...rules];
    const j = i + d;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    saveRules(l);
  };
  const schedules = settings.schedules;
  const profiles = settings.profiles;
  const save = (list: Schedule[]) => updateSettings({ schedules: list });
  const patch = (id: string, p: Partial<Schedule>) => save(schedules.map((s) => (s.id === id ? { ...s, ...p } : s)));

  const add = () => save([...schedules, { id: uid(), enabled: true, time: "20:00", days: [0, 1, 2, 3, 4, 5, 6], action: "screen", target: items[0]?.id ?? null }]);

  const test = async (s: Schedule) => {
    try {
      toast("ok", await api.runSchedule(s.action, s.target));
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  const sorted = [...schedules].sort((a, b) => a.time.localeCompare(b.time));

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Automação</h1>
          <p className="muted">Ações por horário e atalhos de teclado que funcionam em qualquer programa.</p>
        </div>
      </header>

      <div className="system-grid">
        <Card
          className="span-2"
          title="Agendador"
          subtitle="Roda enquanto o AK820 Studio estiver aberto (pode ficar na bandeja). Telas novas regravam a tela do teclado."
          actions={
            <button className="btn sm primary" onClick={add}>
              <Icon name="plus" size={15} /> Novo horário
            </button>
          }
        >
          {schedules.length === 0 && (
            <div className="empty small-empty">
              <p className="muted">Nenhum horário ainda. Comece com um modelo:</p>
              <div className="chips">
                {TEMPLATES.map((t) => (
                  <button key={t.label} className="chip" onClick={() => save([...schedules, ...t.make().map((s) => ({ ...s, id: uid() }))])}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="schedule-list">
            {sorted.map((s) => {
              const needsScreen = s.action === "screen";
              const needsProfile = s.action === "profile";
              const missing = (needsScreen && !items.some((i) => i.id === s.target)) || (needsProfile && !profiles.some((p) => p.id === s.target));
              return (
                <div key={s.id} className={`schedule ${s.enabled ? "" : "off"}`}>
                  <input type="time" className="input time" value={s.time} onChange={(e) => e.target.value && patch(s.id, { time: e.target.value })} />
                  <div className="days">
                    {DAYS.map((d, i) => (
                      <button
                        key={d}
                        className={`day ${s.days.includes(i) ? "on" : ""}`}
                        onClick={() => patch(s.id, { days: s.days.includes(i) ? s.days.filter((x) => x !== i) : [...s.days, i].sort() })}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <Select value={s.action} options={ACTIONS} onChange={(action) => patch(s.id, { action, target: action === "screen" ? items[0]?.id ?? null : action === "profile" ? profiles[0]?.id ?? null : null })} />
                  {needsScreen && <Select value={s.target ?? ""} options={[{ value: "", label: "Escolha a tela…" }, ...items.map((i) => ({ value: i.id, label: i.name }))]} onChange={(target) => patch(s.id, { target: target || null })} />}
                  {needsProfile && <Select value={s.target ?? ""} options={[{ value: "", label: "Escolha o perfil…" }, ...profiles.map((p) => ({ value: p.id, label: p.name }))]} onChange={(target) => patch(s.id, { target: target || null })} />}
                  {!needsScreen && !needsProfile && <span />}
                  <div className="schedule-actions">
                    {missing && <span className="warn small">Escolha um item</span>}
                    <button className="btn sm ghost" title="Executar agora" onClick={() => test(s)}>
                      <Icon name="play" size={14} /> Testar
                    </button>
                    <Toggle label="" checked={s.enabled} onChange={(enabled) => patch(s.id, { enabled })} />
                    <button className="btn icon sm ghost" title="Excluir" onClick={() => save(schedules.filter((x) => x.id !== s.id))}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card
          className="span-2"
          title="Perfis por aplicativo"
          subtitle="Quando um programa abrir, o teclado muda sozinho; quando fechar, volta ao que estava. A primeira regra da lista tem prioridade."
          actions={
            <>
              <Toggle label="" checked={settings.appRulesEnabled} onChange={(appRulesEnabled) => updateSettings({ appRulesEnabled })} />
              <button className="btn sm primary" onClick={() => saveRules([...rules, { id: uid(), enabled: true, process: "", action: profiles.length ? "profile" : "lightsOff", target: profiles[0]?.id ?? null }])}>
                <Icon name="plus" size={15} /> Nova regra
              </button>
            </>
          }
        >
          {rules.length === 0 && <p className="small muted">Exemplo: quando “valorant.exe” abrir, aplicar o perfil “Jogo”; quando “obs64.exe” abrir, trocar a tela para “Ao vivo”.</p>}
          <datalist id="procs">
            {procs.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <div className={`schedule-list ${settings.appRulesEnabled ? "" : "dim"}`}>
            {rules.map((r, i) => (
              <div key={r.id} className={`rule ${r.enabled ? "" : "off"} ${activeRule === r.id ? "active" : ""}`}>
                <Icon name="app" />
                <input className="input" list="procs" placeholder="programa.exe" value={r.process} onChange={(e) => patchRule(r.id, { process: e.target.value })} />
                <Select
                  value={r.action}
                  onChange={(action) => patchRule(r.id, { action, target: action === "profile" ? profiles[0]?.id ?? null : action === "screen" ? items[0]?.id ?? null : null })}
                  options={[
                    { value: "profile", label: "Aplicar perfil de luz" },
                    { value: "screen", label: "Trocar a tela" },
                    { value: "stream", label: "Ligar o RGB do PC" },
                    { value: "lightsOff", label: "Apagar as luzes" },
                  ]}
                />
                {r.action === "profile" ? (
                  <Select value={r.target ?? ""} options={[{ value: "", label: "Escolha o perfil…" }, ...profiles.map((p) => ({ value: p.id, label: p.name }))]} onChange={(target) => patchRule(r.id, { target: target || null })} />
                ) : r.action === "screen" ? (
                  <Select value={r.target ?? ""} options={[{ value: "", label: "Escolha a tela…" }, ...items.map((it) => ({ value: it.id, label: it.name }))]} onChange={(target) => patchRule(r.id, { target: target || null })} />
                ) : (
                  <span className="small muted">{r.action === "stream" ? "Usa o último RGB do PC configurado" : ""}</span>
                )}
                <div className="schedule-actions">
                  {activeRule === r.id && <span className="badge-on">Ativa</span>}
                  <button className="btn icon sm ghost" title="Subir prioridade" disabled={i === 0} onClick={() => moveRule(i, -1)}>
                    ↑
                  </button>
                  <Toggle label="" checked={r.enabled} onChange={(enabled) => patchRule(r.id, { enabled })} />
                  <button className="btn icon sm ghost" title="Excluir" onClick={() => saveRules(rules.filter((x) => x.id !== r.id))}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {!profiles.length && <p className="small muted">Dica: crie perfis de luz na aba Iluminação para usar aqui.</p>}
        </Card>

        <Card title="Atalhos globais" subtitle="Funcionam mesmo com o app minimizado." actions={<Toggle label="" checked={settings.shortcutsEnabled} onChange={(shortcutsEnabled) => updateSettings({ shortcutsEnabled })} />}>
          <table className={`table ${settings.shortcutsEnabled ? "" : "dim"}`}>
            <tbody>
              {shortcuts.map(([k, d]) => (
                <tr key={k}>
                  <td>
                    <kbd>{k}</kbd>
                  </td>
                  <td>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">“Próxima tela” usa os favoritos da galeria (ou todos, se não houver favoritos).</p>
        </Card>

        <Card title="Bandeja do Windows" subtitle="Clique com o botão direito no ícone perto do relógio do Windows.">
          <ul className="tips small muted">
            <li>Trocar a tela entre os favoritos da galeria</li>
            <li>Aplicar qualquer perfil de luz</li>
            <li>Ligar/desligar as luzes e o RGB do PC</li>
            <li>Sincronizar o relógio na hora</li>
          </ul>
          <Toggle label="Fechar para a bandeja" hint="O X esconde a janela em vez de sair" checked={settings.minimizeToTray} onChange={(minimizeToTray) => updateSettings({ minimizeToTray })} />
          <Toggle label="Iniciar com o Windows" hint="Abre minimizado para o agendador e os atalhos funcionarem" checked={settings.startWithWindows} onChange={(startWithWindows) => updateSettings({ startWithWindows })} />
        </Card>
      </div>
    </div>
  );
}
