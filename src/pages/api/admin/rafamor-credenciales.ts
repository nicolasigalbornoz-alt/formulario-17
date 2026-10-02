import type { APIRoute } from "astro";
import { guardarCredenciales, limpiarCredencial } from "../../../lib/sync-rafamor-sql";

// Formulario "Credenciales de RAFAMOR SQL" del panel (Datos de RAFAM): guarda
// el token de servicio en D1 para el sync. Protegido por el middleware (solo admin).
export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const form = await request.formData();
  const clientId = limpiarCredencial(String(form.get("client_id") ?? ""));
  const clientSecret = limpiarCredencial(String(form.get("client_secret") ?? ""));
  const volver = (ok: boolean, msg: string) => redirect(`/admin/datos?${ok ? "ok=1" : "error=1"}&msg=${encodeURIComponent(msg)}`, 303);

  if (!clientId.endsWith(".access") || clientId.length > 200) return volver(false, "El Client ID tiene que terminar en .access.");
  if (clientSecret.length < 20 || clientSecret.length > 500) return volver(false, "El Client Secret no parece válido.");

  await guardarCredenciales(locals.runtime.env.DB, clientId, clientSecret);
  return volver(true, "Credenciales de RAFAMOR SQL guardadas. Ahora apretá «Sincronizar ahora».");
};
