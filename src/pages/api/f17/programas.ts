import type { APIRoute } from "astro";
import { listProgramas } from "../../../lib/f17";

export const GET: APIRoute = async ({ url, locals }) => {
  const jurisdiccion = url.searchParams.get("jurisdiccion");
  if (!jurisdiccion) return new Response("Falta jurisdiccion", { status: 400 });
  const db = locals.runtime.env.DB;
  const programas = await listProgramas(db, jurisdiccion);
  return new Response(JSON.stringify(programas), { headers: { "content-type": "application/json" } });
};
