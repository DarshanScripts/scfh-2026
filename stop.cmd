@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0manage-demo.ps1" stop
exit /b %errorlevel%
