import type { APIRoute } from "astro";
import { sincronizarRafamorSql } from "../../../lib/sync-rafamor-sql";

// Botón "Sincronizar ahora" del panel (Datos de RAFAM): la misma
// sincronización que corre sola todos los días, para probarla o para no
// esperar al horario programado. Protegido por el middleware (solo admin).
export const POST: APIRoute = async ({ locals }) => {
  const env = locals.runtime.env;
  try {
    const r = await sincronizarRafamorSql(env.DB, env);
    return new Response(JSON.stringify(r), { headers: { "content-type": "application/json; charset=utf-8" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
};
