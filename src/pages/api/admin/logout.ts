import type { APIRoute } from "astro";
import { ADMIN_SESSION_COOKIE } from "../../../lib/auth";

export const POST: APIRoute = async ({ redirect, cookies }) => {
  cookies.delete(ADMIN_SESSION_COOKIE, { path: "/" });
  return redirect("/admin/login");
};
