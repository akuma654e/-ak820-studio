//! Perfis por aplicativo: quando um programa abre, aplica uma ação; quando
//! fecha, volta ao que estava antes.

use crate::state::{self, AppState};
use crate::store::AppRule;
use std::collections::HashSet;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};
use tauri::{AppHandle, Emitter, Manager};

pub struct Watcher {
    sys: System,
}

impl Watcher {
    pub fn new() -> Self {
        Self { sys: System::new_with_specifics(RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing())) }
    }

    pub fn running(&mut self) -> HashSet<String> {
        self.sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
        self.sys.processes().values().map(|p| p.name().to_string_lossy().to_lowercase()).collect()
    }
}

pub fn list_processes() -> Vec<String> {
    let mut w = Watcher::new();
    let mut v: Vec<String> = w.running().into_iter().filter(|n| !n.is_empty()).collect();
    v.sort();
    v
}

/// Primeira regra ligada cujo programa está aberto (a ordem da lista é a prioridade).
pub fn matching<'a>(rules: &'a [AppRule], running: &HashSet<String>) -> Option<&'a AppRule> {
    rules.iter().find(|r| {
        let p = r.process.trim().to_lowercase();
        r.enabled && !p.is_empty() && (running.contains(&p) || running.contains(&format!("{p}.exe")))
    })
}

fn apply(app: &AppHandle, rule: &AppRule) -> Result<String, String> {
    let st = app.state::<AppState>();
    match rule.action.as_str() {
        "profile" => {
            let id = rule.target.as_deref().ok_or("nenhum perfil escolhido")?;
            let p = st.settings().profiles.into_iter().find(|p| p.id == id).ok_or("perfil não encontrado")?;
            state::set_stream(app, None);
            state::apply_lighting(app, &p.lighting, false)?;
            Ok(format!("perfil “{}”", p.name))
        }
        "screen" => {
            let id = rule.target.as_deref().ok_or("nenhuma tela escolhida")?;
            state::upload_item(app, id).map(|n| format!("tela “{n}”"))
        }
        "stream" => {
            let cfg = st.settings().stream.ok_or("configure o RGB do PC primeiro")?;
            state::set_stream(app, Some(cfg));
            Ok("RGB do PC".into())
        }
        "lightsOff" => {
            state::set_stream(app, None);
            let base = st.settings().lighting.ok_or("sem iluminação salva")?;
            state::apply_lighting(app, &crate::store::LightingDto { mode: 0, ..base }, false)?;
            Ok("luzes apagadas".into())
        }
        other => Err(format!("ação desconhecida: {other}")),
    }
}

fn restore(app: &AppHandle) -> Result<(), String> {
    let st = app.state::<AppState>();
    let saved = st.rule_restore.lock().unwrap().take();
    let (stream, screen) = saved.unwrap_or((None, None));
    if let Some(l) = st.settings().lighting {
        state::apply_lighting(app, &l, false)?;
    }
    state::set_stream(app, stream);
    if let Some(id) = screen {
        if st.gallery_cursor.lock().unwrap().as_deref() != Some(id.as_str()) {
            let _ = state::upload_item(app, &id);
        }
    }
    Ok(())
}

/// Chamado periodicamente pelo monitor.
pub fn tick(app: &AppHandle, watcher: &mut Watcher) {
    let st = app.state::<AppState>();
    let settings = st.settings();
    if !settings.app_rules_enabled || settings.app_rules.is_empty() {
        if st.active_rule.lock().unwrap().is_some() {
            *st.active_rule.lock().unwrap() = None;
            let _ = restore(app);
        }
        return;
    }
    let running = watcher.running();
    let found = matching(&settings.app_rules, &running).cloned();
    let current = st.active_rule.lock().unwrap().clone();
    if found.as_ref().map(|r| &r.id) == current.as_ref() {
        return;
    }
    match found {
        Some(rule) => {
            if current.is_none() {
                let stream = st.stream.lock().unwrap().clone();
                let screen = st.gallery_cursor.lock().unwrap().clone();
                *st.rule_restore.lock().unwrap() = Some((stream, screen));
            }
            *st.active_rule.lock().unwrap() = Some(rule.id.clone());
            match apply(app, &rule) {
                Ok(what) => state::notify(app, "ok", format!("{} aberto: {what}", rule.process)),
                Err(e) => state::notify(app, "error", format!("Regra de {}: {e}", rule.process)),
            }
        }
        None => {
            *st.active_rule.lock().unwrap() = None;
            match restore(app) {
                Ok(()) => state::log(app, "info", "Programa fechado: iluminação restaurada"),
                Err(e) => state::log(app, "error", format!("Não consegui restaurar: {e}")),
            }
        }
    }
    let _ = app.emit("active-rule", st.active_rule.lock().unwrap().clone());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn match_by_priority_and_exe_suffix() {
        let rules = vec![
            AppRule { id: "a".into(), process: "Valorant".into(), ..Default::default() },
            AppRule { id: "b".into(), process: "spotify.exe".into(), ..Default::default() },
            AppRule { id: "c".into(), process: "obs64.exe".into(), enabled: false, ..Default::default() },
        ];
        let run: HashSet<String> = ["spotify.exe", "valorant.exe", "obs64.exe"].iter().map(|s| s.to_string()).collect();
        assert_eq!(matching(&rules, &run).unwrap().id, "a");
        let run: HashSet<String> = ["obs64.exe"].iter().map(|s| s.to_string()).collect();
        assert!(matching(&rules, &run).is_none());
    }
}
