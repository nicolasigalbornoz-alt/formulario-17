# Formulario 17 — Subsecretaría de Planificación Presupuestaria y Estadística, Morón

Reemplazo de las páginas de Google Sites de la Subsecretaría de Planificación Presupuestaria y Estadística
(`presupuestomoron`), en especial **Formulario 17 → Programas** y
**Formulario 17 → Categorías programáticas**, que ahora son una sola
página. También reemplaza lo que había detrás:

| Antes | Ahora |
|---|---|
| Planillas "registros f17/programa" y "registros f17/categoría" (hojas `basevig`, `añoant`, `vigente`) cargadas a mano cada trimestre | Base SQL (Cloudflare D1) con la ejecución de gastos de RAFAM, la misma que baja a diario el pipeline de **RAFAMOR** |
| AppScript que generaba un Excel por programa, fuente y trimestre | El F17 se arma al momento; el Excel es solo una opción de descarga |
| Tablero de Looker Studio para buscar el archivo | Filtros jurisdicción → programa → categoría (opcional) → fuente |
| Macro `.xlsm` que sumaba los F17 de cada categoría | Botón «Programa completo»: un Excel con el total del programa y una hoja por categoría, para cada fuente |
| Formulario de Google "inscripción" | Lista de difusión propia, con panel para exportar CSV y mandar avisos |

El sitio usa la estética del sistema interno de Gestión Documental del
Municipio (sde_v2): paleta, tipografías Neo Sans, header, hero, tarjetas y
login.

## Qué hay en el sitio

- **Inicio**: accesos, calendarios de entrega (trimestrales y anuales, los
  mismos Google Calendar del Sites) y contacto.
- **Formulario 17** (`/formulario-17`, con usuario): el F17 prellenado.
  - **Trimestre a cargar**: se elige, pero solo entre los que tienen
    cerrados todos los trimestres anteriores del año (sus tres meses
    cargados completos desde RAFAM). Por defecto, el último disponible.
  - Dos carriles con un switch: **por programa** (lo que se carga en RAFAM)
    o **por categoría programática**, que avisa que hay que consolidarlo con
    las demás categorías del programa (y el Excel lo repite arriba).
  - La página no guarda nada de lo que se programa: un solo botón descarga
    el Excel con el formato de la plantilla (trimestres a programar vacíos,
    fórmulas de Disponible y Total anual, formato condicional).
- **Instructivos** (`/instructivos`): PPP, F1, F4/F5, F7, F17 y Ejecutado de
  gastos, con los PDF de Drive y los videos de YouTube del Sites. Se editan
  en `src/lib/instructivos.ts`.
- **Lista de difusión** (`/lista-de-difusion`): alta con los mismos datos que
  el formulario de Google (nombre, secretaría, cargo, programas, teléfono,
  mails) y baja.
- **Panel** (`/admin`, solo administradores): seguimiento del F17,
  usuarios, avisos y fechas, suscriptos (baja/reactivar, CSV) y estado de
  los datos de RAFAM con subida manual de un reporte.

## Avisos, fechas y alertas por mail

Panel → Avisos y fechas:

- **Fechas de vencimiento** (ej. «Presentación F17 del IV trimestre»): se
  muestran en el inicio y arriba del F17. Cada una manda alertas por mail a
  la lista de difusión: unos días antes (0 a 15, se elige) y el mismo día.
  Las manda una tarea programada del Worker todos los días a las 8:00
  (`[triggers]` en `wrangler.toml`, `worker/index.mjs` →
  `/api/cron/alertas`); cada alerta sale una sola vez y, si se cambia la
  fecha, vuelven a salir. «Revisar alertas ahora» las fuerza a mano.
- **Avisos**: título y texto que se muestran en el inicio y en el F17 entre
  las fechas elegidas (pueden ir destacados) y, si se tilda, se mandan por
  mail a la lista en el momento.
- Historial de todos los mails enviados.

Sin proveedor de mail configurado todo se publica en el sitio, pero los
mails no salen (ver «Envío de mails»).

## Usuarios y seguimiento

- **Administrador principal**: usuario `admin`, con la contraseña del secret
  `ADMIN_PASSWORD_HASH` (sha-256; se cambia en Cloudflare). Ve todas las
  jurisdicciones, el seguimiento y el panel. Desde el panel se pueden crear
  otros administradores.
- **Un usuario por secretaría** (la migración `0003` crea uno por cada
  jurisdicción con presupuesto 2026, sin contraseña): solo ve y descarga el
  F17 de sus jurisdicciones; el servidor rechaza cualquier otra. Las
  contraseñas las genera el administrador en Panel → Usuarios («Generar
  contraseñas para los … sin contraseña»): se muestran una sola vez, con un
  CSV para repartirlas. Se guardan con PBKDF2; cambiar la contraseña o
  desactivar el usuario cierra sus sesiones. 8 intentos fallidos en 15
  minutos bloquean el usuario un rato.
