@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "" powershell -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0javaTool-gui.ps1"
