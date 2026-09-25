import type { APIRoute } from "astro";
import { listFuentes } from "../../../lib/f17";

export const GET: APIRoute = async ({ url, locals }) => {
  const jurisdiccion = url.searchParams.get("jurisdiccion");
  const programa = url.searchParams.get("programa");
  const catprog = url.searchParams.get("catprog");
  if (!jurisdiccion || !programa) return new Response("Falta jurisdiccion/programa", { status: 400 });
  const db = locals.runtime.env.DB;
  const fuentes = await listFuentes(db, jurisdiccion, programa, catprog);
  return new Response(JSON.stringify(fuentes), { headers: { "content-type": "application/json" } });
};
