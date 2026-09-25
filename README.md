# Guardián — bloqueo de apps y sitios, administrado a distancia

Monorepo con todo lo necesario para que un administrador (padre/madre, tutor, o uno mismo en modo autocontrol) decida qué se bloquea, cuándo y por cuánto tiempo, en varios dispositivos.

## Qué incluye

| Carpeta | Qué es | Estado |
|---|---|---|
| `packages/core` | Motor de reglas compartido (TypeScript): bloqueo permanente, por horario, límite diario, descansos cada X minutos, temporal; catálogo de apps/sitios; códigos sin internet | ✅ con pruebas |
| `apps/server` | API (Fastify + SQLite): cuentas, perfiles, reglas, dispositivos, solicitudes de desbloqueo, alertas, notificaciones push | ✅ con pruebas |
| `apps/web` | Panel del administrador (React, instalable como app en el celular) | ✅ probado en navegador |
| `apps/desktop` | Agente para Windows/macOS/Linux: cierra apps bloqueadas, filtro de sitios, pantalla de bloqueo | ✅ con pruebas |
| `apps/extension` | Extensión para Chrome/Edge/Brave/Firefox: bloqueo de sitios y secciones, tiempo de uso, SafeSearch | ✅ probada en Chromium |
| `apps/android` | Motor de reglas portado a Kotlin (modelo, evaluación, códigos) | 🟡 sólo el motor, con pruebas; falta la app |
| `apps/ios` | — | ⬜ pendiente |

## Funciones principales

- **Tipos de regla:** siempre, por horario (o “sólo permitido en…”), límite diario compartido entre dispositivos (y máximo de aperturas), descansos obligatorios, bloqueo temporal.
- **Qué bloquear:** servicios del catálogo (una sola opción bloquea app + sitio), categorías, dominios, secciones de sitios (p. ej. `youtube.com/shorts`), palabras clave, o todo el dispositivo con excepciones.
- **Acciones rápidas del admin:** bloquear ya, liberar el dispositivo, dar tiempo extra.
- **Solicitudes:** desde la pantalla de bloqueo se pide desbloqueo o más tiempo; al admin le llega una notificación y responde desde el panel.
- **Códigos sin internet:** códigos de 6 dígitos que caducan en 10 min y sirven una sola vez.
- **Alertas:** códigos incorrectos, cambios de hora, dispositivos que dejan de reportar, etc.
- **Modo autocontrol:** los cambios que relajan las reglas esperan un tiempo configurable.
- **Siempre permitido:** llamadas, SMS y emergencias nunca se bloquean.

## Desarrollo

```bash
npm install            # ELECTRON_SKIP_BINARY_DOWNLOAD=1 si no vas a ejecutar la app de escritorio
npm run build
npm test
npm run dev:server     # API en :8787
npm run dev:web        # panel en :5173
```

En producción define `GUARDIAN_TOKEN_SECRET`. El servidor sirve el panel desde `apps/web/dist`.

## Uso responsable

Pensado para supervisión familiar con conocimiento de la persona supervisada, y para autocontrol. Instálalo sólo en dispositivos que administres legítimamente e informa a quien lo use.
