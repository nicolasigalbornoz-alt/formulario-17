import { defineMiddleware } from "astro:middleware";
import { ADMIN_SESSION_COOKIE, isValidSession } from "./lib/auth";

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  const isPublicAdminPath = pathname === "/admin/login" || pathname === "/api/admin/login";
  const isAdminRoute = (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) && !isPublicAdminPath;
  if (!isAdminRoute) return next();

  const secret = context.locals.runtime?.env?.SESSION_SECRET;
  if (!secret) return context.redirect("/admin/login?error=config");

  const cookie = context.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const valid = await isValidSession(cookie, secret);
  if (!valid) return context.redirect("/admin/login");

  return next();
});
