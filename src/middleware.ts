import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE, inicioDe, usuarioDeSesion } from "./lib/auth";

// El inicio de sesión es la página principal ("/") y la entrada obligatoria del
// sitio: ninguna otra página se ve sin usuario. Quedan abiertos solo el
// ingreso, la baja de la lista de difusión (el enlace de los mails) y la tarea
// programada de alertas (que se valida con su propio token).
const PUBLICAS = new Set([
  "/",
  "/ingresar",
  "/api/auth/ingresar",
  "/api/auth/salir",
  "/api/cron/alertas",
  "/api/estado",
  "/lista-de-difusion/baja",
  "/api/mailing/unsubscribe",
]);

/** Solo para administradores: el inicio y el panel. */
const soloAdmin = (pathname: string, ruta: string) => ruta === "/inicio" || pathname.startsWith("/admin") || pathname.startsWith("/api/admin");

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
    return context.redirect(`/?volver=${encodeURIComponent(pathname + search)}`);
  }
  if (soloAdmin(pathname, ruta) && usuario.rol !== "admin") {
    if (esApi) return new Response(JSON.stringify({ error: "Solo para administradores." }), { status: 403, headers: { "content-type": "application/json" } });
    return context.redirect(inicioDe(usuario));
  }
  const respuesta = await next();
  // Con sesión nada queda guardado en el navegador: después de «Salir», el
  // botón «Atrás» vuelve a pedir la página y lleva al inicio de sesión.
  respuesta.headers.set("Cache-Control", "no-store");
  return respuesta;
});
