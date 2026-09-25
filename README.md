# Formulario 17 — Presupuesto Morón

Reemplazo de las páginas de Google Sites de la Dirección de Presupuesto
(`presupuestomoron/formulario-17/programas` y su equivalente por categoría
programática). Reemplaza también el loop de AppScript que generaba un Excel
por combinación y el paso de Looker Studio: ahora todo se sirve desde una
base SQL propia y el Excel es solo una opción de descarga sobre esos mismos
datos.

## Stack

- **[Astro](https://astro.build)** (SSR) + **[Cloudflare Pages](https://pages.cloudflare.com)** — mismo tipo de
  hosting que ya usa [RAFAMOR](https://rafamor.pages.dev).
- **Cloudflare D1** (SQL/SQLite) como base de datos.
- Sin frameworks de frontend pesados: HTML + CSS + un poco de JS vanilla.

## Modelo de datos

Ver `migrations/0001_init.sql`. Reconstruido a partir de las fórmulas reales
de las planillas "registros f17" (hojas `basevig` / `añoant` / `vigente` /
`datos`):

- Una fila de `ejecucion` = una partida, en una fuente, un programa (y
  opcionalmente una categoría programática), una jurisdicción, un año y un
  trimestre. `trim = 0` es el snapshot inicial del ejercicio; `trim = 1..4`
  es lo comprometido/devengado en ESE trimestre puntual (no acumulado).
- **Crédito vigente** = el `vigente` de la fila con el mayor `trim` cargado
  para ese filtro en el año en curso — es decir, "al último día disponible
  de información", sin selector de trimestre. Esto es intencionalmente
  distinto de la planilla vieja, que usaba `trimestre_seleccionado - 1`.
- **Compromiso** se agrupa sumando por trimestre + partida + fuente +
  programa (y categoría programática cuando se filtra por una en particular;
  si no, se suma across todas las categorías del programa).
- La vista "por programa" y "por categoría programática" son la misma
  consulta (`src/lib/f17.ts`): la categoría es simplemente un filtro
  adicional, opcional, anidado dentro de programa.

La lógica está validada contra los valores reales de las planillas que se
usaron para reconstruirla (ver commits/PR para el detalle).

## Desarrollo local

```bash
npm install

# Base local (SQLite emulado por wrangler, no toca Cloudflare)
npm run db:migrate:local

# Cargar datos de prueba desde un .xlsx con el formato de siempre
# (trim/jurisdicción/programa/categoría/fuente/partida/aprobado/vigente/compromiso/devengado)
node scripts/import-xlsx.mjs mi_archivo.xlsx            # auto-detecta hojas con nombre de año (2024/2025/2026)
node scripts/import-xlsx.mjs mi_archivo.xlsx --sheet=basevig --anio=2026
npx wrangler d1 execute f17_db --local --file scripts/out/mi_archivo.<hoja>.sql

# Secrets para el panel admin en desarrollo (crear .dev.vars, no se commitea)
cat > .dev.vars <<'EOF'
ADMIN_PASSWORD_HASH=<sha256 de tu contraseña>
SESSION_SECRET=<cualquier string random>
EOF
# Para generar el hash: node -e "console.log(require('crypto').createHash('sha256').update('TU_PASSWORD').digest('hex'))"

npm run dev
```

## Desplegar en Cloudflare Pages

1. En el dashboard de Cloudflare → Pages → **conectar este repositorio de
   GitHub**. Build command: `npm run build`. Output directory: `dist`.
2. Crear la base real: `npx wrangler d1 create f17_db`, y pegar el
   `database_id` que te devuelve en `wrangler.toml`.
3. Aplicar el esquema en producción: `npm run db:migrate:remote`.
4. Cargar los datos históricos igual que en local pero con `--remote` en vez
   de `--local` (ver arriba), o usar el panel admin (`/admin/importar`) una
   vez desplegado.
5. Configurar los secrets del proyecto en Pages → Settings → Environment
   variables (como secret, no como var):
   - `ADMIN_PASSWORD_HASH` — hash sha-256 de la contraseña del panel admin.
   - `SESSION_SECRET` — string random para firmar la cookie de sesión.
   - `MAIL_PROVIDER_API_KEY` — **pendiente**: falta definir si el envío de
     avisos masivos va a usar la cuenta de Gmail institucional o un servicio
     transaccional externo. Hasta entonces, `/admin/avisos` guarda el aviso
     y la lista de destinatarios pero no envía nada (lo dice explícitamente
     en el panel).
6. En la base D1 real, vincular el binding `DB` al Pages project (Settings →
   Functions → D1 database bindings), variable `DB` → `f17_db`.

## Estructura

```
migrations/0001_init.sql        esquema D1
scripts/import-xlsx.mjs         importador de línea de comandos (.xlsx -> .sql)
src/lib/registros.mjs           parseo compartido de las planillas (CLI + panel admin)
src/lib/f17.ts                  lógica del Formulario 17 (crédito vigente, compromiso, etc.)
src/lib/auth.ts                 sesión del panel admin
src/lib/mailing.ts              suscriptores
src/lib/mail-sender.ts          envío de avisos masivos (enchufable, ver arriba)
src/pages/formulario-17.astro   página pública del F17 (programa + categoría combinados)
src/pages/mailing.astro         alta/baja de suscriptos
src/pages/instructivos/         guías (contenido a cargar por la Dirección)
src/pages/admin/                panel: suscriptos + CSV, avisos masivos, carga de datos
```

## Pendiente / a definir

- **Estética real**: se aplicó una aproximación (paleta roja/azul-negro,
  tipografía Archivo Black + Inter, patrones de hero/tarjetas) reconstruida
  a partir de capturas de pantalla del sistema interno de referencia
  (`sde_v2`), porque ese sistema vive en una IP privada (10.1.1.111) a la
  que este entorno no tiene acceso de red. Faltan las fotos institucionales
  reales (se usa un degradé como placeholder) y confirmar la fuente exacta.
- **Envío de mailing masivo**: falta decidir el proveedor (Gmail
  institucional vs. servicio transaccional) — ver `src/lib/mail-sender.ts`.
- **Contenido de instructivos**: la estructura está armada (4 guías) pero el
  texto/PDF real de cada una lo tiene que cargar la Dirección de Presupuesto.
- **Ingesta de datos recurrente**: por ahora es manual (subir el .xlsx del
  export de RAFAM por el panel admin), igual que hoy. Si en algún momento
  RAFAM/RAFAMOR exponen una API, `src/lib/import-registros.ts` es el punto
  para automatizarlo.
