# OneAI Worker 開機自啟 — 以系統管理員執行此腳本
# 用法（PowerShell）:
#   cd C:\Users\b1993\.cursor\projects\empty-window
#   .\INSTALL-WORKER.ps1

$RepoRoot = $PSScriptRoot
$Script   = Join-Path $RepoRoot "hands\antigravity\scripts\install-worker-task.ps1"

if (-not (Test-Path $Script)) {
    Write-Error "找不到 $Script"
    exit 1
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $isAdmin) {
    Write-Host "[OneAI] 需要系統管理員權限，正在提升…" -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", $Script
    )
    exit 0
}

Set-ExecutionPolicy Bypass -Scope Process -Force
& $Script
