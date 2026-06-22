@echo off
REM OneAI Worker 開機自啟 — 右鍵「以系統管理員身分執行」
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALL-WORKER.ps1"
pause
