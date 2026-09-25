import type { APIRoute } from "astro";
import { listarSuscriptores, suscriptoresToCsv } from "../../../lib/mailing";

export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.DB;
  const rows = await listarSuscriptores(db, false);
  const csv = suscriptoresToCsv(rows);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="suscriptores.csv"`,
    },
  });
};
