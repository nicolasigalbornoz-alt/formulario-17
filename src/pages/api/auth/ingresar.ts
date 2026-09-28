import type { APIRoute } from "astro";
import { ingresar, SESSION_COOKIE, SESSION_MAX_AGE_S } from "../../../lib/auth";

/** Solo rutas internas del sitio (evita redirigir a otro dominio). */
const rutaSegura = (v: string) => (v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "");

export const POST: APIRoute = async ({ request, locals, redirect, cookies }) => {
  const env = locals.runtime.env;
  const form = await request.formData();
  const volver = rutaSegura(String(form.get("volver") ?? ""));
  const r = await ingresar(env.DB, env, String(form.get("usuario") ?? ""), String(form.get("clave") ?? ""));

  if (!r.ok) {
    const qs = new URLSearchParams({ error: r.motivo, ...(volver ? { volver } : {}) });
    return redirect(`/ingresar?${qs}`, 303);
  }
  cookies.set(SESSION_COOKIE, r.cookie, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE_S });
  const destino = volver && !(volver.startsWith("/admin") && r.usuario.rol !== "admin") ? volver : r.usuario.rol === "admin" ? "/admin" : "/formulario-17";
  return redirect(destino, 303);
};
