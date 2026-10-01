//! "Tocando agora": lê a música atual do Windows (Spotify, YouTube no navegador,
//! Apple Music, etc.) pela API de controle de mídia do sistema (SMTC).
//!
//! Usa um processo do PowerShell em segundo plano que imprime uma linha JSON
//! cada vez que a música muda, assim não precisamos de bindings WinRT.

use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub app: String,
    pub playing: bool,
    /// Caminho temporário da capa do álbum (vazio se não houver).
    pub thumb: String,
}

const SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
if (-not $mgr) { [Console]::WriteLine('{"error":"smtc"}'); exit 1 }
$last = '#'
$thumbs = @{}
while ($true) {
  $out = [ordered]@{ title = ''; artist = ''; album = ''; app = ''; playing = $false; thumb = '' }
  $key = ''
  $s = $mgr.GetCurrentSession()
  if ($s) {
    $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    if ($p) {
      $out.title = [string]$p.Title
      $out.artist = [string]$p.Artist
      $out.album = [string]$p.AlbumTitle
    }
    $out.app = [string]$s.SourceAppUserModelId
    $info = $s.GetPlaybackInfo()
    if ($info) { $out.playing = ([string]$info.PlaybackStatus -eq 'Playing') }
    $song = "$($out.title)|$($out.artist)"
    if ($p -and $p.Thumbnail -and $out.title) {
      if ($thumbs.ContainsKey($song)) { $out.thumb = $thumbs[$song] }
      else {
        try {
          $stream = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
          $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
          $file = Join-Path $env:TEMP ('ak820-capa-' + [Math]::Abs($song.GetHashCode()) + '.img')
          $fs = [System.IO.File]::Create($file); $net.CopyTo($fs); $fs.Close(); $net.Close()
          $thumbs[$song] = $file
          $out.thumb = $file
        } catch {}
      }
    }
    $key = "$song|$($out.playing)|$($out.thumb)"
  }
  if ($key -ne $last) {
    $last = $key
    [Console]::WriteLine(($out | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
  }
  Start-Sleep -Milliseconds 1200
}
"#;

fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

fn spawn_powershell() -> std::io::Result<Child> {
    let utf16: Vec<u8> = SCRIPT.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &base64(&utf16)])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.spawn()
}

/// Liga/desliga o monitor de mídia.
pub fn set_enabled(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut child = state.media_child.lock().unwrap();
    if let Some(mut c) = child.take() {
        let _ = c.kill();
    }
    *state.media_enabled.lock().unwrap() = enabled;
    if !enabled {
        *state.now_playing.lock().unwrap() = None;
        let _ = app.emit("now-playing", Option::<NowPlaying>::None);
        return Ok(());
    }
    if !cfg!(windows) {
        return Err("“Tocando agora” só funciona no Windows".into());
    }
    let mut c = spawn_powershell().map_err(|e| format!("não foi possível iniciar o PowerShell: {e}"))?;
    let stdout = c.stdout.take().ok_or("sem saída do PowerShell")?;
    let pid = c.id();
    *child = Some(c);
    drop(child);

    let app = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if line.contains("\"error\"") {
                crate::state::log(&app, "error", "O Windows não liberou as informações de mídia (SMTC)");
                continue;
            }
            if let Ok(np) = serde_json::from_str::<NowPlaying>(line) {
                let st = app.state::<AppState>();
                let np = if np.title.is_empty() { None } else { Some(np) };
                *st.now_playing.lock().unwrap() = np.clone();
                let _ = app.emit("now-playing", np);
            }
        }
        // O processo terminou: tenta de novo se ainda estiver ligado e for o mesmo processo.
        thread::sleep(Duration::from_secs(5));
        let st = app.state::<AppState>();
        let same = st.media_child.lock().unwrap().as_ref().map(|c| c.id() == pid).unwrap_or(false);
        if same && *st.media_enabled.lock().unwrap() {
            let _ = set_enabled(&app, true);
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::base64;

    #[test]
    fn base64_matches_reference() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }
}
