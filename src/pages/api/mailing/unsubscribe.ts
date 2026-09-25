import type { APIRoute } from "astro";
import { isValidEmail, desuscribir } from "../../../lib/mailing";

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const form = await request.formData();
  const email = String(form.get("email") || "");

  if (!isValidEmail(email)) {
    return redirect("/mailing?error=email");
  }

  const db = locals.runtime.env.DB;
  await desuscribir(db, email);
  return redirect("/mailing?baja=1");
};
