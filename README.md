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
| Macro `.xlsm` que sumaba los F17 de cada categoría | «Unificar categorías»: se suben los Excel completos de cada categoría y devuelve uno solo del programa, con el mismo formato |
| Formulario de Google "inscripción" | Lista de difusión propia, con panel para exportar CSV y mandar avisos |
| Google Calendar embebidos en el Sites | Calendario propio con las fechas que carga el administrador (y alertas por mail) |

El sitio usa la estética del sistema interno de Gestión Documental del
Municipio (sde_v2): paleta, tipografías Neo Sans, header, hero, tarjetas y
login.

## Qué hay en el sitio

La página principal (`/`) es el inicio de sesión, y todo lo demás pide
usuario: cualquier página sin sesión lleva ahí (y después de ingresar vuelve
a la que se pidió). Al ingresar, cada secretaría va directo a su
**Formulario 17** y el administrador al **inicio** (`/inicio`, solo para
administradores). «Salir» vuelve al inicio de sesión. Solo quedan abiertos
el ingreso, la baja de la lista de difusión (el enlace de los mails) y la
tarea programada de alertas. `/ingresar` redirige a `/` (enlaces viejos).

- **Inicio** (`/inicio`, administrador): accesos, avisos, el calendario de
  entregas y contacto.
- **Calendario** (`/calendario`): propio, reemplaza a los Google Calendar del
  Sites. Tres meses con los plazos y vencimientos que carga el
  administrador, en colores por tipo (formularios trimestrales, anuales,
  otros).
- **Formulario 17** (`/formulario-17`), en tres pestañas:
  - **Descargar prellenado**: se elige jurisdicción, programa, fuente y
    trimestre, y el formulario aparece recién con «Ver formulario».
    - **Trimestre a cargar**: solo entre los que tienen cerrados todos los
      trimestres anteriores del año (sus tres meses cargados completos desde
      RAFAM). Por defecto, el último disponible.
    - Dos carriles con un switch: **por programa** (lo que se carga en
      RAFAM) o **por categoría programática**, que avisa que hay que
      consolidarla con las demás categorías del programa (el Excel lo repite
      arriba).
    - La página no guarda nada de lo que se programa: un solo botón descarga
      el Excel con el formato de la plantilla (trimestres a programar vacíos,
      fórmula de Total anual, formato condicional).
  - **Unificar categorías** (`/formulario-17/unificar`): se suben los Excel
    ya completos de cada categoría de un programa y devuelve un solo Excel
    del programa, con el mismo formato, listo para cargar en RAFAM. Controla
    que sean de la misma jurisdicción, programa, fuente y trimestre, que no
    haya categorías repetidas y avisa si falta alguna. Los archivos se leen
    en el navegador: no se suben ni se guardan.
  - **Avance de carga** (`/formulario-17/avance`): por trimestre, qué
    programas ya se cargaron en RAFAM; cada secretaría marca los suyos.
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
  muestran en el calendario y arriba del F17. Pueden ser un plazo
  («desde» opcional → «vence») y tienen un tipo (formularios trimestrales,
  anuales u otros) que les da el color en el calendario. La migración `0005`
  trae las fechas que estaban en los Google Calendar del Sites. Cada una manda alertas por mail a
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
  pendientes. Las secretarías marcan sus programas como cargados en
  Formulario 17 → Avance de carga.

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
| **Disponible** | `G − M` | **el disponible de RAFAM al último dato**: vigente − preventivo − compromiso acumulados del año (el mismo cálculo del reporte de RAFAM) |
| Total anual | `SUM(H:K)` | ídem (fórmula en el Excel) |
| Rojo | `M > G` | disponible negativo o total anual mayor al vigente |

Sin categoría elegida, el programa es la suma de todas sus categorías.

El F17 anticipa la ejecución: el trimestre que se carga y los siguientes van
vacíos para programarlos, y no se muestra nada del compromiso de esos
trimestres (ya no está la columna «Ya comprometido»). Lo que ya se reservó o
comprometió en el año está dentro del disponible.

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

