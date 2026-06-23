# OneAI 雙 Worker 開機自啟 — 以系統管理員執行
# 安裝：OneAI-Worker（agy/shell）+ OneAI-CursorWorker（Cursor SDK）
#
# 用法：
#   cd C:\Users\b1993\.cursor\projects\empty-window
#   .\INSTALL-WORKERS.ps1

$RepoRoot = $PSScriptRoot
$AgyScript    = Join-Path $RepoRoot "hands\antigravity\scripts\install-worker-task.ps1"
$CursorScript = Join-Path $RepoRoot "hands\cursor-agent\scripts\install-cursor-worker-task.ps1"

foreach ($p in @($AgyScript, $CursorScript)) {
    if (-not (Test-Path $p)) {
        Write-Error "找不到 $p"
        exit 1
    }
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $isAdmin) {
    Write-Host "[OneAI] 需要系統管理員權限，正在提升…" -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", $MyInvocation.MyCommand.Path
    )
    exit 0
}

Set-ExecutionPolicy Bypass -Scope Process -Force
Write-Host "`n=== 1/2 Antigravity worker (shell/agent) ===" -ForegroundColor Cyan
& $AgyScript -RepoRoot $RepoRoot
Write-Host "`n=== 2/2 Cursor worker (cursor_agent) ===" -ForegroundColor Cyan
& $CursorScript -RepoRoot $RepoRoot

Write-Host "`n[OneAI] 兩個 worker 排程已就緒。" -ForegroundColor Green
Write-Host "  驗證 : schtasks /Run /TN OneAI-Worker; schtasks /Run /TN OneAI-CursorWorker"
Write-Host "  日誌 : %TEMP%\oneai-worker.log 、 %TEMP%\oneai-cursor-worker.log"
Write-Host "  API  : GET https://oneai-approval.zeabur.app/agents/status"
