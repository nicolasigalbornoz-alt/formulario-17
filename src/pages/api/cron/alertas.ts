import type { APIRoute } from "astro";
import { hmacHex, timingSafeEqual } from "../../../lib/auth";
import { enviarAlertasDelDia } from "../../../lib/novedades";

// Lo llama la tarea programada diaria del Worker (worker/index.mjs) con un
// token derivado de SESSION_SECRET. Manda las alertas de vencimientos que
// correspondan hoy (cada una sale una sola vez).
export const POST: APIRoute = async ({ request, locals, url }) => {
  const env = locals.runtime.env;
  if (!env.SESSION_SECRET) return new Response("Falta SESSION_SECRET", { status: 500 });
  const esperado = await hmacHex("cron-alertas", env.SESSION_SECRET);
  if (!timingSafeEqual(request.headers.get("x-cron-token") ?? "", esperado)) return new Response("No autorizado", { status: 401 });

  const sitio = (env.SITE_URL || url.origin).replace(/\/$/, "");
  const r = await enviarAlertasDelDia(env, sitio);
  return new Response(JSON.stringify(r), { headers: { "content-type": "application/json; charset=utf-8" } });
};
