import type { APIRoute } from "astro";
import { reactivar } from "../../../lib/mailing";

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const form = await request.formData();
  const id = Number(form.get("id"));
  if (!Number.isInteger(id)) return new Response("id inválido", { status: 400 });
  await reactivar(locals.runtime.env.DB, id, form.get("activo") === "1");
  const verTodos = (request.headers.get("referer") ?? "").includes("todos=1");
  return redirect(verTodos ? "/admin/suscriptores?todos=1" : "/admin/suscriptores", 303);
};
