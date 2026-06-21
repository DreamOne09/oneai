@echo off
REM OneAI Worker - Autostart Setup
REM Right-click this file and choose "Run as administrator"

set REPO=C:\Users\b1993\.cursor\projects\empty-window
set BAT=%REPO%\hands\antigravity\scripts\start-worker.bat

echo [OneAI] Creating scheduled task...
schtasks /Delete /TN "OneAI-Worker" /F 2>nul
schtasks /Create /TN "OneAI-Worker" /TR "cmd.exe /C \"%BAT%\"" /SC ONLOGON /F

if %ERRORLEVEL% == 0 (
    echo [OneAI] SUCCESS - Worker will auto-start on login
    echo [OneAI] Test now:
    schtasks /Run /TN "OneAI-Worker"
) else (
    echo [OneAI] FAILED - Please run as Administrator
)
pause
