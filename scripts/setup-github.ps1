# Configura o GitHub para publicar o AK820 Studio com atualização automática.
# Rode UMA vez, na pasta do projeto:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-github.ps1
#
# O que ele faz:
#   1. Cria a chave de assinatura das atualizações (fica só no seu PC).
#   2. Liga a pasta a um repositório do GitHub e envia o código.
#   3. Cadastra a chave no GitHub (automático se o GitHub CLI "gh" estiver instalado).

$ErrorActionPreference = "Continue"  # comandos externos (git, gh) escrevem avisos no stderr
Set-Location (Split-Path $PSScriptRoot -Parent)

function Have($cmd) { $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue) }
function Step($t) { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Cyan }

if (-not (Have git)) { throw "Instale o Git primeiro: winget install Git.Git" }
if (-not (Have npm)) { throw "Instale o Node.js primeiro: winget install OpenJS.NodeJS.LTS" }

# ------------------------------------------------------------------ 1. chave
Step "1/3 Chave de assinatura"
$keyDir = Join-Path $env:USERPROFILE ".tauri"
$key = Join-Path $keyDir "ak820-studio.key"
$pwFile = Join-Path $keyDir "ak820-studio.password.txt"
New-Item -ItemType Directory -Force -Path $keyDir | Out-Null

if (-not (Test-Path node_modules)) { npm install }

if (Test-Path $key) {
    Write-Host "Chave já existe em $key (mantida)."
} else {
    $pw = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
    [System.IO.File]::WriteAllText($pwFile, $pw)
    $env:CI = "true"
    npx tauri signer generate --ci -p $pw -w $key
    if ($LASTEXITCODE -ne 0) { throw "Falha ao gerar a chave" }
    Write-Host "Chave criada em $key" -ForegroundColor Green
}
$pub = (Get-Content "$key.pub" -Raw).Trim()
$priv = (Get-Content $key -Raw).Trim()
$pw = (Get-Content $pwFile -Raw).Trim()
Write-Host "IMPORTANTE: guarde a pasta $keyDir num backup. Sem ela não dá para publicar atualizações." -ForegroundColor Yellow

# ------------------------------------------------------------------ 2. repositório
Step "2/3 Repositório no GitHub"
if (-not (Test-Path .git)) {
    git init -b main | Out-Null
}
$remote = (git config --get remote.origin.url)
if (-not $remote) {
    Write-Host "Crie um repositório PÚBLICO e VAZIO em https://github.com/new (ex.: ak820-studio)."
    Write-Host "Ele precisa ser público para o app conseguir baixar as atualizações."
    Start-Process "https://github.com/new"
    $remote = Read-Host "Cole o endereço do repositório (ex.: https://github.com/seu-usuario/ak820-studio)"
    $remote = $remote.Trim().TrimEnd("/")
    if (-not $remote.EndsWith(".git")) { $remote = "$remote.git" }
    git remote add origin $remote
}
$repo = ($remote -replace '^.*github\.com[:/]', '' -replace '\.git$', '')
Write-Host "Repositório: $repo"

git add -A
$pending = git status --porcelain
if ($pending) { git commit -m "AK820 Studio" | Out-Null }
git branch -M main
git push -u origin main
if ($LASTEXITCODE -ne 0) { throw "Não consegui enviar para o GitHub. Confira se você está logado no Git." }

# ------------------------------------------------------------------ 3. segredos
Step "3/3 Cadastrar a chave no GitHub"
$done = $false
if (Have gh) {
    gh auth status *> $null
    if ($LASTEXITCODE -ne 0) { gh auth login }
    $priv | gh secret set TAURI_SIGNING_PRIVATE_KEY --repo $repo
    $pw | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo $repo
    gh variable set TAURI_SIGNING_PUBLIC_KEY --repo $repo --body $pub
    if ($LASTEXITCODE -eq 0) { $done = $true; Write-Host "Chaves cadastradas pelo GitHub CLI." -ForegroundColor Green }
}
if (-not $done) {
    Write-Host "Vou abrir a página de segredos do repositório. Crie estes 3 itens:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Aba 'Secrets' > New repository secret:"
    Write-Host "    Nome: TAURI_SIGNING_PRIVATE_KEY           Valor: (já copiado, é só colar com Ctrl+V)"
    Write-Host "    Nome: TAURI_SIGNING_PRIVATE_KEY_PASSWORD  Valor: $pw"
    Write-Host "  Aba 'Variables' > New repository variable:"
    Write-Host "    Nome: TAURI_SIGNING_PUBLIC_KEY            Valor: $pub"
    Write-Host ""
    Set-Clipboard -Value $priv
    Start-Process "https://github.com/$repo/settings/secrets/actions"
    Read-Host "Quando terminar, aperte Enter"
}

Write-Host ""
Write-Host "Pronto! Agora publique a primeira versão com:" -ForegroundColor Green
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\release.ps1"
