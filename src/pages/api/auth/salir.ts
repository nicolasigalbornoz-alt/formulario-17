import type { APIRoute } from "astro";
import { SESSION_COOKIE } from "../../../lib/auth";

export const POST: APIRoute = async ({ redirect, cookies }) => {
  cookies.delete(SESSION_COOKIE, { path: "/" });
  return redirect("/", 303);
};