- **Seguimiento** (Panel → Seguimiento F17): para el trimestre que se está
  programando, cada programa con crédito vigente muestra quién descargó el
  Excel y cuándo (y si fue por categoría), y si la secretaría marcó que ya
  lo cargó en RAFAM. Avance por secretaría con barras y filtro de
  pendientes. Las secretarías marcan sus programas como cargados desde la
  misma página del F17.

## Lógica del F17

Replica las fórmulas de la hoja `f17` de las planillas "registros f17"
(`src/lib/f17.ts`), por jurisdicción + programa (+ categoría) + fuente +
partida:

| Columna | Planilla | Ahora |
|---|---|---|
| Trimestre (D5) | se elegía a mano | el del día siguiente al último dato de RAFAM (datos al 24/09 → se programa el III; al 30/09 → el IV) |
| Partidas | vigente > 0 al cierre del trimestre anterior | vigente > 0 al último dato (o con compromiso en el año: salen en rojo) |
| Compromiso del año anterior | suma de `añoant` | compromiso de todo el año anterior |
| Igual trimestre año anterior | `añoant`, trimestre D5 | compromiso del año anterior en el trimestre D5 |
| **Crédito vigente** | `vigente` al cierre del trimestre anterior | **vigente al último día con información** (pedido de la Subsecretaría) |
| Trimestres I–IV | compromiso de cada trimestre < D5 | ídem, sumando los meses de cada trimestre |
| Disponible / Total anual | `G − M` / `SUM(H:K)` | ídem (también como fórmulas en el Excel) |
| Rojo | `M > G` | ídem |

Sin categoría elegida, el programa es la suma de todas sus categorías.

**Validación** contra las planillas (corte simulado al 31/03/2026, que es
lo que la planilla usaba para el II trimestre): el crédito vigente coincide
en el 100% de las partidas (2.245 por programa, 3.044 por categoría). El
compromiso del I trimestre coincide salvo donde la planilla tenía importes
guardados como texto (`"0"`, que `SUMIFS` ignora) o compromisos que RAFAM
registró después de la carga. Además, la hoja `añoant` de la planilla solo
tenía hasta el III trimestre de 2025, así que su "Compromiso del año
anterior" quedaba corto (ej. Economía, programa 1, partida 1.1.1.0:
$464,9 M en la planilla contra $644,4 M del año completo).

## Datos: de RAFAM a la base

La tabla `rafam_gastos` (`migrations/0002_rafam_gastos.sql`) tiene la misma
forma que la tabla "Gastos" de la base mensual de RAFAMOR: un reporte
*Estado de Ejecución del Presupuesto de Gastos* por mes, con el crédito
vigente a la fecha del reporte y el compromiso del mes. Por cada mes queda
la foto del último reporte (el del mes en curso se reemplaza a diario).

Los reportes se interpretan con `src/lib/rafam-gastos.mjs`, validado contra
los totales por jurisdicción que imprime el propio RAFAM en los 21 reportes
mensuales de 2025–2026. Corrige dos problemas del parser de RAFAMOR
(`generar_base_mensual.py` / `generar_base_diaria.py`), que conviene
arreglar también allá:

1. Los programas sin actividades (`Apertura Programática:17.00.00 - …`, todo
   en una celda) no se detectan y su gasto queda sumado a la categoría
   anterior (ej. el programa 17 de Control Comunal aparece dentro de
   01.18.00).
2. "Servicios de la Deuda", "Jefatura de Gabinete" y "Sec. de Mujeres…"
   quedan sin código de jurisdicción (acá se toma del código RAFAM:
   `1110109000` → 09).

Hay dos formas de cargar los datos:

