import type { APIRoute } from "astro";
import { hmacHex, timingSafeEqual } from "../../../lib/auth";
import { sincronizarRafamorSql } from "../../../lib/sync-rafamor-sql";

// Lo llama la tarea programada del Worker (worker/index.mjs) con un token
// derivado de SESSION_SECRET. Trae de RAFAMOR SQL el mes en curso y
// reemplaza su foto en rafam_gastos, sin tocar meses ya cerrados con un
// reporte de RAFAM (ver src/lib/sync-rafamor-sql.ts).
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!env.SESSION_SECRET) return new Response("Falta SESSION_SECRET", { status: 500 });
  const esperado = await hmacHex("cron-sync-rafamor", env.SESSION_SECRET);
  if (!timingSafeEqual(request.headers.get("x-cron-token") ?? "", esperado)) return new Response("No autorizado", { status: 401 });

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
