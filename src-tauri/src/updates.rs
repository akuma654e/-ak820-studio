//! Atualização a partir do código-fonte no GitHub.
//!
//! O app é compilado no próprio PC a partir de um clone do repositório
//! (scripts\update.ps1). Na compilação ficam gravados o commit, o repositório
//! e a pasta do código. A interface compara esse commit com o último do GitHub
//! e, se houver novidade, este módulo abre o update.ps1, que faz `git pull`,
//! compila, fecha o app, troca o executável e abre de novo.

use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;
use tauri::AppHandle;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    pub version: String,
    pub commit: String,
    /// "usuario/repositorio" (vazio se o código não veio de um clone do GitHub)
    pub repo: String,
    pub branch: String,
    pub source_dir: String,
    /// true se a pasta do código ainda existe e tem o script de atualização
    pub can_update: bool,
}

fn script() -> PathBuf {
    PathBuf::from(env!("AK820_SOURCE_DIR")).join("scripts").join("update.ps1")
}

pub fn info(app: &AppHandle) -> BuildInfo {
    BuildInfo {
        version: app.package_info().version.to_string(),
        commit: env!("AK820_GIT_COMMIT").to_string(),
        repo: env!("AK820_GIT_REPO").to_string(),
        branch: env!("AK820_GIT_BRANCH").to_string(),
        source_dir: env!("AK820_SOURCE_DIR").to_string(),
        can_update: script().is_file(),
    }
}

pub fn run(_app: &AppHandle) -> Result<(), String> {
    let s = script();
    if !s.is_file() {
        return Err(format!("não encontrei {} — a pasta do código foi movida? Rode o update.ps1 na nova pasta.", s.display()));
    }
    // Janela visível do PowerShell para acompanhar o git pull e a compilação.
    // O script fecha o app só no final, para trocar o executável.
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&s)
        .arg("-FromApp")
        .current_dir(env!("AK820_SOURCE_DIR"));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0000_0010); // CREATE_NEW_CONSOLE
    }
    cmd.spawn().map(|_| ()).map_err(|e| format!("não consegui abrir o PowerShell: {e}"))
}
