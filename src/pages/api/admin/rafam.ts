import type { APIRoute } from "astro";

// Recibe un reporte de gastos de RAFAM ya interpretado en el navegador
// (src/scripts/admin-datos.ts) y reemplaza la foto de ese mes.

const COLS = [
  "jurisdiccion_codigo", "jurisdiccion", "programa_codigo", "programa", "catprog_codigo", "catprog",
  "fuente_codigo", "fuente", "inciso", "partida_codigo", "partida",
  "aprobado", "modificaciones", "vigente", "preventivo", "compromiso", "devengado", "pagado",
];
const TEXTO = 11; // las primeras 11 columnas son texto, el resto importes
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

export const POST: APIRoute = async ({ request, locals }) => {
  let body: {
    archivo?: unknown;
    periodo?: { anio?: unknown; mes?: unknown; desde?: unknown; hasta?: unknown; mesCompleto?: unknown };
    columnas?: unknown;
    filas?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "El cuerpo no es JSON." });
  }

  const p = body.periodo ?? {};
  const anio = Number(p.anio);
  const mes = Number(p.mes);
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100 || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    return json(400, { error: "Período inválido." });
  }
  if (typeof p.desde !== "string" || typeof p.hasta !== "string" || !FECHA.test(p.desde) || !FECHA.test(p.hasta)) {
    return json(400, { error: "Fechas del período inválidas." });
  }
  if (JSON.stringify(body.columnas) !== JSON.stringify(COLS)) return json(400, { error: "Columnas inesperadas." });
  if (!Array.isArray(body.filas) || body.filas.length === 0 || body.filas.length > 20000) {
    return json(400, { error: "Cantidad de filas inválida." });
  }
  for (const f of body.filas) {
    const ok =
      Array.isArray(f) &&
      f.length === COLS.length &&
      f.every((v, i) => (i < TEXTO ? typeof v === "string" && v.length <= 300 : typeof v === "number" && Number.isFinite(v)));
    if (!ok) return json(400, { error: "Hay filas con formato inválido." });
  }
  const archivo = String(body.archivo ?? "").slice(0, 200);
  const filas = body.filas as unknown[][];

  const db = locals.runtime.env.DB;
  const extraer = COLS.map((_, i) => `json_extract(value, '$[${i}]')`).join(", ");
  const insertar = db.prepare(
    `INSERT INTO rafam_gastos (anio, mes, ${COLS.join(", ")}) SELECT ?1, ?2, ${extraer} FROM json_each(?3)`
  );
  // Lotes de ~600 filas: cada parámetro JSON queda muy por debajo del límite de D1.
  const lotes = [];
  for (let i = 0; i < filas.length; i += 600) lotes.push(insertar.bind(anio, mes, JSON.stringify(filas.slice(i, i + 600))));

  await db.batch([
    db.prepare("DELETE FROM rafam_gastos WHERE anio = ? AND mes = ?").bind(anio, mes),
    ...lotes,
    db
      .prepare(
        `INSERT OR REPLACE INTO rafam_cortes (anio, mes, desde, hasta, mes_completo, filas, archivo, origen, cargado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'panel', datetime('now'))`
      )
      .bind(anio, mes, p.desde, p.hasta, p.mesCompleto ? 1 : 0, filas.length, archivo),
  ]);

  const mesTxt = `${String(mes).padStart(2, "0")}/${anio}`;
  return json(200, { mensaje: `Listo: ${filas.length.toLocaleString("es-AR")} partidas cargadas para ${mesTxt} (al ${p.hasta.split("-").reverse().join("/")}).` });
};
