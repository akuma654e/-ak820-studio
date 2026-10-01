fn main() {
    // Gravados no programa pelo GitHub Actions para a atualização automática.
    println!("cargo:rerun-if-env-changed=AK820_UPDATE_REPO");
    println!("cargo:rerun-if-env-changed=AK820_UPDATE_PUBKEY");
    tauri_build::build()
}
