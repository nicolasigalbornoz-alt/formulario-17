import type { APIRoute } from "astro";
import { d1, getCorte } from "../../lib/f17";
import { ultimasCorridas } from "../../lib/sync-rafamor-sql";

// Estado público de los datos (sin importes): hasta qué día hay información y
// cómo salieron las últimas sincronizaciones con RAFAMOR SQL. Sirve para
// controlar desde afuera que la tarea programada esté funcionando.
export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.DB;
  const [corte, corridas] = await Promise.all([getCorte(d1(db)), ultimasCorridas(db, 10)]);
  return new Response(
    JSON.stringify(
      {
        datosAl: corte?.hasta ?? null,
        mesesCompletos: corte ? { anio: corte.anio, meses: corte.mesesCompletos } : null,
        corridas: corridas.map(({ inicio, fin, origen, estado, anio, mes, hasta, filas, detalle }) => ({
          inicio,
          fin,
          origen,
          estado,
          mes: anio && mes ? `${anio}-${String(mes).padStart(2, "0")}` : null,
          hasta,
          filas,
          detalle,
        })),
      },
      null,
      2
    ),
    { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }
  );
};
