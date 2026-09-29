# Guarda el usuario y la clave de RAFAM que usa la descarga diaria
# (scripts\rafam-diario.ps1). Se guardan cifrados con la cuenta de Windows de
# esta PC (DPAPI): solo este usuario, en esta PC, puede leerlos. No quedan en
# el repo ni en texto plano.
#
# Uso: doble clic en scripts\guardar-credencial-rafam.bat
# Para cambiar la clave, correrlo de nuevo.

$destino = Join-Path $env:APPDATA "formulario-17\rafam-credencial.xml"
$cred = Get-Credential -Message "Usuario y clave de RAFAM para la descarga diaria de gastos (ej. usuario L310019)"
if (-not $cred) {
    Write-Host "Cancelado: no se guardó nada."
    exit 1
}
New-Item -ItemType Directory -Force -Path (Split-Path $destino) | Out-Null
$cred | Export-Clixml -Path $destino
Write-Host "Listo: credencial de RAFAM guardada para el usuario $($cred.UserName)."
Write-Host "Archivo (cifrado): $destino"
