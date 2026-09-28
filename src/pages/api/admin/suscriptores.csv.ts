import type { APIRoute } from "astro";
import { listarSuscriptores, suscriptoresToCsv } from "../../../lib/mailing";

export const GET: APIRoute = async ({ locals, url }) => {
  const soloActivos = url.searchParams.get("activos") === "1";
  const rows = await listarSuscriptores(locals.runtime.env.DB, soloActivos);
  const hoy = new Date().toISOString().slice(0, 10);
  return new Response(suscriptoresToCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="lista-de-difusion_${soloActivos ? "activos_" : ""}${hoy}.csv"`,
      "cache-control": "no-store",
    },
  });
};
