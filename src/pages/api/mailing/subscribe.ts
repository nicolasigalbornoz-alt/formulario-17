import type { APIRoute } from "astro";
import { leerFormulario, suscribir } from "../../../lib/mailing";

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const form = await request.formData();
  // Campo trampa: si viene completo es un bot. Se responde como si nada.
  if (String(form.get("sitio_web") ?? "").trim()) return redirect("/lista-de-difusion?ok=1", 303);

  const leido = leerFormulario(form);
  if ("error" in leido) return redirect(`/lista-de-difusion?error=${encodeURIComponent(leido.error)}`, 303);

  await suscribir(locals.runtime.env.DB, leido.datos);
  return redirect("/lista-de-difusion?ok=1", 303);
};