Hay tres formas de cargar los datos. Las tres escriben la misma tabla y
ninguna vuelve atrás: un mes solo se reemplaza con una foto más nueva (o, a
igual fecha, con el reporte completo de RAFAM, que trae además
aprobado/modificaciones/preventivo). Un mes ya cerrado no se pisa nunca.

- **Automática en la nube** (la que corre siempre, sin depender de ninguna
  PC): cada 30 minutos, una tarea programada del Worker (`wrangler.toml` →
  `[triggers]`, `worker/index.mjs`) consulta **RAFAMOR SQL**
  (`https://rafamor-sql.pages.dev`, la base de lectura que regenera RAFAMOR a
  diario con lo que baja de RAFAM) y trae **un mes por corrida**: el más
  reciente de los últimos 12 que allá tenga una foto más nueva que la
  cargada (el mes en curso, o uno que quedó parcial o sin cargar). Así se
  cierran solos los trimestres y se habilita el siguiente en el F17. Ver
  `src/lib/sync-rafamor-sql.ts` para el detalle y sus límites:
  - **Límites del plan gratuito de Cloudflare.** Cada ejecución del Worker
    tiene 10 ms de CPU: armar un mes en JavaScript lleva ~35 ms y Cloudflare
    cortaba la corrida sin escribir nada (por eso septiembre seguía al 24/09).
    Ahora el mes se arma dentro de la consulta a RAFAMOR SQL (solo códigos e
    importes) y esa respuesta pasa sin leer a D1, que la recorre con
    `json_each`: al Worker le quedan ~2 ms. D1 admite 100.000 filas escritas
    por día y reemplazar un mes son ~20.000, así que se reemplazan como
    máximo 3 meses por día.
  - **Control**: cada corrida queda en la tabla `rafam_sync` (se crea sola).
    Las últimas se ven en el panel → Datos de RAFAM, y sin usuario en
    `/api/estado` (solo fechas y estados, sin importes). Una corrida que
    quedó "corriendo" la cortó Cloudflare.
  - **RAFAMOR SQL tiene el error del parser de RAFAMOR de abajo (1)**: no
    tiene ningún programa sin actividades (NN.00.00) y los suma a la
    categoría anterior. Verificado: Control Comunal 01.18.00 en RAFAMOR SQL a
    junio/2026 = 01.18.00 + 17.00.00 de la planilla "registros f17"
    ($1.012.164.037). Afecta a 6 jurisdicciones (Control Comunal, Tránsito,
    Servicios de la Deuda, Jefatura de Gabinete, Educación, Planificación).
    Si el mes que se reemplaza tiene alguno de esos programas para una
    jurisdicción, esa jurisdicción conserva su foto anterior (el reporte de
    RAFAM) y el resto se actualiza. El F17 de esa jurisdicción avisa hasta qué
    día llegan sus datos. Cuando RAFAMOR SQL traiga esos programas (parser
    corregido), el mes se reemplaza solo en la corrida siguiente.
  - No trae `aprobado`/`modificaciones`/`preventivo` (esa API no los tiene):
    quedan en 0 hasta que un reporte completo (manual o `sync-rafamor.mjs`)
    reemplace la foto de ese mes. El "disponible" de un mes solo sincronizado
    por esta vía, entonces, no resta preventivo.
  - La jurisdicción llega solo por nombre; se resuelve contra la tabla de
    `migrations/0003_usuarios.sql` (`JURISDICCION_CODIGO_POR_NOMBRE`). Una
    jurisdicción nueva que no esté ahí se omite (avisado en el panel).
  - Los nombres de jurisdicción, programa, categoría y fuente se toman de los
    que ya tenga la base de los reportes completos. Si no hay, se usan el de
    RAFAMOR SQL, "Actividad Central" para el 01 y los de las planillas
    "registros f17" para las fuentes 110/131/132/133. Lo que quede sin nombre
    se muestra como "Programa NN" / "Fuente NNN".
  - Necesita los secrets `RAFAMOR_CF_CLIENT_ID` / `RAFAMOR_CF_CLIENT_SECRET`
    (el token de servicio de Cloudflare Access que entrega quien administra
    RAFAMOR). Desde el panel se puede disparar a mano con "Sincronizar ahora".
