#!/bin/sh
# Instala Guardián en Linux (systemd). Uso: sudo ./install.sh ./build
set -eu
SRC="${1:?Indica la carpeta del build}"
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta con sudo"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"

mkdir -p /opt/guardian /var/lib/guardian
cp -R "$SRC"/* /opt/guardian/
chown -R root:root /opt/guardian /var/lib/guardian
chmod -R go-w /opt/guardian
chmod 755 /var/lib/guardian

cp "$HERE/guardian.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now guardian.service
cp "$HERE/guardian-session.desktop" /etc/xdg/autostart/

# Políticas de navegadores: sin incógnito ni DNS cifrado alterno.
mkdir -p /etc/opt/chrome/policies/managed /etc/chromium/policies/managed /etc/brave/policies/managed
POLICY='{"IncognitoModeAvailability":1,"DnsOverHttpsMode":"off","ForceGoogleSafeSearch":true,"ForceYouTubeRestrict":1}'
for d in /etc/opt/chrome/policies/managed /etc/chromium/policies/managed /etc/brave/policies/managed; do echo "$POLICY" > "$d/guardian.json"; done
mkdir -p /usr/lib/firefox/distribution
echo '{"policies":{"DisablePrivateBrowsing":true,"DNSOverHTTPS":{"Enabled":false,"Locked":true}}}' > /usr/lib/firefox/distribution/policies.json

echo "Listo. El usuario supervisado no debe tener permisos de sudo."
echo "Nota: en Wayland la detección de la app en primer plano no está disponible; el cierre de apps y el filtro de sitios sí funcionan."
