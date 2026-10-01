# Publica uma versão nova do AK820 Studio. O GitHub compila e o app de todo
# mundo se atualiza sozinho.
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 0.4.0 -Notes "Correção do Wallpaper Engine"

param(
    [string]$Version = "",
    [string]$Notes = ""
)

$ErrorActionPreference = "Continue"  # comandos externos (git, gh) escrevem avisos no stderr
Set-Location (Split-Path $PSScriptRoot -Parent)
$utf8 = New-Object System.Text.UTF8Encoding $false

function ReadText($p) { [System.IO.File]::ReadAllText((Resolve-Path $p), $utf8) }
function WriteText($p, $t) { [System.IO.File]::WriteAllText((Join-Path (Get-Location) $p), $t, $utf8) }

if (-not (Test-Path .git)) { throw "Rode primeiro scripts\setup-github.ps1" }

$current = (ReadText "package.json" | ConvertFrom-Json).version
if (-not $Version) {
    $p = $current.Split(".")
    $suggest = "$($p[0]).$($p[1]).$([int]$p[2] + 1)"
    $answer = Read-Host "Versão atual: $current. Nova versão [$suggest]"
    $Version = if ($answer) { $answer.Trim().TrimStart("v") } else { $suggest }
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Versão inválida: $Version (use o formato 1.2.3)" }
if ([version]$Version -le [version]$current) { throw "A nova versão ($Version) precisa ser maior que a atual ($current)" }

if (-not $Notes) {
    Write-Host "O que mudou nesta versão? (uma linha por item; linha vazia termina)"
    $lines = @()
    while ($true) {
        $l = Read-Host "-"
        if (-not $l) { break }
        $lines += "- $l"
    }
    $Notes = if ($lines.Count) { $lines -join "`n" } else { "Melhorias e correções." }
}
WriteText "release-notes.md" "$Notes`n"

# Atualiza a versão nos três arquivos
WriteText "package.json" ((ReadText "package.json") -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`"")
WriteText "src-tauri/tauri.conf.json" ((ReadText "src-tauri/tauri.conf.json") -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`"")
$cargo = ReadText "src-tauri/Cargo.toml"
$cargo = ([regex]'(?m)^version = "[^"]+"').Replace($cargo, "version = `"$Version`"", 1)
WriteText "src-tauri/Cargo.toml" $cargo

git add -A
git commit -m "v$Version" | Out-Null
git tag "v$Version"
git push origin HEAD
git push origin "v$Version"
if ($LASTEXITCODE -ne 0) { throw "Falha ao enviar para o GitHub" }

$repo = ((git config --get remote.origin.url) -replace '^.*github\.com[:/]', '' -replace '\.git$', '')
Write-Host ""
Write-Host "Versão $Version enviada! O GitHub está compilando (uns 10-15 minutos)." -ForegroundColor Green
Write-Host "Acompanhe em: https://github.com/$repo/actions"
Write-Host "Quando terminar, o AK820 Studio avisa que tem atualização."
Start-Process "https://github.com/$repo/actions"
