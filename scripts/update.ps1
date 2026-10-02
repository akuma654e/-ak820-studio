# Instala ou atualiza o AK820 Studio a partir do código do GitHub.
#
# Primeira vez:
#   gh repo clone akuma654e/-ak820-studio
#   cd .\-ak820-studio            (o ".\" é necessário porque o nome começa com "-")
#   powershell -ExecutionPolicy Bypass -File scripts\update.ps1
#
# Depois disso o próprio app avisa quando tem novidade no GitHub e roda este
# script sozinho (botão "Atualizar agora").

param(
    [switch]$FromApp,   # chamado pelo botão do app
    [switch]$NoPull     # só recompila o código que já está na pasta
)

$ErrorActionPreference = "Continue"  # git/npm/cargo escrevem avisos no stderr
Set-Location (Split-Path $PSScriptRoot -Parent)
$Host.UI.RawUI.WindowTitle = "AK820 Studio - atualização"

function Have($cmd) { $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue) }
function Step($t) { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Cyan }
function Fail($msg) {
    Write-Host ""
    Write-Host "ERRO: $msg" -ForegroundColor Red
    Read-Host "Aperte Enter para fechar"
    exit 1
}
function RefreshPath {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") + ";$env:USERPROFILE\.cargo\bin"
}

# ------------------------------------------------------------------ ferramentas
Step "Conferindo ferramentas"
if (-not (Have git)) {
    Write-Host "Instalando Git..."
    winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
}
if (-not (Have node)) {
    Write-Host "Instalando Node.js LTS..."
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
}
if (-not (Have cargo)) {
    Write-Host "Instalando Rust..."
    winget install -e --id Rustlang.Rustup --accept-source-agreements --accept-package-agreements
}
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasVC = (Test-Path $vswhere) -and (& $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
if (-not $hasVC) {
    Write-Host "Instalando Visual Studio Build Tools (C++)... isso demora alguns minutos."
    winget install -e --id Microsoft.VisualStudio.2022.BuildTools --accept-source-agreements --accept-package-agreements `
        --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
}
RefreshPath
foreach ($t in "git", "node", "npm", "cargo") { if (-not (Have $t)) { Fail "$t não foi encontrado. Feche e abra o PowerShell e rode de novo." } }

# ------------------------------------------------------------------ código
if (-not $NoPull -and (Test-Path .git)) {
    Step "Baixando a versão mais nova do GitHub"
    $before = (git rev-parse HEAD).Trim()
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Não consegui atualizar automaticamente (você tem mudanças locais?)." -ForegroundColor Yellow
        git status --short
        $ans = Read-Host "Guardar suas mudanças locais (git stash) e tentar de novo? [s/N]"
        if ($ans -match '^[sS]') {
            git stash push -u -m "ak820-update $(Get-Date -Format s)"
            git pull --ff-only
            if ($LASTEXITCODE -ne 0) { Fail "git pull falhou." }
        } else {
            Fail "Atualização cancelada."
        }
    }
    $after = (git rev-parse HEAD).Trim()
    if ($before -eq $after) { Write-Host "Já estava na versão mais nova; recompilando mesmo assim." }
    else { git log --oneline "$before..$after" | Select-Object -First 15 }
}

# ------------------------------------------------------------------ compilar
Step "Instalando dependências"
$stamp = "node_modules\.package-lock.json"
if (-not (Test-Path $stamp) -or (Get-Item package-lock.json).LastWriteTime -gt (Get-Item $stamp).LastWriteTime) {
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { npm install --no-audit --no-fund }
    if ($LASTEXITCODE -ne 0) { Fail "npm não conseguiu instalar as dependências." }
} else {
    Write-Host "Dependências já em dia."
}

Step "Compilando (a primeira vez leva uns 5-10 min; as próximas, 1-2 min)"
npx tauri build --no-bundle
if ($LASTEXITCODE -ne 0) { Fail "A compilação falhou. Copie as mensagens acima e mande para o Claude." }
$built = "target\release\ak820-studio.exe"
if (-not (Test-Path $built)) { Fail "Não encontrei $built depois da compilação." }

# ------------------------------------------------------------------ instalar
Step "Instalando"
$dir = Join-Path $env:LOCALAPPDATA "AK820 Studio"
$exe = Join-Path $dir "ak820-studio.exe"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$running = Get-Process -Name "ak820-studio" -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "Fechando o AK820 Studio..."
    $running | ForEach-Object { $_.CloseMainWindow() | Out-Null }
    Start-Sleep -Seconds 2
    Get-Process -Name "ak820-studio" -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 800
}

$ok = $false
for ($i = 0; $i -lt 10 -and -not $ok; $i++) {
    try { Copy-Item $built $exe -Force -ErrorAction Stop; $ok = $true } catch { Start-Sleep -Seconds 1 }
}
if (-not $ok) { Fail "Não consegui substituir $exe (o app ainda está aberto?)." }

# Atalhos no Menu Iniciar e na Área de Trabalho
$shell = New-Object -ComObject WScript.Shell
$links = @(
    (Join-Path ([Environment]::GetFolderPath("Programs")) "AK820 Studio.lnk"),
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "AK820 Studio.lnk")
)
foreach ($l in $links) {
    $s = $shell.CreateShortcut($l)
    $s.TargetPath = $exe
    $s.WorkingDirectory = $dir
    $s.Description = "AK820 Studio"
    $s.Save()
}

$commit = ""
if (Test-Path .git) { $commit = (git rev-parse --short HEAD).Trim() }
Write-Host ""
Write-Host "Pronto! AK820 Studio instalado em $dir (commit $commit)." -ForegroundColor Green
Start-Process $exe
if ($FromApp) { Start-Sleep -Seconds 4 } else { Read-Host "Aperte Enter para fechar" }
