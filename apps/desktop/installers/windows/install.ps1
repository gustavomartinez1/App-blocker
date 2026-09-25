#Requires -RunAsAdministrator
<#
  Instala el agente Guardián en Windows.
  - Servicio privilegiado (tarea programada como SYSTEM al arrancar, se reinicia si lo matan).
  - App de sesión al iniciar sesión (todos los usuarios).
  - Políticas de Chrome/Edge: extensión forzada, sin incógnito, sin DNS alterno.
  Uso:  powershell -ExecutionPolicy Bypass -File install.ps1 -Source .\build -ExtensionId <id>
#>
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [string]$ExtensionId = "",
  [string]$UpdateUrl = "https://clients2.google.com/service/update2/crx"
)
$ErrorActionPreference = "Stop"
$InstallDir = "$env:ProgramFiles\Guardian"
$DataDir = "$env:ProgramData\Guardian"

Write-Host "Copiando archivos a $InstallDir…"
New-Item -ItemType Directory -Force -Path $InstallDir, $DataDir | Out-Null
Copy-Item -Recurse -Force "$Source\*" $InstallDir

# Carpeta de datos: sólo SYSTEM y administradores escriben; los usuarios sólo leen (token de la API local).
icacls $DataDir /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" "Users:(OI)(CI)RX" | Out-Null
# Los usuarios estándar no pueden modificar la carpeta del programa.
icacls $InstallDir /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" "Users:(OI)(CI)RX" | Out-Null

Write-Host "Registrando el servicio…"
$action = New-ScheduledTaskAction -Execute "$InstallDir\node.exe" -Argument "`"$InstallDir\service\main.js`"" -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 9999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest -LogonType ServiceAccount
Register-ScheduledTask -TaskName "GuardianService" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
# Vigilante: cada 5 minutos se asegura de que el servicio esté corriendo.
$watch = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
$watchAction = New-ScheduledTaskAction -Execute "schtasks.exe" -Argument "/Run /TN GuardianService"
Register-ScheduledTask -TaskName "GuardianWatchdog" -Action $watchAction -Trigger $watch -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName "GuardianService"

Write-Host "App de sesión al iniciar sesión…"
Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -Name "Guardian" -Value "`"$InstallDir\Guardian.exe`""

Write-Host "Políticas de navegadores…"
foreach ($base in @("HKLM:\SOFTWARE\Policies\Google\Chrome", "HKLM:\SOFTWARE\Policies\Microsoft\Edge", "HKLM:\SOFTWARE\Policies\BraveSoftware\Brave")) {
  New-Item -Force -Path $base | Out-Null
  Set-ItemProperty -Path $base -Name "IncognitoModeAvailability" -Value 1 -Type DWord   # 1 = incógnito desactivado
  Set-ItemProperty -Path $base -Name "InPrivateModeAvailability" -Value 1 -Type DWord   # Edge
  Set-ItemProperty -Path $base -Name "DnsOverHttpsMode" -Value "off"                    # evita saltarse el filtro DNS
  Set-ItemProperty -Path $base -Name "ForceGoogleSafeSearch" -Value 1 -Type DWord
  Set-ItemProperty -Path $base -Name "ForceYouTubeRestrict" -Value 1 -Type DWord
  Set-ItemProperty -Path $base -Name "DeveloperToolsAvailability" -Value 2 -Type DWord  # sin herramientas de desarrollo
  if ($ExtensionId) {
    New-Item -Force -Path "$base\ExtensionInstallForcelist" | Out-Null
    Set-ItemProperty -Path "$base\ExtensionInstallForcelist" -Name "1" -Value "$ExtensionId;$UpdateUrl"
  }
}
# Firefox: sin navegación privada ni DoH.
$ff = "HKLM:\SOFTWARE\Policies\Mozilla\Firefox"
New-Item -Force -Path $ff | Out-Null
Set-ItemProperty -Path $ff -Name "DisablePrivateBrowsing" -Value 1 -Type DWord
New-Item -Force -Path "$ff\DNSOverHTTPS" | Out-Null
Set-ItemProperty -Path "$ff\DNSOverHTTPS" -Name "Enabled" -Value 0 -Type DWord
Set-ItemProperty -Path "$ff\DNSOverHTTPS" -Name "Locked" -Value 1 -Type DWord

Write-Host ""
Write-Host "Listo. Recomendaciones:" -ForegroundColor Green
Write-Host " - El usuario supervisado debe usar una cuenta ESTÁNDAR (no administrador)."
Write-Host " - Abre Guardián en su sesión y vincula con el código del panel."
