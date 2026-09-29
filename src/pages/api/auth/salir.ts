import type { APIRoute } from "astro";
import { SESSION_COOKIE } from "../../../lib/auth";

// Cierra la sesión y vuelve al inicio de sesión (la página principal).
export const POST: APIRoute = async ({ redirect, cookies }) => {
  cookies.delete(SESSION_COOKIE, { path: "/", httpOnly: true, secure: true, sameSite: "lax" });
  return redirect("/?salida=1", 303);
};
