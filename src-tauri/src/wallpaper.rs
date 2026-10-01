//! Papel de parede do Windows e do Wallpaper Engine.

use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperInfo {
    /// "windows" | "engine"
    pub source: String,
    pub title: String,
    pub path: String,
    /// Extensão provável ("jpg", "png", "gif"...), para o navegador decodificar.
    pub ext: String,
    pub stamp: u64,
}

fn mtime(p: &Path) -> u64 {
    fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0)
}

fn sniff_ext(bytes: &[u8]) -> &'static str {
    match bytes {
        [0xFF, 0xD8, ..] => "jpg",
        [0x89, b'P', b'N', b'G', ..] => "png",
        [b'G', b'I', b'F', ..] => "gif",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "webp",
        [b'B', b'M', ..] => "bmp",
        _ => "jpg",
    }
}

// ------------------------------------------------------------------ Windows

/// Caminho do papel de parede atual do Windows (cópia que o próprio Windows mantém).
pub fn windows_path() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    let themes = PathBuf::from(appdata).join("Microsoft").join("Windows").join("Themes");
    let transcoded = themes.join("TranscodedWallpaper");
    if transcoded.is_file() {
        return Some(transcoded);
    }
    // Alguns Windows guardam em CachedFiles
    fs::read_dir(themes.join("CachedFiles")).ok()?.flatten().map(|e| e.path()).find(|p| p.is_file())
}

pub fn windows_info() -> Result<WallpaperInfo, String> {
    let p = windows_path().ok_or("não encontrei o papel de parede do Windows")?;
    let head = fs::read(&p).map_err(|e| e.to_string())?;
    Ok(WallpaperInfo {
        source: "windows".into(),
        title: "Papel de parede do Windows".into(),
        ext: sniff_ext(&head).into(),
        stamp: mtime(&p),
        path: p.to_string_lossy().into_owned(),
    })
}

// ------------------------------------------------------------------ Wallpaper Engine

fn steam_roots() -> Vec<PathBuf> {
    let mut roots = vec![];
    for var in ["ProgramFiles(x86)", "ProgramFiles"] {
        if let Some(p) = std::env::var_os(var) {
            roots.push(PathBuf::from(p).join("Steam"));
        }
    }
    roots.push(PathBuf::from(r"C:\Program Files (x86)\Steam"));
    roots.dedup();
    roots
}

/// Lê os caminhos de bibliotecas do Steam em libraryfolders.vdf.
pub fn parse_library_folders(vdf: &str) -> Vec<PathBuf> {
    vdf.lines()
        .filter_map(|l| {
            let t = l.trim();
            let rest = t.strip_prefix("\"path\"")?.trim();
            let v = rest.trim_matches('"');
            Some(PathBuf::from(v.replace("\\\\", "\\")))
        })
        .collect()
}

pub fn engine_config_path() -> Option<PathBuf> {
    let mut libs = vec![];
    for root in steam_roots() {
        libs.push(root.clone());
        if let Ok(vdf) = fs::read_to_string(root.join("steamapps").join("libraryfolders.vdf")) {
            libs.extend(parse_library_folders(&vdf));
        }
    }
    for drive in ['C', 'D', 'E', 'F'] {
        libs.push(PathBuf::from(format!(r"{drive}:\SteamLibrary")));
    }
    libs.into_iter()
        .map(|l| l.join("steamapps").join("common").join("wallpaper_engine").join("config.json"))
        .find(|p| p.is_file())
}

