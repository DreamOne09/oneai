@echo off
REM OneAI 雙 Worker 開機自啟 — 右鍵「以系統管理員身分執行」
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALL-WORKERS.ps1"
pause
