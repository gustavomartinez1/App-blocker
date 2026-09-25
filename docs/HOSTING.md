# Dónde alojar Guardián

El servidor necesita estar **siempre encendido** (WebSockets para cambios al instante, tareas cada minuto, base de datos en disco). Por eso **no sirven** Vercel/Netlify ni planes gratuitos que “se duermen” (Render free): el celular dejaría de recibir cambios y llegarían alertas falsas de “dispositivo desconectado”.

## Recomendación: VPS Hetzner + Docker

| Concepto | Costo aprox. |
|---|---|
| VPS Hetzner CX23 | ~€5.49/mes (≈ US$6.5) |
| Dominio (.com) | ~US$10–15/año |
| HTTPS (Caddy + Let's Encrypt) | gratis |
| Avisos por Telegram | gratis |
| Correo (Brevo, Resend, Zoho…) | plan gratuito suficiente para empezar |
| **Total** | **≈ US$7–8/mes** |

Para las apps móviles, aparte: **Apple Developer Program US$99/año** (obligatorio para iOS) y **Google Play US$25 una sola vez**.

Alternativas: DigitalOcean/Vultr/Linode (~US$6/mes, similares), Railway o Fly.io (fáciles pero suelen salir más caros con disco persistente), tu propia PC (gratis pero se cae si se apaga o cambia la IP).

## Pasos

1. Crea el VPS (Ubuntu 24.04) e instala Docker: `curl -fsSL https://get.docker.com | sh`
2. Apunta tu dominio a la IP del VPS (registro **A**).
3. En el VPS:
   ```bash
   git clone https://github.com/gustavomartinez1/App-blocker.git && cd App-blocker/deploy
   cp .env.example .env   # rellena DOMAIN, GUARDIAN_TOKEN_SECRET (openssl rand -hex 32), etc.
   docker compose up -d --build
   ```
4. Abre `https://tu-dominio` y crea la cuenta de administrador.

Incluye copia de seguridad diaria de la base de datos en `deploy/backups/` (14 días). Recomendado: copiar esa carpeta fuera del servidor (p. ej. `rclone` a Google Drive o Backblaze B2).

## Avisos al administrador

| Canal | Costo | Para qué |
|---|---|---|
| Notificación push del panel | gratis | Android, iPhone (panel agregado a inicio), PC |
| **Telegram** | gratis | Solicitudes con botones “✅ 15 min / ❌ Rechazar”; alertas al instante |
| Correo | gratis (plan básico) | Alertas críticas (por defecto) o todas |
| WhatsApp | de pago por mensaje + verificación de Meta | Posible más adelante vía WhatsApp Business Cloud API |

Telegram: habla con @BotFather → `/newbot` → copia el token a `GUARDIAN_TELEGRAM_BOT_TOKEN`. Cada admin lo conecta en Ajustes → “Conectar Telegram”.
