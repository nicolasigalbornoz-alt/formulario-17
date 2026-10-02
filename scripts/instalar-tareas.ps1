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
# Sin permisos de administrador: la version portable oficial (ZIP de
# nodejs.org) descomprimida en el perfil del usuario. No pide UAC.
$nodePortable = Join-Path $env:LOCALAPPDATA "Programs\nodejs"
$nodeDir = $null
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node -and (Test-Path (Join-Path $nodePortable "node.exe"))) { $node = Join-Path $nodePortable "node.exe" }
if (-not $node) {
    $resp = Read-Host "No esta Node.js. Bajo la version LTS portable oficial de nodejs.org (unos 30 MB) a $nodePortable, sin pedir permisos de administrador? (S/N)"
    if ($resp -notmatch "^[sS]") { Falla "Sin Node.js no se puede seguir. Instalalo desde https://nodejs.org y volve a correr esto." }
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $arq = if ([Environment]::Is64BitOperatingSystem) { "win-x64" } else { "win-x86" }
        $lts = (Invoke-RestMethod "https://nodejs.org/dist/index.json" -UseBasicParsing | Where-Object { $_.lts } | Select-Object -First 1).version
        $zip = "node-$lts-$arq.zip"
        $tmp = Join-Path $env:TEMP "presupuesto-node"
        New-Item -ItemType Directory -Force -Path $tmp | Out-Null
        Write-Host "Bajando $zip de https://nodejs.org/dist/$lts/ ..."
        Invoke-WebRequest "https://nodejs.org/dist/$lts/$zip" -OutFile (Join-Path $tmp $zip) -UseBasicParsing
        # Control de integridad contra la lista oficial de sumas SHA-256.
        $sumas = (Invoke-WebRequest "https://nodejs.org/dist/$lts/SHASUMS256.txt" -UseBasicParsing).Content
        $esperada = ($sumas -split "`n" | Where-Object { $_ -match [regex]::Escape($zip) + "$" }) -replace "\s+.*$", ""
        $real = (Get-FileHash (Join-Path $tmp $zip) -Algorithm SHA256).Hash
        if (-not $esperada -or $real -ne $esperada.Trim().ToUpper()) { Falla "El archivo bajado no coincide con la suma oficial de nodejs.org. No se instalo nada." }
        Expand-Archive (Join-Path $tmp $zip) -DestinationPath $tmp -Force
        if (Test-Path $nodePortable) { Remove-Item $nodePortable -Recurse -Force }
        New-Item -ItemType Directory -Force -Path (Split-Path $nodePortable) | Out-Null
        Move-Item (Join-Path $tmp ($zip -replace "\.zip$", "")) $nodePortable
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    } catch {
        Falla "No se pudo bajar Node.js: $($_.Exception.Message)"
    }
    $node = Join-Path $nodePortable "node.exe"
    if (-not (Test-Path $node)) { Falla "No quedo node.exe en $nodePortable." }
    # Para que se encuentre en las ventanas nuevas (PATH del usuario, no del sistema).
    $pathUsuario = [Environment]::GetEnvironmentVariable("Path", "User")
    if (($pathUsuario -split ";") -notcontains $nodePortable) {
        [Environment]::SetEnvironmentVariable("Path", ((@($pathUsuario, $nodePortable) | Where-Object { $_ }) -join ";"), "User")
    }
}
if ($node -like "$nodePortable*") {
    $nodeDir = $nodePortable
    $env:Path = "$nodePortable;$env:Path"
}
Write-Host "OK: $node ($(& $node --version))"
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
    -Argument ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$repo\scripts\rafam-diario.ps1`" -RafamorDir `"$rafamor`"" +
        $(if ($nodeDir) { " -NodeDir `"$nodeDir`"" } else { "" }))
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
