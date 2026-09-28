@echo off
rem Pasa a la base de produccion del F17 los reportes de gastos de RAFAM que
rem baja el pipeline de RAFAMOR. Pensado para el Programador de tareas de
rem Windows, despues de la corrida diaria de RAFAMOR (rafam_ejecutado_bg.bat).
rem
rem Necesita Node.js en el PATH (o en NODE_DIR) y credenciales de Cloudflare:
rem "npx wrangler login" una vez en esta PC, o la variable CLOUDFLARE_API_TOKEN
rem con permiso de edicion sobre D1.

setlocal
if defined NODE_DIR set "PATH=%NODE_DIR%;%PATH%"
cd /d "%~dp0.."
if not exist logs mkdir logs
echo ==== %date% %time% ==== >> logs\sync-rafamor.log
call node scripts\sync-rafamor.mjs --remote %* >> logs\sync-rafamor.log 2>&1
exit /b %errorlevel%