- **Descarga + carga diaria en una PC con RAFAM** (la que usa la
  Subsecretaría). Es la que trae los datos al día mientras la nube de RAFAMOR
  SQL está pausada (desde el 02/10/2026 por el límite del plan gratis de
  Turso, según su tabla `_actualizacion`). Se instala con **doble clic en
  `scripts\instalar-tareas.bat`**: controla Node.js, autoriza la PC en
  Cloudflare (`npx wrangler login`), ubica el bot de RAFAMOR y guarda el
  usuario y la clave de RAFAM. Después crea la tarea *Presupuesto - Bajar
  RAFAM y actualizar la pagina*, de lunes a viernes a las 07:45 y 19:00
  (solo con la sesión iniciada), y ofrece correrla en ese momento. La tarea
  corre `scripts\rafam-diario.ps1`: baja de RAFAM los reportes mensuales de
  gastos con el bot de RAFAMOR (`rafam_ejecutado_bg.py --periodo mes --tipo
  gastos`) y después `node scripts/sync-rafamor.mjs --remote`. La clave de
  RAFAM queda cifrada con la cuenta de Windows
  (`%APPDATA%\formulario-17\rafam-credencial.xml`). Logs en
  `logs\rafam-diario.log` y `logs\sync-rafamor.log`. **El bot cierra
  cualquier Contabilidad.exe abierto al arrancar.** A diferencia del sync en
  la nube, trae el reporte completo: aprobado/modificaciones/preventivo y los
  programas sin actividades separados, así que también completa las
  jurisdicciones que la nube conserva.
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
  npx wrangler secret put MAIL_SMTP_PASSWORD --name presupuesto
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

El repo está conectado como proyecto de **Workers** (Workers Builds), con el
Worker llamado **`presupuesto`** (`name` en `wrangler.toml`, que tiene que
coincidir con el del dashboard). URL: https://presupuesto.moron-presupuesto.workers.dev
(la vieja `formulario-17.…workers.dev` dejó de existir al renombrarlo).

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
scripts/sync-rafamor.mjs    RAFAMOR (.xls de RAFAM) -> D1, corrido a mano o en la PC de RAFAMOR
src/lib/sync-rafamor-sql.ts sync automático en la nube: RAFAMOR SQL -> D1 (tarea programada)
scripts/mail_apps_script.gs Web App de Google para mandar los avisos
src/lib/rafam-gastos.mjs    parser del reporte de gastos de RAFAM (Node, Worker y navegador)
src/lib/f17.ts              lógica del F17
src/lib/novedades.ts        avisos, fechas del calendario y alertas por mail
src/components/Calendario.astro  calendario de entregas del inicio
src/lib/instructivos.ts     contenido de Instructivos
src/lib/mailing.ts          lista de difusión
src/lib/mail-sender.ts      envío de avisos
src/scripts/                JS del navegador (filtros y Excel del F17, unificador, subida de reportes)
src/pages/                  páginas y API
public/                     logo, foto y tipografías institucionales
```

## Pendiente

- Los accesos directos o marcadores creados con el nombre anterior
  («…Estadísticas») guardan ese nombre en la PC de cada uno: hay que
  borrarlos y volver a crearlos desde el sitio (el sitio ya se publica como
  «Subsecretaría de Planificación Presupuestaria y Estadística»).
- Definir y configurar el proveedor de mail (ver "Envío de mails").
- Cargar los secrets `RAFAMOR_CF_CLIENT_ID` / `RAFAMOR_CF_CLIENT_SECRET` en
  el dashboard (Workers → formulario-17 → Settings → Variables and Secrets,
  tipo **Secret**) para activar el sync automático con RAFAMOR SQL.
- Pasar los suscriptos actuales del formulario de Google: exportar sus
  respuestas y cargarlas (o pedirles que se vuelvan a inscribir).
- Las tipografías Neo Sans son las del sistema de Gestión Documental del
  Municipio: confirmar que la licencia cubre su uso web.
- "Recursos Humanos" del Sites estaba vacía y no se migró.
