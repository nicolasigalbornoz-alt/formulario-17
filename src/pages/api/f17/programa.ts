import type { APIRoute } from "astro";
import { puedeVer } from "../../../lib/auth";
import { d1, getCorte, getDatosPrograma } from "../../../lib/f17";

// Datos de un programa completo (todas sus categorías y fuentes) para armar
// el Excel "Programa con todas sus categorías" en el navegador.
export const GET: APIRoute = async ({ url, locals }) => {
  const jurisdiccion = url.searchParams.get("jurisdiccion");
  const programa = url.searchParams.get("programa");
  if (!jurisdiccion || !programa) return new Response("Faltan jurisdiccion y programa", { status: 400 });
  if (!puedeVer(locals.usuario!, jurisdiccion)) return new Response("Tu usuario no tiene acceso a esa jurisdicción", { status: 403 });

  const sql = d1(locals.runtime.env.DB);
  const corte = await getCorte(sql);
  if (!corte) return new Response("Todavía no hay datos cargados", { status: 404 });
  const datos = await getDatosPrograma(sql, corte, jurisdiccion, programa);
  if (!datos) return new Response("No hay datos para ese programa", { status: 404 });

  return new Response(JSON.stringify(datos), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, max-age=300" },
  });
};
