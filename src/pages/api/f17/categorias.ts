import type { APIRoute } from "astro";
import { listCategoriasProgramaticas } from "../../../lib/f17";

export const GET: APIRoute = async ({ url, locals }) => {
  const jurisdiccion = url.searchParams.get("jurisdiccion");
  const programa = url.searchParams.get("programa");
  if (!jurisdiccion || !programa) return new Response("Falta jurisdiccion/programa", { status: 400 });
  const db = locals.runtime.env.DB;
  const categorias = await listCategoriasProgramaticas(db, jurisdiccion, programa);
  return new Response(JSON.stringify(categorias), { headers: { "content-type": "application/json" } });
};
