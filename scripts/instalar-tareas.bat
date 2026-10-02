@echo off
rem Doble clic: deja programada en esta PC la carga diaria desde RAFAM
rem (ver instalar-tareas.ps1).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar-tareas.ps1"
pause