/// Wallpapers ativos por monitor, na ordem `Monitor0, Monitor1...`.
///
/// O caminho certo é `<usuário>.general.wallpaperconfig.selectedwallpapers`.
/// O config.json também guarda `profiles[]` e `wallpaperconfigrecent[]` com
/// `selectedwallpapers` antigos, que precisam ser ignorados.
pub fn selected_monitors(cfg: &Value) -> Vec<(String, String)> {
    fn entries(sel: &Value) -> Vec<(String, String)> {
        let Some(m) = sel.as_object() else { return vec![] };
        let mut v: Vec<(String, String)> = m
            .iter()
            .filter_map(|(k, x)| x.get("file").and_then(Value::as_str).filter(|f| !f.is_empty()).map(|f| (k.clone(), f.to_string())))
            .collect();
        v.sort_by(|a, b| a.0.cmp(&b.0));
        v
    }
    if let Some(root) = cfg.as_object() {
        for (user, val) in root {
            if user.starts_with('?') {
                continue;
            }
            if let Some(sel) = val.pointer("/general/wallpaperconfig/selectedwallpapers") {
                let e = entries(sel);
                if !e.is_empty() {
                    return e;
                }
            }
        }
    }
    // Formatos antigos: procura em qualquer lugar, menos nos perfis e no histórico.
    fn search(v: &Value) -> Vec<(String, String)> {
        match v {
            Value::Object(m) => {
                if let Some(sel) = m.get("selectedwallpapers") {
                    let e = entries(sel);
                    if !e.is_empty() {
                        return e;
                    }
                }
                for (k, x) in m {
                    if k == "profiles" || k.starts_with("wallpaperconfigrecent") {
                        continue;
                    }
                    let e = search(x);
                    if !e.is_empty() {
                        return e;
                    }
                }
                vec![]
            }
            _ => vec![],
        }
    }
    search(cfg)
}

