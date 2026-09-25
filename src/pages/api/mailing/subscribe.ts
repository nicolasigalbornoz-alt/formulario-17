import type { APIRoute } from "astro";
import { isValidEmail, suscribir } from "../../../lib/mailing";

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const form = await request.formData();
  const email = String(form.get("email") || "");
  const nombre = String(form.get("nombre") || "");

  if (!isValidEmail(email)) {
    return redirect("/mailing?error=email");
  }

  const db = locals.runtime.env.DB;
  await suscribir(db, email, nombre || null);
  return redirect("/mailing?ok=1");
};
