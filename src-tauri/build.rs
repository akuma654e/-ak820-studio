use std::process::Command;

fn git(args: &[&str]) -> String {
    Command::new("git")
        .args(args)
        .current_dir("..")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

fn main() {
    // Informações do código-fonte gravadas no programa, usadas pela atualização
    // (compara este commit com o último do GitHub e roda scripts\update.ps1).
    let commit = git(&["rev-parse", "HEAD"]);
    let remote = git(&["config", "--get", "remote.origin.url"]);
    let repo = remote
        .split("github.com")
        .nth(1)
        .map(|r| r.trim_start_matches([':', '/']).trim_end_matches(".git").to_string())
        .unwrap_or_default();
    let branch = git(&["rev-parse", "--abbrev-ref", "HEAD"]);
    let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().map(|p| p.display().to_string()).unwrap_or_default();
    println!("cargo:rustc-env=AK820_GIT_COMMIT={commit}");
    println!("cargo:rustc-env=AK820_GIT_REPO={repo}");
    println!("cargo:rustc-env=AK820_GIT_BRANCH={branch}");
    println!("cargo:rustc-env=AK820_SOURCE_DIR={source}");
    for p in ["../.git/HEAD", "../.git/refs/heads", "../.git/packed-refs", "../.git/config", "../.git/logs/HEAD"] {
        println!("cargo:rerun-if-changed={p}");
    }
    tauri_build::build()
}
