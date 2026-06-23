# ============================================================
# OneAI — approval-svc 上傳腳本 (在 zeabur auth login 後執行)
# 用法：在 PowerShell 執行此腳本
# ============================================================

$RepoRoot = $PSScriptRoot | Split-Path -Parent
$SvcDir = Join-Path $RepoRoot "services\approval"
$SvcId = "6a384ea9d12e4cadec4f4d04"

Write-Host "=== OneAI approval-svc 部署 ===" -ForegroundColor Cyan
Write-Host "上傳目錄: $SvcDir"
Write-Host ""

# 1. 確認 Zeabur 已登入
$status = zeabur auth status -i=false 2>&1
if ($status -match "401") {
    Write-Host "[ERROR] Zeabur 未登入，請先執行: zeabur auth login" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Zeabur 已登入" -ForegroundColor Green

# 2. 切換到 services/approval 目錄上傳
Set-Location $SvcDir
Write-Host "[INFO] 上傳 services/approval 到 Zeabur..." -ForegroundColor Yellow
zeabur upload --id $SvcId -i=false

Write-Host ""
Write-Host "=== 部署已觸發，等待服務啟動 ===" -ForegroundColor Cyan
Write-Host "請在 Zeabur Dashboard 確認服務狀態:"
Write-Host "https://dash.zeabur.com/projects/6a36ad9046477d6038840b9d/services/6a384ea9d12e4cadec4f4d04"
