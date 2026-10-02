import type { APIRoute } from "astro";
import { d1, getCorte } from "../../lib/f17";
import { conCredenciales, credencialesFaltantes, ultimasCorridas } from "../../lib/sync-rafamor-sql";

// Estado público de los datos (sin importes): hasta qué día hay información y
// cómo salieron las últimas sincronizaciones con RAFAMOR SQL. Sirve para
// controlar desde afuera que la tarea programada esté funcionando.
export const GET: APIRoute = async ({ locals }) => {
  const env = locals.runtime.env;
  const db = env.DB;
  const [corte, corridas, creds, cortes] = await Promise.all([
    getCorte(d1(db)),
    ultimasCorridas(db, 10),
    conCredenciales(db, env),
    // De dónde salió la foto de los últimos meses: rafamor_sql (nube), sync (PC con RAFAM) o panel.
    db
      .prepare("SELECT anio, mes, hasta, mes_completo, origen, cargado_en FROM rafam_cortes ORDER BY anio DESC, mes DESC LIMIT 4")
      .all<{ anio: number; mes: number; hasta: string; mes_completo: number; origen: string; cargado_en: string }>(),
  ]);
  return new Response(
    JSON.stringify(
      {
        datosAl: corte?.hasta ?? null,
        // Solo si están cargadas, nunca sus valores.
        credencialesFaltantes: credencialesFaltantes(creds),
        mesesCompletos: corte ? { anio: corte.anio, meses: corte.mesesCompletos } : null,
        ultimosMeses: (cortes.results ?? []).map((c) => ({
          mes: `${c.anio}-${String(c.mes).padStart(2, "0")}`,
          hasta: c.hasta,
          completo: Boolean(c.mes_completo),
          origen: c.origen,
          cargadoEn: c.cargado_en,
        })),
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
