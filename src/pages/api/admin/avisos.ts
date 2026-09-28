import type { APIRoute } from "astro";
import { listarSuscriptores, enlaceBaja } from "../../../lib/mailing";
import { armarMensaje, enviarAvisoMasivo, proveedorConfigurado } from "../../../lib/mail-sender";

export const POST: APIRoute = async ({ request, locals, redirect, url }) => {
  const env = locals.runtime.env;
  const db = env.DB;
  const form = await request.formData();
  const asunto = String(form.get("asunto") || "").trim().slice(0, 160);
  // Los formularios mandan los saltos de línea como \r\n.
  const cuerpo = String(form.get("cuerpo") || "").replace(/\r\n?/g, "\n").trim().slice(0, 10000);
  if (!asunto || !cuerpo) return redirect("/admin/avisos?error=1", 303);

  const sitio = (env.SITE_URL || url.origin).replace(/\/$/, "");
  const suscriptores = await listarSuscriptores(db, true);
  const mensajes = suscriptores.map((s) => armarMensaje(s.email, asunto, cuerpo, enlaceBaja(sitio, s.email), sitio));

  const r = await enviarAvisoMasivo(env, mensajes);
  const estado = !proveedorConfigurado(env)
    ? "pendiente"
    : r.enviados === mensajes.length
      ? "enviado"
      : r.enviados > 0
        ? "parcial"
        : "error";

  await db
    .prepare("INSERT INTO avisos_enviados (asunto, cuerpo, destinatarios, enviados, estado, detalle) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(asunto, cuerpo, mensajes.length, r.enviados, estado, r.detalle)
    .run();

  const qs = new URLSearchParams({ ok: "1", estado, msg: r.detalle });
  return redirect(`/admin/avisos?${qs}`, 303);
};
