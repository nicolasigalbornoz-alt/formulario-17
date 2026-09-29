import type { APIRoute } from "astro";
import { puedeVer } from "../../../lib/auth";
import { armarF17, d1, getCorte, getDatosPrograma, trimestresDisponibles } from "../../../lib/f17";

const COD = /^[0-9.]{1,12}$/;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// F17 prellenado de un programa completo (lo mismo que se ve al sacarlo por
// programa). Lo usa el unificador de categorías para las columnas prellenadas:
// así el unificado es igual al F17 por programa, incluido el compromiso del año
// anterior de categorías que ya no tienen crédito.
export const GET: APIRoute = async ({ url, locals }) => {
  const usuario = locals.usuario!;
  const p = url.searchParams;
  const jurisdiccion = p.get("jurisdiccion") ?? "";
  const programa = p.get("programa") ?? "";
  const fuente = p.get("fuente") ?? "";
  const trimestre = Number(p.get("trimestre"));
  const anio = p.get("anio") ? Number(p.get("anio")) : null;
  if (![jurisdiccion, programa, fuente].every((c) => COD.test(c)) || (anio !== null && !Number.isInteger(anio))) {
    return json({ error: "Datos inválidos" }, 400);
  }
  if (!puedeVer(usuario, jurisdiccion)) return json({ error: "Sin acceso" }, 403);

  const sql = d1(locals.runtime.env.DB);
  const corte = await getCorte(sql, anio);
  if (!corte || (anio !== null && corte.anio !== anio)) return json({ error: "No hay datos de ese año" }, 404);
  if (!trimestresDisponibles(corte).includes(trimestre)) return json({ error: "Ese trimestre no se puede cargar con los datos actuales" }, 409);
  const datos = await getDatosPrograma(sql, corte, jurisdiccion, programa);
  const reporte = datos ? armarF17({ ...datos, trimestre }, fuente, null) : null;
  if (!reporte) return json({ error: "No se encontró el programa" }, 404);
  return json(reporte);
};
