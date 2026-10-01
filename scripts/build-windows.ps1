# Compila o AK820 Studio no Windows.
# Uso (PowerShell, na pasta do projeto):  powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

function Have($cmd) { $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue) }

Write-Host "== Verificando ferramentas ==" -ForegroundColor Cyan
if (-not (Have node)) {
    Write-Host "Instalando Node.js LTS..."
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
}
if (-not (Have cargo)) {
    Write-Host "Instalando Rust..."
    winget install -e --id Rustlang.Rustup --accept-source-agreements --accept-package-agreements
}
# Compilador C++ da Microsoft (necessário para o Rust no Windows)
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasVC = (Test-Path $vswhere) -and (& $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
if (-not $hasVC) {
    Write-Host "Instalando Visual Studio Build Tools (C++)... isso demora alguns minutos."
    winget install -e --id Microsoft.VisualStudio.2022.BuildTools --accept-source-agreements --accept-package-agreements `
        --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
}

# Recarrega o PATH caso algo tenha sido instalado agora
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User") + ";$env:USERPROFILE\.cargo\bin"

Write-Host "== Instalando dependências ==" -ForegroundColor Cyan
npm ci
if ($LASTEXITCODE -ne 0) { npm install }

Write-Host "== Compilando (a primeira vez leva uns 5-10 min) ==" -ForegroundColor Cyan
npm run tauri build
if ($LASTEXITCODE -ne 0) { throw "Falha no build" }

$exe = Get-ChildItem target\release\bundle\nsis\*.exe | Select-Object -First 1
Write-Host ""
Write-Host "Pronto! Instalador: $($exe.FullName)" -ForegroundColor Green
explorer.exe /select,"$($exe.FullName)"
