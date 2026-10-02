# Envia as mudanças do código para o GitHub. Quem tiver o AK820 Studio
# instalado por clone recebe o aviso "Atualização disponível" no app.
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Message "Ambilight por janela" -Version 0.4.0

param(
    [string]$Message = "",
    [string]$Version = ""
)

$ErrorActionPreference = "Continue"
Set-Location (Split-Path $PSScriptRoot -Parent)
$utf8 = New-Object System.Text.UTF8Encoding $false
function ReadText($p) { [System.IO.File]::ReadAllText((Join-Path (Get-Location) $p), $utf8) }
function WriteText($p, $t) { [System.IO.File]::WriteAllText((Join-Path (Get-Location) $p), $t, $utf8) }

if (-not (Test-Path .git)) { throw "Esta pasta não é um clone do GitHub. Use: gh repo clone akuma654e/-ak820-studio" }

$changes = git status --porcelain
if (-not $changes) {
    Write-Host "Nada mudou desde o último envio." -ForegroundColor Yellow
    exit 0
}
Write-Host "Arquivos alterados:" -ForegroundColor Cyan
git status --short

$current = (ReadText "package.json" | ConvertFrom-Json).version
if (-not $Version) {
    $Version = (Read-Host "Versão atual: $current. Nova versão (Enter para manter)").Trim().TrimStart("v")
}
if ($Version -and $Version -ne $current) {
    if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Versão inválida: $Version (use 1.2.3)" }
    WriteText "package.json" ((ReadText "package.json") -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`"")
    WriteText "src-tauri/tauri.conf.json" ((ReadText "src-tauri/tauri.conf.json") -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`"")
    $cargo = ReadText "src-tauri/Cargo.toml"
    WriteText "src-tauri/Cargo.toml" (([regex]'(?m)^version = "[^"]+"').Replace($cargo, "version = `"$Version`"", 1))
} else {
    $Version = $current
}

if (-not $Message) { $Message = (Read-Host "O que mudou? (vira a mensagem da atualização)").Trim() }
if (-not $Message) { $Message = "Melhorias e correções" }

# Histórico de mudanças
$entry = "`n## $Version - $(Get-Date -Format 'yyyy-MM-dd')`n- $Message`n"
$old = if (Test-Path CHANGELOG.md) { (ReadText "CHANGELOG.md") -replace '^# Mudanças\s*', '' } else { "" }
WriteText "CHANGELOG.md" ("# Mudanças`n" + $entry + "`n" + $old)

git add -A
git commit -m $Message | Out-Null
git push
if ($LASTEXITCODE -ne 0) { throw "Falha ao enviar para o GitHub (rode 'git pull' e tente de novo)." }

Write-Host ""
Write-Host "Enviado! O app vai avisar 'Atualização disponível' na próxima vez que procurar." -ForegroundColor Green