/// Arquivo do wallpaper do monitor pedido (ou do primeiro).
pub fn selected_from_config(cfg: &Value, monitor: Option<&str>) -> Option<(String, String)> {
    let list = selected_monitors(cfg);
    monitor
        .and_then(|m| list.iter().find(|(k, _)| k == m).cloned())
        .or_else(|| list.into_iter().next())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineMonitor {
    pub key: String,
    pub title: String,
}

fn read_cfg() -> Result<(PathBuf, Value), String> {
    let cfg_path = engine_config_path().ok_or("não encontrei o Wallpaper Engine (config.json) nas bibliotecas do Steam")?;
    let cfg: Value = serde_json::from_str(&fs::read_to_string(&cfg_path).map_err(|e| e.to_string())?).map_err(|e| format!("config.json do Wallpaper Engine inválido: {e}"))?;
    Ok((cfg_path, cfg))
}

fn wallpaper_dir(file: &str) -> Option<PathBuf> {
    let file = PathBuf::from(file.replace('/', "\\"));
    if file.is_dir() {
        Some(file)
    } else {
        file.parent().map(Path::to_path_buf)
    }
}

fn project_of(dir: &Path) -> Option<Value> {
    fs::read_to_string(dir.join("project.json")).ok().and_then(|s| serde_json::from_str(&s).ok())
}

pub fn engine_monitors() -> Result<Vec<EngineMonitor>, String> {
    let (_, cfg) = read_cfg()?;
    Ok(selected_monitors(&cfg)
        .into_iter()
        .map(|(key, file)| {
            let title = wallpaper_dir(&file)
                .and_then(|d| project_of(&d))
                .and_then(|p| p.get("title").and_then(Value::as_str).map(str::to_string))
                .unwrap_or_else(|| file.rsplit(['/', '\\']).next().unwrap_or("").to_string());
            EngineMonitor { key, title }
        })
        .collect())
}

pub fn engine_info(monitor: Option<&str>) -> Result<WallpaperInfo, String> {
    let (_, cfg) = read_cfg()?;
    let (_, file) = selected_from_config(&cfg, monitor).ok_or("não achei o wallpaper selecionado no Wallpaper Engine")?;
    let dir = wallpaper_dir(&file).ok_or("caminho do wallpaper inválido")?;
    let project = project_of(&dir);
    let title = project.as_ref().and_then(|p| p.get("title")).and_then(Value::as_str).unwrap_or("Wallpaper Engine").to_string();
    let mut previews: Vec<PathBuf> = vec![];
    if let Some(p) = project.as_ref().and_then(|p| p.get("preview")).and_then(Value::as_str) {
        previews.push(dir.join(p));
    }
    for name in ["preview.gif", "preview.jpg", "preview.png", "preview.webp"] {
        previews.push(dir.join(name));
    }
    let preview = previews.into_iter().find(|p| p.is_file()).ok_or("esse wallpaper não tem imagem de prévia")?;
    let head = fs::read(&preview).map_err(|e| e.to_string())?;
    Ok(WallpaperInfo {
        source: "engine".into(),
        title,
        ext: sniff_ext(&head).into(),
        stamp: hash(&file),
        path: preview.to_string_lossy().into_owned(),
    })
}

fn hash(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

/// Carimbo usado para detectar troca de wallpaper. No Wallpaper Engine é o
/// arquivo selecionado (o config.json muda por vários outros motivos).
pub fn stamp(source: &str, monitor: Option<&str>) -> u64 {
    match source {
        "windows" => windows_path().map(|p| mtime(&p)).unwrap_or(0),
        "engine" => read_cfg().ok().and_then(|(_, c)| selected_from_config(&c, monitor)).map(|(_, f)| hash(&f)).unwrap_or(0),
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn library_folders() {
        let vdf = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"C:\\\\Program Files (x86)\\\\Steam\"\n\t}\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"D:\\\\SteamLibrary\"\n\t}\n}";
        let libs = parse_library_folders(vdf);
        assert_eq!(libs, vec![PathBuf::from(r"C:\Program Files (x86)\Steam"), PathBuf::from(r"D:\SteamLibrary")]);
    }

    #[test]
    fn engine_selected_ignores_profiles_and_recent() {
        // Mesma estrutura do config.json real: "profiles" vem antes de "wallpaperconfig".
        let cfg: Value = serde_json::json!({
            "?installdirectory": "D:/SteamLibrary/steamapps/common/wallpaper_engine",
            "kaual": { "general": {
                "profiles": [ { "selectedwallpapers": { "Monitor0": { "file": "D:/w/3005242075/scene.pkg" } } } ],
                "wallpaperconfig": { "selectedwallpapers": {
                    "Monitor1": { "file": "D:/w/3366153335/scene.pkg" },
                    "Monitor0": { "file": "D:/w/3796026374/scene.pkg" }
                }},
                "wallpaperconfigrecent": [ { "config": { "selectedwallpapers": { "Monitor0": { "file": "D:/w/3768903841/scene.pkg" } } } } ]
            }}
        });
        assert_eq!(selected_from_config(&cfg, None).unwrap().1, "D:/w/3796026374/scene.pkg");
        assert_eq!(selected_from_config(&cfg, Some("Monitor1")).unwrap().1, "D:/w/3366153335/scene.pkg");
        assert_eq!(selected_from_config(&cfg, Some("Monitor9")).unwrap().1, "D:/w/3796026374/scene.pkg");
        assert_eq!(selected_monitors(&cfg).len(), 2);
    }

    #[test]
    fn real_config_if_present() {
        // Usa uma cópia do config.json real, se existir no ambiente de teste.
        if let Ok(s) = fs::read_to_string("/mnt/user-data/uploads/wallpaper_engine/config.json") {
            let cfg: Value = serde_json::from_str(&s).unwrap();
            let (k, f) = selected_from_config(&cfg, None).unwrap();
            assert_eq!(k, "Monitor0");
            assert!(f.contains("3796026374"), "{f}");
        }
    }

    #[test]
    fn sniff() {
        assert_eq!(sniff_ext(&[0xFF, 0xD8, 0]), "jpg");
        assert_eq!(sniff_ext(b"GIF89a"), "gif");
        assert_eq!(sniff_ext(b"\x89PNG"), "png");
    }
}
