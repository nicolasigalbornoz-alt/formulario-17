import type { APIRoute } from "astro";
import { isValidEmail, desuscribir } from "../../../lib/mailing";

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const form = await request.formData();
  const email = String(form.get("email") || "");
  if (!isValidEmail(email)) {
    return redirect(`/lista-de-difusion?error=${encodeURIComponent("El mail no es válido.")}`, 303);
  }
  const dadoDeBaja = await desuscribir(locals.runtime.env.DB, email);
  return redirect(`/lista-de-difusion?baja=${dadoDeBaja ? 1 : 0}`, 303);
};
