# iOS y Android: qué opciones hay

## iOS (iPhone / iPad)

Apple no permite que una app bloquee otras apps por su cuenta. Las vías oficiales son:

### 1. API de Tiempo en pantalla (FamilyControls + ManagedSettings + DeviceActivity) — **recomendada**
- **Autocontrol** (autorización *individual*): la persona autoriza la app en su propio iPhone.
- **Padres e hijos** (autorización *child*, con Compartir en familia): el adulto aprueba; el menor no puede quitar la app sin el permiso del adulto.
- Qué permite: bloquear apps, categorías y sitios elegidos con el selector de Apple; pantalla de bloqueo personalizada con botón “Pedir desbloqueo”; horarios; límites por tiempo de uso; bloquear instalar/borrar apps.
- Qué **no** permite: ver desde el servidor los nombres de las apps elegidas (Apple las entrega como identificadores opacos: la selección se hace en el iPhone) ni bloquear partes del sistema como el Centro de control.
- Requisitos: Mac con Xcode, Apple Developer Program (US$99/año) y solicitar a Apple el permiso *Family Controls (Distribution)*, que puede tardar de días a semanas.

La causa del problema de tu amigo suele ser un bloqueo de “todas las apps” sin excepciones. Con esta API se elige exactamente qué se bloquea: puede bloquear redes sociales y dejar libres Cámara, Reloj, Mapas, etc.

### 2. MDM con dispositivos supervisados — para **empresas**
Con Apple Business Manager + un servidor MDM, la empresa controla a fondo los iPhone que son de la empresa (restricciones, apps permitidas, filtro web). No aplica a celulares personales.

## Android

- **Empresas**: Android Enterprise / Android Management API de Google (gratis) para celulares de la empresa: apps permitidas, restricciones, bloqueo de desinstalación de forma oficial.
- **Padres**: Google Family Link cubre lo básico; una app propia necesita permisos especiales (uso de apps, accesibilidad, VPN) que Google Play revisa con mucho cuidado y exige declarar y justificar.
- **Autocontrol**: permisos de uso de apps + pantalla de bloqueo propia.

## Plan sugerido
1. iOS con la API de Tiempo en pantalla (autocontrol y familia).
2. Android con Android Enterprise para empresas y una app de autocontrol/familia.
3. Ambas usan el mismo servidor, panel y reglas que ya existen.
