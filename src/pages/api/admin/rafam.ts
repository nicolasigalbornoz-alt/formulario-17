import type { APIRoute } from "astro";
import { escribirMarca, leerMarca } from "../../../lib/sync-rafamor-sql";

// Recibe un reporte de gastos de RAFAM ya interpretado en el navegador
// (src/scripts/admin-datos.ts) y lo carga en rafam_gastos. Llega en dos pasos
// para no pasarse de los 10 ms de CPU del plan gratuito (leer y validar las
// ~3.400 partidas de un mes en un solo pedido cuesta 11-22 ms):
//   1. "lote": de a 250 partidas (~80 KB, 1-3 ms); se validan y se guardan tal cual en rafam_subidas.
//   2. "confirmar": D1 pasa los lotes a rafam_gastos y actualiza rafam_cortes, todo en un batch.
//
// Qué reemplaza:
//  - Si el archivo trae todas las categorías programáticas que ya tiene el mes
//    (el reporte completo), el mes entero.
//  - Si trae solo algunas jurisdicciones o categorías (un reporte filtrado en
//    RAFAM), solo esas: el resto del mes queda como está. Para no mezclar
//    fechas tiene que llegar al mismo día que el resto del mes. Las
//    jurisdicciones que conservaban una foto más vieja (ver
//    sync-rafamor-sql.ts) y quedan completas salen de la marca.
//  - Nunca vuelve atrás: un reporte más viejo que lo ya cargado se rechaza.

const COLS = [
  "jurisdiccion_codigo", "jurisdiccion", "programa_codigo", "programa", "catprog_codigo", "catprog",
  "fuente_codigo", "fuente", "inciso", "partida_codigo", "partida",
  "aprobado", "modificaciones", "vigente", "preventivo", "compromiso", "devengado", "pagado",
];
const TEXTO = 11; // las primeras 11 columnas son texto, el resto importes
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const SUBIDA = /^[0-9a-f-]{36}$/;
const MAX_LOTE = 1000;
const MAX_FILAS = 20000;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const CREAR_SUBIDAS = `CREATE TABLE IF NOT EXISTS rafam_subidas (
  subida    TEXT NOT NULL,
  lote      INTEGER NOT NULL,
  filas     TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (subida, lote)
)`;

// Las partidas de una subida (?3), en el orden de COLS.
const DE_LA_SUBIDA = "FROM rafam_subidas s, json_each(s.filas) j WHERE s.subida = ?3";
const INSERTAR = `INSERT INTO rafam_gastos (anio, mes, ${COLS.join(", ")})
  SELECT ?1, ?2, ${COLS.map((_, i) => `json_extract(j.value, '$[${i}]')`).join(", ")} ${DE_LA_SUBIDA}`;
const PAR = (j: string, c: string) => `${j} || '|' || ${c}`;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const fecha = (iso: string) => iso.split("-").reverse().join("/");
const categorias = (n: number) => `${n} ${n === 1 ? "categoría" : "categorías"}`;

export const POST: APIRoute = async ({ request, locals }) => {
  const texto = await request.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(texto);
  } catch {
    return json(400, { error: "El cuerpo no es JSON." });
  }
  const db = locals.runtime.env.DB;
  if (body.paso === "lote") return lote(db, texto, body);
  if (body.paso === "confirmar") return confirmar(db, body);
  return json(400, { error: "Recargá la página: cambió la forma de subir los reportes." });
};

async function lote(db: D1Database, texto: string, body: Record<string, unknown>): Promise<Response> {
  const { subida, lote: n, columnas, filas } = body;
  if (typeof subida !== "string" || !SUBIDA.test(subida) || !Number.isInteger(n) || (n as number) < 0 || (n as number) >= MAX_FILAS / 100) {
    return json(400, { error: "Lote inválido." });
  }
  if (JSON.stringify(columnas) !== JSON.stringify(COLS)) return json(400, { error: "Columnas inesperadas." });
  if (!Array.isArray(filas) || filas.length === 0 || filas.length > MAX_LOTE) return json(400, { error: "Cantidad de filas inválida." });
  for (const f of filas) {
    const ok =
      Array.isArray(f) &&
      f.length === COLS.length &&
      f.every((v, i) => (i < TEXTO ? typeof v === "string" && v.length <= 300 : typeof v === "number" && Number.isFinite(v)));
    if (!ok) return json(400, { error: "Hay filas con formato inválido." });
  }
  // Se guarda el texto tal como llegó (json_extract saca las filas): sin volver a armar el JSON acá.
  await db.batch([
    db.prepare(CREAR_SUBIDAS),
    db.prepare("DELETE FROM rafam_subidas WHERE creado_en < datetime('now', '-1 day')"),
    db.prepare("INSERT OR REPLACE INTO rafam_subidas (subida, lote, filas) VALUES (?1, ?2, json_extract(?3, '$.filas'))").bind(subida, n, texto),
  ]);
  return json(200, { ok: true });
}

