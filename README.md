# Formulario 17 — Subsecretaría de Planificación Presupuestaria y Estadísticas, Morón

Reemplazo de las páginas de Google Sites de la Subsecretaría de Planificación Presupuestaria y Estadísticas
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
- **Formulario 17** (`/formulario-17`): el F17 prellenado. Los trimestres a
  programar se pueden completar en pantalla (recalcula Disponible, Total
  anual y marca en rojo las partidas excedidas, como la plantilla) y se
  guardan en el navegador. Se descarga en Excel con el formato de la
  plantilla: fórmulas de Disponible y Total anual y formato condicional
  incluidos.
- **Instructivos** (`/instructivos`): PPP, F1, F4/F5, F7, F17 y Ejecutado de
  gastos, con los PDF de Drive y los videos de YouTube del Sites. Se editan
  en `src/lib/instructivos.ts`.
- **Lista de difusión** (`/lista-de-difusion`): alta con los mismos datos que
  el formulario de Google (nombre, secretaría, cargo, programas, teléfono,
  mails) y baja.
- **Panel** (`/admin`, con contraseña): suscriptos (baja/reactivar, CSV),
  avisos masivos con historial, y estado de los datos de RAFAM con subida
  manual de un reporte.

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
- **Manual**, desde el panel → Datos de RAFAM: subir el `.xls` exportado de
  RAFAM (del día 1 al último día del mes, o hasta hoy). Se interpreta en el
  navegador y reemplaza la foto de ese mes.

## Envío de mails

Los avisos masivos se mandan uno por uno (nadie ve los mails de los demás),
con un enlace de baja al pie. Proveedor según `MAIL_PROVIDER`:

- `apps_script` (sin costo): publicar `scripts/mail_apps_script.gs` como Web
  App con la cuenta de Presupuesto (instrucciones en el propio archivo) y
  configurar `MAIL_APPS_SCRIPT_URL` y el secret `MAIL_TOKEN`. Google permite
  100 destinatarios por día con una cuenta @gmail.com y 1.500 con Workspace.
- `resend`: `RESEND_API_KEY` y `MAIL_FROM`, con un dominio verificado en
  Resend.

Sin proveedor, el aviso se guarda como "pendiente" y no se envía nada.

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
