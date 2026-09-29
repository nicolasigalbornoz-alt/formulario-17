import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE, usuarioDeSesion } from "./lib/auth";

// El inicio de sesión es la entrada obligatoria del sitio: ninguna página se
// ve sin usuario. Quedan abiertos solo el ingreso, la baja de la lista de
// difusión (el enlace de los mails) y la tarea programada de alertas (que se
// valida con su propio token).
const PUBLICAS = new Set(["/ingresar", "/api/auth/ingresar", "/api/auth/salir", "/api/cron/alertas", "/lista-de-difusion/baja", "/api/mailing/unsubscribe"]);

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname, search } = context.url;
  const ruta = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const env = context.locals.runtime?.env;
  const cookie = context.cookies.get(SESSION_COOKIE)?.value;
  context.locals.usuario = cookie && env?.DB ? await usuarioDeSesion(env.DB, env, cookie) : null;
  const usuario = context.locals.usuario;

  if (PUBLICAS.has(ruta)) return next();

  const esApi = pathname.startsWith("/api/");
  if (!usuario) {
    if (esApi) return new Response(JSON.stringify({ error: "Tenés que ingresar." }), { status: 401, headers: { "content-type": "application/json" } });
    return context.redirect(ruta === "/" ? "/ingresar" : `/ingresar?volver=${encodeURIComponent(pathname + search)}`);
  }
  if ((pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) && usuario.rol !== "admin") {
    if (esApi) return new Response(JSON.stringify({ error: "Solo para administradores." }), { status: 403, headers: { "content-type": "application/json" } });
    return context.redirect("/");
  }
  return next();
});
