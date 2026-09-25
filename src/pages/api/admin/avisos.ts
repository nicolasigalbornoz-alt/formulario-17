import type { APIRoute } from "astro";
import { listarSuscriptores } from "../../../lib/mailing";
import { enviarAvisoMasivo } from "../../../lib/mail-sender";

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const env = locals.runtime.env;
  const db = env.DB;
  const form = await request.formData();
  const asunto = String(form.get("asunto") || "").trim();
  const cuerpo = String(form.get("cuerpo") || "").trim();

  if (!asunto || !cuerpo) return redirect("/admin/avisos?error=1");

  const suscriptores = await listarSuscriptores(db, true);
  const destinatarios = suscriptores.map((s) => s.email);

  const resultado = await enviarAvisoMasivo(env, destinatarios, asunto, cuerpo);

  await db
    .prepare(
      `INSERT INTO avisos_enviados (asunto, cuerpo, destinatarios, estado, detalle) VALUES (?, ?, ?, ?, ?)`
    )
    .bind(asunto, cuerpo, destinatarios.length, resultado.enviado ? "enviado" : "pendiente", resultado.detalle)
    .run();

  return redirect(`/admin/avisos?ok=1&msg=${encodeURIComponent(resultado.detalle)}`);
};
