import type { APIRoute } from "astro";
import { checkPassword, createSessionCookieValue, ADMIN_SESSION_COOKIE } from "../../../lib/auth";

export const POST: APIRoute = async ({ request, locals, redirect, cookies }) => {
  const env = locals.runtime.env;
  const form = await request.formData();
  const password = String(form.get("password") || "");

  if (!env.ADMIN_PASSWORD_HASH || !env.SESSION_SECRET) {
    return redirect("/admin/login?error=config");
  }

  const ok = await checkPassword(password, env.ADMIN_PASSWORD_HASH);
  if (!ok) return redirect("/admin/login?error=1");

  const value = await createSessionCookieValue(env.SESSION_SECRET);
  cookies.set(ADMIN_SESSION_COOKIE, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 60 * 60,
  });

  return redirect("/admin");
};
