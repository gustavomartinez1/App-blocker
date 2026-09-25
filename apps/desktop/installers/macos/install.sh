#!/bin/sh
# Instala Guardián en macOS (ejecutar con sudo). Uso: sudo ./install.sh ./build
set -eu
SRC="${1:?Indica la carpeta del build}"
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta con sudo"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"

mkdir -p /Library/Guardian "/Library/Application Support/Guardian" /Library/Logs/Guardian
cp -R "$SRC"/service "$SRC"/node /Library/Guardian/
cp -R "$SRC"/Guardian.app /Applications/
chown -R root:wheel /Library/Guardian "/Library/Application Support/Guardian" /Applications/Guardian.app
chmod -R go-w /Library/Guardian /Applications/Guardian.app
chmod 755 "/Library/Application Support/Guardian"

cp "$HERE/com.guardian.service.plist" /Library/LaunchDaemons/
cp "$HERE/com.guardian.session.plist" /Library/LaunchAgents/
chown root:wheel /Library/LaunchDaemons/com.guardian.service.plist /Library/LaunchAgents/com.guardian.session.plist
launchctl bootstrap system /Library/LaunchDaemons/com.guardian.service.plist 2>/dev/null || launchctl load -w /Library/LaunchDaemons/com.guardian.service.plist

# Evita saltarse el filtro con DNS cifrado en Chrome/Edge/Brave.
for d in com.google.Chrome com.microsoft.Edge com.brave.Browser; do
  defaults write "/Library/Managed Preferences/$d" IncognitoModeAvailability -int 1
  defaults write "/Library/Managed Preferences/$d" DnsOverHttpsMode -string off
  defaults write "/Library/Managed Preferences/$d" ForceGoogleSafeSearch -bool true
done

echo "Listo. El usuario supervisado debe ser una cuenta ESTÁNDAR."
echo "Para máxima protección instala el perfil de configuración (MDM) que bloquea la desinstalación."
