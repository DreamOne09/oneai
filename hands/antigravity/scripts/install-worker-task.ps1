# OneAI Worker — Windows 工作排程器自動啟動設定
# 以「系統管理員」身分執行此腳本即可完成設定。
# 執行方式(PowerShell 以管理員開啟):
#   Set-ExecutionPolicy Bypass -Scope Process -Force
#   .\hands\antigravity\scripts\install-worker-task.ps1

param(
    [string]$RepoRoot = (Resolve-Path "$PSScriptRoot\..\..\..").Path,
    [string]$TaskName = "OneAI-Worker",
    [string]$EnvFile  = "$RepoRoot\.env"
)

Write-Host "[OneAI] 安裝 worker.py 排程任務..." -ForegroundColor Cyan
Write-Host "  RepoRoot : $RepoRoot"
Write-Host "  TaskName : $TaskName"

# ── 確認 python 可用 ─────────────────────────────────────────────────────────
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $python) {
    Write-Error "找不到 python/python3,請先安裝 Python 3.10+ 並加入 PATH"
    exit 1
}
$pythonExe = $python.Source
Write-Host "  Python   : $pythonExe"

# ── 讀取 .env 載入環境變數(只取 worker 需要的幾個)────────────────────────────
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([A-Z_0-9]+)=(.+)$') {
            $k = $matches[1]; $v = $matches[2].Trim('"').Trim("'")
            [System.Environment]::SetEnvironmentVariable($k, $v, "Process")
        }
    }
    Write-Host "  .env 載入 : $EnvFile"
} else {
    Write-Warning ".env 不存在,環境變數請手動設定或直接寫在系統環境變數"
}

# ── 建立 wrapper batch(避免 Task Scheduler 對 python 路徑問題)──────────────
$wrapperPath = "$RepoRoot\hands\antigravity\scripts\start-worker.bat"
$workerPy    = "$RepoRoot\hands\antigravity\worker.py"
$envBlock = @(
    "APPROVAL_BASE_URL",
    "ONEAI_WORKER_TOKEN",
    "APPROVAL_TOKEN",
    "ONEAI_AGENT_ID",
    "ONEAI_AGENT_DISPLAY"
) | ForEach-Object {
    $v = [System.Environment]::GetEnvironmentVariable($_, "Process")
    if ($v) { "SET $_=$v" }
} | Where-Object { $_ }

$bat = @"
@echo off
REM OneAI Worker — 由 install-worker-task.ps1 自動產生
REM 手動停止: schtasks /End /TN "$TaskName"
CD /D "$RepoRoot\hands\antigravity"
$($envBlock -join "`r`n")
"$pythonExe" -u worker.py >> "%TEMP%\oneai-worker.log" 2>&1
"@
Set-Content -Path $wrapperPath -Value $bat -Encoding UTF8
Write-Host "  Wrapper  : $wrapperPath"

# ── 刪除同名舊任務 ────────────────────────────────────────────────────────────
schtasks /Delete /TN $TaskName /F 2>$null | Out-Null

# ── 建立任務(登入時啟動,若失敗 1 分鐘後重試) ─────────────────────────────────
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>OneAI 本機 worker — 連接雲端大腦與本機執行環境</Description>
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
      <WorkingDirectory>$RepoRoot\hands\antigravity</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

$xmlPath = "$env:TEMP\oneai-worker-task.xml"
$xml | Out-File -FilePath $xmlPath -Encoding Unicode
schtasks /Create /TN $TaskName /XML $xmlPath /F
Remove-Item $xmlPath -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "[OneAI] 排程任務安裝完成！" -ForegroundColor Green
Write-Host "  立即測試 : schtasks /Run /TN $TaskName"
Write-Host "  查看日誌 : notepad $env:TEMP\oneai-worker.log"
Write-Host "  停止任務 : schtasks /End /TN $TaskName"
Write-Host "  移除任務 : schtasks /Delete /TN $TaskName /F"
