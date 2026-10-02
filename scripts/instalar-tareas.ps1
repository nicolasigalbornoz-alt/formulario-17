# Deja programada en esta PC (la que tiene RAFAM) la carga diaria de la página
# de Presupuesto: baja de RAFAM los reportes del mes con el bot de RAFAMOR y
# los sube a la base del sitio (scripts\rafam-diario.ps1). Se usa en lugar de
# RAFAMOR SQL cuando la nube está pausada, y además trae el reporte completo
# (con preventivo y los programas sin actividades separados).
#
# Corre de lunes a viernes a las 07:45 (datos al día anterior) y a las 19:00
# (datos del mismo día), solo con la sesión de Windows iniciada. El bot cierra
# cualquier Contabilidad.exe abierto: por eso fuera del horario de uso.
#
# Doble clic en scripts\instalar-tareas.bat. Se puede volver a correr: reemplaza la tarea.

# "Continue": con "Stop", Windows PowerShell corta ante cualquier aviso que
# npx/wrangler escriban en stderr. Los errores se controlan a mano.
$ErrorActionPreference = "Continue"
$repo = Split-Path $PSScriptRoot -Parent
$nombre = "Presupuesto - Bajar RAFAM y actualizar la pagina"

function Paso([string]$m) { Write-Host ""; Write-Host "== $m" -ForegroundColor Cyan }
function Falla([string]$m) { Write-Host $m -ForegroundColor Red; exit 1 }

Paso "1/5 Node.js"
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { Falla "No encuentro Node.js. Instalalo desde https://nodejs.org (version LTS) y volve a correr esto." }
Write-Host "OK: $node"
Push-Location $repo
if (-not (Test-Path (Join-Path $repo "node_modules\wrangler"))) {
    Write-Host "Instalando dependencias del repo (npm install)..."
    & npm.cmd install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Pop-Location; Falla "Fallo npm install." }
}

Paso "2/5 Acceso a Cloudflare (para escribir en la base del sitio)"
$quien = (& npx.cmd wrangler whoami 2>&1) -join "`n"
if ($quien -notmatch "logged in") {
    Write-Host "Se abre el navegador para autorizar a esta PC en Cloudflare. Acepta y volve a esta ventana."
    & npx.cmd wrangler login
    $quien = (& npx.cmd wrangler whoami 2>&1) -join "`n"
    if ($quien -notmatch "logged in") { Pop-Location; Falla "No quedo autorizada en Cloudflare: volve a correr esto." }
}
Write-Host "OK: autorizada en Cloudflare"
Pop-Location

Paso "3/5 Bot de RAFAMOR"
$rafamor = Resolve-Path (Join-Path $repo "..\Flujos semanales\Flujos semanales") -ErrorAction SilentlyContinue
if (-not $rafamor -or -not (Test-Path (Join-Path $rafamor "rafam_ejecutado_bg.py"))) {
    $rafamor = Read-Host "No encuentro la carpeta de RAFAMOR al lado del repo. Pega la ruta de la carpeta que tiene rafam_ejecutado_bg.py"
    if (-not (Test-Path (Join-Path $rafamor "rafam_ejecutado_bg.py"))) { Falla "En esa carpeta no esta rafam_ejecutado_bg.py." }
}
if (-not (Get-Command python.exe -ErrorAction SilentlyContinue)) { Falla "No encuentro python.exe (lo usa el bot de RAFAMOR)." }
Write-Host "OK: $rafamor"

Paso "4/5 Usuario y clave de RAFAM"
if (-not (Test-Path (Join-Path $env:APPDATA "formulario-17\rafam-credencial.xml"))) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "guardar-credencial-rafam.ps1")
}
if (-not (Test-Path (Join-Path $env:APPDATA "formulario-17\rafam-credencial.xml"))) { Falla "No quedo guardada la credencial de RAFAM." }
Write-Host "OK: guardada (cifrada con tu usuario de Windows)"

Paso "5/5 Tarea programada"
Unregister-ScheduledTask -TaskName "F17 - Descargar RAFAM y sincronizar" -Confirm:$false -ErrorAction SilentlyContinue
$accion = New-ScheduledTaskAction -Execute "powershell.exe" -WorkingDirectory $repo `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$repo\scripts\rafam-diario.ps1`" -RafamorDir `"$rafamor`""
$dias = "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"
$disparos = @(
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $dias -At "07:45"),
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $dias -At "19:00")
)
$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$quienCorre = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
try {
    Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger $disparos -Settings $ajustes -Principal $quienCorre -Force -ErrorAction Stop | Out-Null
} catch {
    Falla "No se pudo crear la tarea: $($_.Exception.Message)"
}
Write-Host "OK: '$nombre' de lunes a viernes a las 07:45 y 19:00"

$ahora = Read-Host "Correrla ahora para tener los datos de hoy? Cierra RAFAM si esta abierto en esta PC. (S/N)"
if ($ahora -match "^[sS]") {
    Start-ScheduledTask -TaskName $nombre
    Write-Host "Corriendo. Tarda unos minutos; el detalle queda en $repo\logs\rafam-diario.log y logs\sync-rafamor.log."
}
Write-Host ""
Write-Host "Listo." -ForegroundColor Green
