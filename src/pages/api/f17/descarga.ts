import type { APIRoute } from "astro";
import { puedeVer } from "../../../lib/auth";
import { d1, getCorte, trimestreElegido } from "../../../lib/f17";
import { registrarDescarga, type ModoDescarga } from "../../../lib/seguimiento";

const COD = /^[0-9.]{1,12}$/;
const MODOS: ModoDescarga[] = ["programa", "categoria", "completo"];

// Registra que el usuario bajó el Excel de un programa (solo para el
// seguimiento; no guarda nada del contenido).
export const POST: APIRoute = async ({ request, locals }) => {
  const usuario = locals.usuario!;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const modo = b?.modo as ModoDescarga;
  const jurisdiccion = String(b?.jurisdiccion ?? "");
  const programa = String(b?.programa ?? "");
  const catprog = b?.catprog ? String(b.catprog) : null;
  const fuente = b?.fuente ? String(b.fuente) : null;
  const valido =
    MODOS.includes(modo) &&
    COD.test(jurisdiccion) &&
    COD.test(programa) &&
    (catprog === null || COD.test(catprog)) &&
    (fuente === null || COD.test(fuente));
  if (!valido) return new Response(JSON.stringify({ error: "Datos inválidos" }), { status: 400 });
  if (!puedeVer(usuario, jurisdiccion)) return new Response(JSON.stringify({ error: "Sin acceso" }), { status: 403 });

  const db = locals.runtime.env.DB;
  const corte = await getCorte(d1(db));
  if (!corte) return new Response(null, { status: 204 });
  await registrarDescarga(db, {
    usuario: usuario.usuario,
    anio: corte.anio,
    trimestre: trimestreElegido(corte, b?.trimestre),
    modo,
    jurisdiccion,
    programa,
    catprog,
    fuente,
  });
  return new Response(null, { status: 204 });
};
