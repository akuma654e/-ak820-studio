//! Atualização automática pelo GitHub Releases.
//!
//! O repositório e a chave pública de assinatura são gravados no programa
//! durante a compilação feita pelo GitHub Actions (variáveis de ambiente
//! `AK820_UPDATE_REPO` e `AK820_UPDATE_PUBKEY`). Numa compilação local, sem
//! essas variáveis, as atualizações ficam desligadas.

use crate::state::{self, AppState};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

pub const REPO: Option<&str> = option_env!("AK820_UPDATE_REPO");
pub const PUBKEY: Option<&str> = option_env!("AK820_UPDATE_PUBKEY");

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub current: String,
    /// false = compilação local, sem atualização automática.
    pub enabled: bool,
    pub repo: Option<String>,
    pub available: Option<UpdateInfo>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
    pub date: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    downloaded: u64,
    total: Option<u64>,
}

fn configured() -> Option<(&'static str, &'static str)> {
    match (REPO.filter(|r| r.contains('/')), PUBKEY.filter(|k| !k.trim().is_empty())) {
        (Some(r), Some(k)) => Some((r, k)),
        _ => None,
    }
}

fn endpoint(repo: &str) -> String {
    format!("https://github.com/{repo}/releases/latest/download/latest.json")
}

fn updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let (repo, key) = configured().ok_or("atualizações automáticas desligadas nesta compilação local")?;
    let url = endpoint(repo).parse().map_err(|e| format!("endereço de atualização inválido: {e}"))?;
    app.updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .pubkey(key)
        .build()
        .map_err(|e| e.to_string())
}

pub fn current(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

pub async fn check(app: &AppHandle) -> Result<UpdateStatus, String> {
    let cur = current(app);
    let Some((repo, _)) = configured() else {
        return Ok(UpdateStatus { current: cur, enabled: false, repo: None, available: None });
    };
    let upd = updater(app)?.check().await.map_err(|e| format!("não consegui procurar atualizações: {e}"))?;
    let available = upd.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        notes: u.body.clone().unwrap_or_default(),
        date: u.date.map(|d| d.to_string()),
    });
    *app.state::<AppState>().pending_update.lock().unwrap() = upd;
    Ok(UpdateStatus { current: cur, enabled: true, repo: Some(repo.to_string()), available })
}

/// Baixa, instala e reinicia. No Windows o instalador fecha o app sozinho.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let upd = app.state::<AppState>().pending_update.lock().unwrap().take();
    let upd = match upd {
        Some(u) => u,
        None => updater(app)?.check().await.map_err(|e| e.to_string())?.ok_or("nenhuma atualização disponível")?,
    };
    state::log(app, "info", format!("Baixando a versão {}…", upd.version));
    // Para o RGB do PC e o PowerShell antes de o instalador substituir os arquivos.
    state::set_stream(app, None);
    let _ = crate::media::set_enabled(app, false);
    let mut downloaded: u64 = 0;
    let app2 = app.clone();
    upd.download_and_install(
        move |chunk, total| {
            downloaded += chunk as u64;
            let _ = app2.emit("update-progress", DownloadProgress { downloaded, total });
        },
        || {},
    )
    .await
    .map_err(|e| format!("falha ao instalar a atualização: {e}"))?;
    app.restart();
}

/// Procura atualização ao abrir o app (se ligado nas configurações).
pub fn check_on_startup(app: AppHandle) {
    if configured().is_none() || !app.state::<AppState>().settings().auto_update_check {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio_sleep(8).await;
        if let Ok(s) = check(&app).await {
            if let Some(info) = s.available {
                state::log(&app, "info", format!("Nova versão disponível: {}", info.version));
                let _ = app.emit("update-available", info);
            }
        }
    });
}

async fn tokio_sleep(secs: u64) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(std::time::Duration::from_secs(secs))).await;
}

#[cfg(test)]
mod tests {
    #[test]
    fn endpoint_format() {
        assert_eq!(super::endpoint("akuma/ak820-studio"), "https://github.com/akuma/ak820-studio/releases/latest/download/latest.json");
    }
}
