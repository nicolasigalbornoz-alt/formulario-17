# Corrida diaria en la PC que tiene RAFAM instalado:
#   1. baja de RAFAM los reportes mensuales de gastos con el bot de RAFAMOR
#      (rafam_ejecutado_bg.py --periodo mes --tipo gastos), que los deja en
#      <RAFAMOR>\ejecutados_AAAA\gastos_mensual\
#   2. los carga en la base del F17 (scripts\sync-rafamor.bat)
#
# La credencial de RAFAM se lee de %APPDATA%\formulario-17\rafam-credencial.xml
# (cifrada; se crea con scripts\guardar-credencial-rafam.bat).
#
# OJO: el bot cierra cualquier Contabilidad.exe abierto al arrancar. Conviene
# programarlo en un horario en que nadie esté usando RAFAM en esta PC.
#
# Log: logs\rafam-diario.log (el detalle de RAFAM queda además en
# <RAFAMOR>\ejecutados_AAAA\corrida.log).

param(
    [string]$RafamorDir = (Join-Path $PSScriptRoot "..\..\Flujos semanales\Flujos semanales"),
    [string]$NodeDir = $env:NODE_DIR
)

$repo = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $repo "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "rafam-diario.log"
function Log([string]$m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" | Out-File -Append -Encoding utf8 $log }

Log "==== Inicio ===="

$credPath = Join-Path $env:APPDATA "formulario-17\rafam-credencial.xml"
if (-not (Test-Path $credPath)) {
    Log "Falta la credencial de RAFAM: correr scripts\guardar-credencial-rafam.bat. No se bajó nada."
    exit 2
}
$cred = Import-Clixml $credPath
$usuario = $cred.UserName
$clave = $cred.GetNetworkCredential().Password

$bot = Join-Path $RafamorDir "rafam_ejecutado_bg.py"
if (-not (Test-Path $bot)) { Log "No encuentro el bot de RAFAMOR en $bot"; exit 3 }
$python = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
if (-not $python) { Log "No encuentro python.exe en el PATH"; exit 3 }

# En enero, primero se cierra diciembre del año anterior.
$hoy = Get-Date
$corridas = @()
if ($hoy.Month -eq 1) { $corridas += , @(($hoy.Year - 1), 12) }
$corridas += , @($hoy.Year, 0)   # mes 0 = todos los meses del año (saltea los que ya están completos)

$errores = 0
foreach ($c in $corridas) {
    Log "RAFAM: bajando gastos mensuales, año $($c[0]), mes $($c[1]) (0 = todos) con el usuario $usuario"
    & $python $bot --periodo mes --tipo gastos --anio $c[0] --mes $c[1] --usuario $usuario --clave $clave --max-horas 1 *> $null
    Log "RAFAM terminó con código $LASTEXITCODE"
    if ($LASTEXITCODE -ne 0) { $errores++ }
}
Remove-Variable clave

Log "Cargando en la base del F17"
if ($NodeDir) { $env:NODE_DIR = $NodeDir }
$env:RAFAMOR_DIR = $RafamorDir   # sync-rafamor.mjs busca los reportes ahí
& cmd.exe /c "`"$repo\scripts\sync-rafamor.bat`""
$sync = $LASTEXITCODE
Log "Sincronización terminó con código $sync (detalle en logs\sync-rafamor.log)"

if ($errores -or $sync) { exit 1 }
exit 0
