import type { APIRoute } from "astro";
import { puedeVer } from "../../../lib/auth";
import { d1, getCorte, trimestresDisponibles } from "../../../lib/f17";
import { marcarCarga } from "../../../lib/seguimiento";

const COD = /^[0-9]{2}$/;
const rutaSegura = (v: string, porDefecto: string) =>
  v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : porDefecto;

// Marca (o desmarca) que el F17 de un programa ya se cargó en RAFAM en el
// trimestre elegido (uno de los disponibles).
export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const usuario = locals.usuario!;
  const form = await request.formData();
  const jurisdiccion = String(form.get("jurisdiccion") ?? "");
  const programa = String(form.get("programa") ?? "");
  const volver = rutaSegura(String(form.get("volver") ?? ""), "/formulario-17");
  if (!COD.test(jurisdiccion) || !COD.test(programa)) return new Response("Datos inválidos", { status: 400 });
  if (!puedeVer(usuario, jurisdiccion)) return new Response("Tu usuario no tiene acceso a esa jurisdicción", { status: 403 });

  const db = locals.runtime.env.DB;
  const corte = await getCorte(d1(db));
  const T = Number(form.get("trimestre"));
  if (!corte || !trimestresDisponibles(corte).includes(T)) return new Response("Trimestre no disponible", { status: 400 });

  await marcarCarga(db, corte.anio, T, jurisdiccion, programa, usuario.usuario, form.get("cargado") === "1");
  return redirect(volver, 303);
};
