import type { APIRoute } from "astro";
import { ingresar, inicioDe, SESSION_COOKIE, SESSION_MAX_AGE_S } from "../../../lib/auth";

/** Solo rutas internas del sitio (evita redirigir a otro dominio). */
const rutaSegura = (v: string) => (v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "");

export const POST: APIRoute = async ({ request, locals, redirect, cookies }) => {
  const env = locals.runtime.env;
  const form = await request.formData();
  const volver = rutaSegura(String(form.get("volver") ?? ""));
  const r = await ingresar(env.DB, env, String(form.get("usuario") ?? ""), String(form.get("clave") ?? ""));

  if (!r.ok) {
    const qs = new URLSearchParams({ error: r.motivo, ...(volver ? { volver } : {}) });
    return redirect(`/?${qs}`, 303);
  }
  cookies.set(SESSION_COOKIE, r.cookie, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE_S });
  // Vuelve a la página que se pidió; si no, cada uno a la suya.
  const destino = volver && volver !== "/" ? volver : inicioDe(r.usuario);
  return redirect(destino, 303);
};
