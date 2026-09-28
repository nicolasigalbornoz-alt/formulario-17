import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE, usuarioDeSesion } from "./lib/auth";

// Público: inicio, instructivos, lista de difusión e ingreso.
// Con usuario (cualquier rol): el Formulario 17 y su API.
// Solo administradores: el panel (/admin) y su API.
export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname, search } = context.url;
  const env = context.locals.runtime?.env;
  const cookie = context.cookies.get(SESSION_COOKIE)?.value;
  context.locals.usuario = cookie && env?.DB ? await usuarioDeSesion(env.DB, env, cookie) : null;
  const usuario = context.locals.usuario;

  const esApi = pathname.startsWith("/api/");
  const requiereUsuario = pathname.startsWith("/formulario-17") || pathname.startsWith("/api/f17");
  const requiereAdmin = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");

  if ((requiereUsuario || requiereAdmin) && !usuario) {
    if (esApi) return new Response(JSON.stringify({ error: "Tenés que ingresar." }), { status: 401, headers: { "content-type": "application/json" } });
    return context.redirect(`/ingresar?volver=${encodeURIComponent(pathname + search)}`);
  }
  if (requiereAdmin && usuario?.rol !== "admin") {
    if (esApi) return new Response(JSON.stringify({ error: "Solo para administradores." }), { status: 403, headers: { "content-type": "application/json" } });
    return context.redirect("/formulario-17");
  }
  return next();
});
