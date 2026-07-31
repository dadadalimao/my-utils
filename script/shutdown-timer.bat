@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\shengxianghui\my-utils\script\shutdown-timer.ps1"
if errorlevel 1 pause