interface Par {
  j: string;
  c: string;
  nombre: string | null;
}

async function confirmar(db: D1Database, body: Record<string, unknown>): Promise<Response> {
  const p = (body.periodo ?? {}) as { anio?: unknown; mes?: unknown; desde?: unknown; hasta?: unknown; mesCompleto?: unknown };
  const anio = Number(p.anio);
  const mes = Number(p.mes);
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100 || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    return json(400, { error: "Período inválido." });
  }
  const aaaamm = `${anio}-${String(mes).padStart(2, "0")}`;
  const { desde, hasta } = p;
  if (typeof desde !== "string" || typeof hasta !== "string" || !FECHA.test(desde) || !FECHA.test(hasta)) {
    return json(400, { error: "Fechas del período inválidas." });
  }
  if (desde !== `${aaaamm}-01` || hasta.slice(0, 7) !== aaaamm || hasta < desde) return json(400, { error: "El período no es de un solo mes." });
  const { subida, lotes, filas } = body;
  if (typeof subida !== "string" || !SUBIDA.test(subida) || !Number.isInteger(lotes) || !Number.isInteger(filas) || (filas as number) > MAX_FILAS) {
    return json(400, { error: "Subida inválida." });
  }
  const archivo = String(body.archivo ?? "").slice(0, 200);
  // Un rechazo descarta los lotes: cada intento del navegador es una subida nueva.
  const rechazo = async (error: string) => {
    await db.prepare("DELETE FROM rafam_subidas WHERE subida = ?1").bind(subida).run();
    return json(409, { error });
  };

  const [, recibido, deLaSubida, delMes, corteRes, ultimoMes] = await db.batch([
    db.prepare(CREAR_SUBIDAS),
    db.prepare("SELECT COUNT(*) AS lotes, COALESCE(SUM(json_array_length(filas)), 0) AS filas FROM rafam_subidas WHERE subida = ?1").bind(subida),
    db
      .prepare(
        `SELECT json_extract(j.value, '$[0]') AS j, json_extract(j.value, '$[4]') AS c, MAX(json_extract(j.value, '$[1]')) AS nombre
         ${DE_LA_SUBIDA.replace("?3", "?1")} GROUP BY 1, 2`
      )
      .bind(subida),
    db
      .prepare("SELECT jurisdiccion_codigo AS j, catprog_codigo AS c, MAX(jurisdiccion) AS nombre FROM rafam_gastos WHERE anio = ?1 AND mes = ?2 GROUP BY 1, 2")
      .bind(anio, mes),
    db.prepare("SELECT hasta, archivo FROM rafam_cortes WHERE anio = ?1 AND mes = ?2").bind(anio, mes),
    // Las jurisdicciones del último mes cargado: un mes nuevo tiene que traerlas todas.
    db.prepare(
      `SELECT DISTINCT g.jurisdiccion_codigo AS j, g.jurisdiccion AS nombre FROM rafam_gastos g
       JOIN (SELECT anio, mes FROM rafam_cortes ORDER BY anio DESC, mes DESC LIMIT 1) u ON u.anio = g.anio AND u.mes = g.mes`
    ),
  ]);
  const llegaron = recibido.results[0] as { lotes: number; filas: number };
  if (llegaron.lotes !== lotes || llegaron.filas !== filas) {
    return rechazo(`No llegaron todas las partidas (${llegaron.filas} de ${filas}): volvé a subir el archivo.`);
  }

  const nombreMes = `${MESES[mes - 1]} de ${anio}`;
  const corte = corteRes.results[0] as { hasta: string; archivo: string | null } | undefined;
  if (corte && hasta < corte.hasta) {
    return rechazo(
      `${nombreMes[0].toUpperCase()}${nombreMes.slice(1)} ya está cargado al ${fecha(corte.hasta)} y este reporte llega al ${fecha(hasta)}: no se carga, para no volver atrás.`
    );
  }

  const pares = deLaSubida.results as unknown as Par[];
  const enArchivo = new Set(pares.map((x) => `${x.j}|${x.c}`));
  const enMes = delMes.results as unknown as Par[];
  // Categorías que el mes ya tiene y el archivo no trae: si hay, es un reporte filtrado.
  const faltan = enMes.filter((x) => !enArchivo.has(`${x.j}|${x.c}`));
  const nombres = new Map([...enMes, ...pares].map((x) => [x.j, x.nombre ?? x.j]));
  const lista = (js: string[], max = js.length) =>
    js.slice(0, max).map((j) => nombres.get(j) ?? j).join(", ") + (js.length > max ? ` y ${js.length - max} más` : "");

  if (enMes.length === 0) {
    const jurArchivo = new Set(pares.map((x) => x.j));
    const sinTraer = (ultimoMes.results as unknown as Par[]).filter((x) => !jurArchivo.has(x.j));
    if (sinTraer.length) {
      for (const x of sinTraer) nombres.set(x.j, x.nombre ?? x.j);
      return rechazo(
        `${nombreMes[0].toUpperCase()}${nombreMes.slice(1)} todavía no tiene datos: para empezarlo subí el reporte de todas las jurisdicciones (a este le faltan ${lista(sinTraer.map((x) => x.j), 4)}).`
      );
    }
  }

  if (faltan.length === 0) {
    // El reporte completo: reemplaza el mes entero.
    const mesCompleto = Number(hasta.slice(8)) === new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    await db.batch([
      db.prepare("DELETE FROM rafam_gastos WHERE anio = ?1 AND mes = ?2").bind(anio, mes),
      db.prepare(INSERTAR).bind(anio, mes, subida),
      db
        .prepare(
          `INSERT OR REPLACE INTO rafam_cortes (anio, mes, desde, hasta, mes_completo, filas, archivo, origen, cargado_en)
           VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COUNT(*) FROM rafam_gastos WHERE anio = ?1 AND mes = ?2), ?6, 'panel', datetime('now'))`
        )
        .bind(anio, mes, desde, hasta, mesCompleto ? 1 : 0, archivo),
      db.prepare("DELETE FROM rafam_subidas WHERE subida = ?1").bind(subida),
    ]);
    const jurs = new Set(pares.map((x) => x.j)).size;
    return json(200, {
      mensaje: `Listo: ${nombreMes} quedó al ${fecha(hasta)} con este reporte (${(filas as number).toLocaleString("es-AR")} partidas de ${jurs} jurisdicciones).`,
    });
  }

  // Un reporte filtrado: reemplaza solo las categorías que trae.
  if (!corte) return rechazo(`${nombreMes} tiene datos sin fecha de corte: subí el reporte de todas las jurisdicciones.`);
  if (hasta !== corte.hasta) {
    const ej = faltan.slice(0, 3).map((x) => `${nombres.get(x.j) ?? x.j} ${x.c}`).join("; ");
    return rechazo(
      `Este reporte trae solo una parte de ${nombreMes} (no trae ${categorias(faltan.length)} que el mes ya tiene, por ejemplo ${ej}) ` +
        `y llega al ${fecha(hasta)}, pero el resto del mes está al ${fecha(corte.hasta)}. Exportalo hasta el ${fecha(corte.hasta)}, ` +
        `o subí el reporte de todas las jurisdicciones para adelantar el mes.`
    );
  }
  // Las que conservaban una foto más vieja y ahora quedan enteras con este reporte salen de la marca.
  const marca = leerMarca(corte.archivo);
  const siguen = marca ? marca.jurisdicciones.filter((j) => faltan.some((x) => x.j === j)) : [];
  const archivoNuevo = marca ? (siguen.length ? escribirMarca({ hasta: marca.hasta, jurisdicciones: siguen }) : null) : corte.archivo;
  await db.batch([
    db
      .prepare(
        `DELETE FROM rafam_gastos WHERE anio = ?1 AND mes = ?2
           AND ${PAR("jurisdiccion_codigo", "catprog_codigo")} IN (SELECT ${PAR("json_extract(j.value, '$[0]')", "json_extract(j.value, '$[4]')")} ${DE_LA_SUBIDA})`
      )
      .bind(anio, mes, subida),
    db.prepare(INSERTAR).bind(anio, mes, subida),
    db
      .prepare(
        `UPDATE rafam_cortes SET filas = (SELECT COUNT(*) FROM rafam_gastos WHERE anio = ?1 AND mes = ?2), archivo = ?3, cargado_en = datetime('now')
         WHERE anio = ?1 AND mes = ?2`
      )
      .bind(anio, mes, archivoNuevo),
    db.prepare("DELETE FROM rafam_subidas WHERE subida = ?1").bind(subida),
  ]);
  const jurs = [...new Set(pares.map((x) => x.j))];
  const salieron = marca ? marca.jurisdicciones.filter((j) => !siguen.includes(j)) : [];
  return json(200, {
    mensaje:
      `Listo: en ${nombreMes} (al ${fecha(hasta)}) ${pares.length === 1 ? "se reemplazó" : "se reemplazaron"} ${categorias(pares.length)} de ${lista(jurs)}; el resto del mes quedó como estaba.` +
      (salieron.length ? ` Ya están al ${fecha(hasta)}: ${lista(salieron)}.` : "") +
      (siguen.length ? ` Siguen con datos al ${fecha(marca!.hasta)}: ${lista(siguen)}.` : ""),
  });
}
