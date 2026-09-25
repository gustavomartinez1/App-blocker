#Requires -RunAsAdministrator
# Desinstala Guardián. Requiere que en el equipo se haya introducido un código de "Acceso de admin".
$ErrorActionPreference = "Stop"
$DataDir = "$env:ProgramData\Guardian"
$token = Get-Content "$DataDir\session.token"
try {
  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:47631/uninstall-check" -Headers @{ Authorization = "Bearer $token" } | Out-Null
} catch {
  Write-Host "Primero introduce un código de 'Acceso de admin' en Guardián (el administrador ya fue notificado del intento)." -ForegroundColor Red
  exit 1
}
Unregister-ScheduledTask -TaskName "GuardianWatchdog" -Confirm:$false -ErrorAction SilentlyContinue
Stop-ScheduledTask -TaskName "GuardianService" -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "GuardianService" -Confirm:$false -ErrorAction SilentlyContinue
Remove-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -Name "Guardian" -ErrorAction SilentlyContinue
Get-Process -Name "Guardian" -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item -Recurse -Force "$env:ProgramFiles\Guardian", $DataDir
Write-Host "Guardián se desinstaló. Las políticas de navegador se conservan; bórralas en HKLM:\SOFTWARE\Policies si ya no las quieres."
