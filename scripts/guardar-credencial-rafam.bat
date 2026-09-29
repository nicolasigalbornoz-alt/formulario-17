@echo off
rem Doble clic: pide usuario y clave de RAFAM y los guarda cifrados para la
rem descarga diaria (ver guardar-credencial-rafam.ps1).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0guardar-credencial-rafam.ps1"
pause
