# OneAI Cursor Worker — Windows 工作排程器自動啟動
# 以「系統管理員」身分執行。
#   Set-ExecutionPolicy Bypass -Scope Process -Force
#   .\hands\cursor-agent\scripts\install-cursor-worker-task.ps1

param(
    [string]$RepoRoot = (Resolve-Path "$PSScriptRoot\..\..\..").Path,
    [string]$TaskName = "OneAI-CursorWorker",
    [string]$EnvFile  = "$RepoRoot\.env"
)

Write-Host "[OneAI] 安裝 cursor_worker.py 排程任務..." -ForegroundColor Cyan
Write-Host "  RepoRoot : $RepoRoot"
Write-Host "  TaskName : $TaskName"

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $python) {
    Write-Error "找不到 python/python3，請先安裝 Python 3.10+ 並加入 PATH"
    exit 1
}
$pythonExe = $python.Source
Write-Host "  Python   : $pythonExe"

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([A-Z_0-9]+)=(.+)$') {
            $k = $matches[1]; $v = $matches[2].Trim('"').Trim("'")
            [System.Environment]::SetEnvironmentVariable($k, $v, "Process")
        }
    }
    Write-Host "  .env 載入 : $EnvFile"
} else {
    Write-Warning ".env 不存在，CURSOR_API_KEY 等請手動設定"
}

$wrapperPath = "$RepoRoot\hands\cursor-agent\scripts\start-cursor-worker.bat"
$workerPy    = "$RepoRoot\hands\cursor-agent\cursor_worker.py"
$envBlock = @(
    "APPROVAL_BASE_URL",
    "ONEAI_WORKER_TOKEN",
    "CURSOR_API_KEY",
    "CURSOR_AGENT_CWD",
    "CURSOR_AGENT_MODEL",
    "CURSOR_AGENT_ID",
    "CURSOR_AGENT_DISPLAY"
) | ForEach-Object {
    $v = [System.Environment]::GetEnvironmentVariable($_, "Process")
    if ($v) { "SET $_=$v" }
} | Where-Object { $_ }

$bat = @"
@echo off
REM OneAI Cursor Worker — 由 install-cursor-worker-task.ps1 自動產生
REM 手動停止: schtasks /End /TN "$TaskName"
CD /D "$RepoRoot\hands\cursor-agent"
$($envBlock -join "`r`n")
"$pythonExe" -u cursor_worker.py >> "%TEMP%\oneai-cursor-worker.log" 2>&1
"@
Set-Content -Path $wrapperPath -Value $bat -Encoding UTF8
Write-Host "  Wrapper  : $wrapperPath"

if (-not [System.Environment]::GetEnvironmentVariable("CURSOR_API_KEY", "Process")) {
    Write-Warning "CURSOR_API_KEY 未設定 — cursor_worker 啟動後會失敗，請寫入 .env"
}

schtasks /Delete /TN $TaskName /F 2>$null | Out-Null

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>OneAI Cursor worker — 認領 cursor_agent 任務，呼叫 Cursor SDK</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled></LogonTrigger>
  </Triggers>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <RestartOnFailure><Interval>PT1M</Interval><Count>10</Count></RestartOnFailure>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
  </Settings>
  <Actions>
    <Exec>
      <Command>cmd.exe</Command>
      <Arguments>/C "$wrapperPath"</Arguments>
      <WorkingDirectory>$RepoRoot\hands\cursor-agent</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

$xmlPath = "$env:TEMP\oneai-cursor-worker-task.xml"
$xml | Out-File -FilePath $xmlPath -Encoding Unicode
schtasks /Create /TN $TaskName /XML $xmlPath /F
Remove-Item $xmlPath -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "[OneAI] Cursor 排程任務安裝完成！" -ForegroundColor Green
Write-Host "  立即測試 : schtasks /Run /TN $TaskName"
Write-Host "  查看日誌 : notepad $env:TEMP\oneai-cursor-worker.log"
Write-Host "  停止任務 : schtasks /End /TN $TaskName"
Write-Host "  移除任務 : schtasks /Delete /TN $TaskName /F"