- **Automática** (recomendada), en la PC donde corre RAFAMOR:
  ```bash
  node scripts/sync-rafamor.mjs --remote
  ```
  Busca en `..\Flujos semanales\Flujos semanales\ejecutados_AAAA\gastos_mensual\`
  (o `--dir=...` / variable `RAFAMOR_DIR`) el reporte más nuevo de cada mes
  y carga solo los meses que cambiaron. `scripts\sync-rafamor.bat` hace lo
  mismo con log en `logs\`, para programarlo en el Programador de tareas de
  Windows después de la corrida diaria de RAFAMOR. Necesita credenciales de
  Cloudflare: `npx wrangler login` una vez, o la variable
  `CLOUDFLARE_API_TOKEN` con permiso de edición sobre D1.
- **Descarga + carga diaria en una PC con RAFAM** (la que usa la
  Subsecretaría): la tarea programada *F17 - Descargar RAFAM y sincronizar*
  corre `scripts\rafam-diario.ps1` de lunes a viernes a las 07:45. Baja de
  RAFAM los reportes mensuales de gastos con el bot de RAFAMOR
  (`rafam_ejecutado_bg.py --periodo mes --tipo gastos`) y después corre la
  sincronización. El usuario y la clave de RAFAM se cargan una vez con
  `scripts\guardar-credencial-rafam.bat` (doble clic) y quedan cifrados con la
  cuenta de Windows (`%APPDATA%\formulario-17\rafam-credencial.xml`). Log en
  `logs\rafam-diario.log`. **El bot cierra cualquier Contabilidad.exe abierto
  al arrancar.**
- **Manual**, desde el panel → Datos de RAFAM: subir el `.xls` exportado de
  RAFAM (del día 1 al último día del mes, o hasta hoy). Se interpreta en el
  navegador y reemplaza la foto de ese mes.

## Envío de mails

Los mails (avisos y alertas) se mandan uno por uno a cada suscripto (nadie ve
los mails de los demás), con un enlace de baja al pie y en el encabezado
`List-Unsubscribe`. Proveedor según `MAIL_PROVIDER` (en `[vars]` de
`wrangler.toml`):

- `smtp` (**el configurado**): la casilla institucional
  `dir.presupuesto@moron.gob.ar` en el servidor de correo municipal
  (Zimbra/Postfix, `mail.moron.gob.ar`, puerto 465 con TLS), desde el propio
  Worker (`src/lib/smtp.ts`, sin dependencias). **No sale ningún mail hasta
  que se cargue la contraseña de la casilla como secret:**
  ```bash
  npx wrangler secret put MAIL_SMTP_PASSWORD --name formulario-17
  ```
  Probado contra un servidor SMTP falso local; la conexión real se prueba
  con el primer envío (el servidor tiene que aceptar conexiones al 465 desde
  internet).
- `apps_script`: `scripts/mail_apps_script.gs` publicado como Web App con una
  cuenta de Google (`MAIL_APPS_SCRIPT_URL`, secret `MAIL_TOKEN`).
- `resend`: `RESEND_API_KEY` y `MAIL_FROM`, con dominio verificado.

Sin proveedor completo, los avisos se guardan y se publican en el sitio pero
no se manda nada.

## Desarrollo local

```bash
npm install
npm run db:migrate:local
node scripts/sync-rafamor.mjs              # carga la base local desde RAFAMOR
cp .dev.vars.example .dev.vars              # y completar ADMIN_PASSWORD_HASH / SESSION_SECRET
npm run dev
```

## Deploy (Cloudflare Workers + D1)

El repo está conectado como proyecto de **Workers** (Workers Builds):

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy --no-autoconfig`

`wrangler deploy` sin `--no-autoconfig` confunde la salida de Astro con un
proyecto de Pages y genera un `wrangler.jsonc` que pisa a `wrangler.toml`;
el script `prebuild` borra cualquier `wrangler.jsonc` suelto por si quedó
en la caché del build.

Después de cada cambio de esquema: `npm run db:migrate:remote`. Secrets y
variables: ver el final de `wrangler.toml` (`keep_vars = true` evita que
el deploy borre las variables cargadas en el dashboard).

## Estructura

```
migrations/                 esquema D1 (0002 = datos de RAFAM + lista de difusión)
scripts/sync-rafamor.mjs    RAFAMOR (.xls de RAFAM) -> D1
scripts/mail_apps_script.gs Web App de Google para mandar los avisos
src/lib/rafam-gastos.mjs    parser del reporte de gastos de RAFAM (Node, Worker y navegador)
src/lib/f17.ts              lógica del F17
src/lib/instructivos.ts     contenido de Instructivos
src/lib/mailing.ts          lista de difusión
src/lib/mail-sender.ts      envío de avisos
src/scripts/                JS del navegador (F17 editable, Excel, subida de reportes)
src/pages/                  páginas y API
public/                     logo, foto y tipografías institucionales
```

## Pendiente

- Definir y configurar el proveedor de mail (ver "Envío de mails").
- Programar `scripts\sync-rafamor.bat` en la PC de RAFAMOR.
- Pasar los suscriptos actuales del formulario de Google: exportar sus
  respuestas y cargarlas (o pedirles que se vuelvan a inscribir).
- Las tipografías Neo Sans son las del sistema de Gestión Documental del
  Municipio: confirmar que la licencia cubre su uso web.
- "Recursos Humanos" del Sites estaba vacía y no se migró.
