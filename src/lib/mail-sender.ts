// Envío de avisos masivos a la lista de difusión. Proveedores posibles,
// elegidos con la variable MAIL_PROVIDER:
//
//  - "smtp": la casilla institucional (dir.presupuesto@moron.gob.ar, servidor
//    Zimbra/Postfix de mail.moron.gob.ar) por SMTP con TLS, desde el Worker.
//      MAIL_SMTP_HOST, MAIL_SMTP_PORT (465 = TLS directo, 587 = STARTTLS),
//      MAIL_SMTP_USER y el secret MAIL_SMTP_PASSWORD (la contraseña la carga
//      la Subsecretaría con `wrangler secret put`; no va en el repo).
//  - "apps_script": una Web App de Google Apps Script publicada con la cuenta
//    de Presupuesto (scripts/mail_apps_script.gs) que manda cada mail con
//    MailApp. Mismo esquema que ya usa Formulario7 para subir a Drive, sin
//    costo ni dominio propio. Límite de Google: 100 destinatarios por día
//    con una cuenta @gmail.com, 1.500 con Google Workspace.
//      MAIL_APPS_SCRIPT_URL, MAIL_TOKEN
//  - "resend": API de Resend (https://resend.com), para volúmenes mayores.
//    Requiere un dominio verificado en Resend.
//      RESEND_API_KEY, MAIL_FROM ("Presupuesto Morón <avisos@dominio>")
//
// Sin proveedor configurado el aviso se guarda como "pendiente" y no se
// manda nada: el panel nunca simula un envío que no ocurrió.

export interface Mensaje {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Enlace de baja (va también en el encabezado List-Unsubscribe). */
  baja?: string;
}

export interface EnvioResultado {
  enviados: number;
  errores: string[];
  detalle: string;
}

export function proveedorConfigurado(env: Env): string | null {
  if (env.MAIL_PROVIDER === "smtp" && env.MAIL_SMTP_HOST && env.MAIL_SMTP_USER && env.MAIL_SMTP_PASSWORD)
    return `Correo municipal (${env.MAIL_SMTP_USER})`;
  if (env.MAIL_PROVIDER === "apps_script" && env.MAIL_APPS_SCRIPT_URL && env.MAIL_TOKEN) return "Google Apps Script";
  if (env.MAIL_PROVIDER === "resend" && env.RESEND_API_KEY && env.MAIL_FROM) return "Resend";
  return null;
}

async function enviarPorSmtp(env: Env, mensajes: Mensaje[]): Promise<EnvioResultado> {
  // Import diferido: `cloudflare:sockets` solo existe dentro del Worker.
  const { enviarSmtp } = await import("./smtp");
  const port = Number(env.MAIL_SMTP_PORT) || 465;
  let enviados = 0;
  const errores: string[] = [];
  // Tandas de 40 por conexión, para no quedar cerca de los límites del servidor.
  for (let i = 0; i < mensajes.length; i += 40) {
    const r = await enviarSmtp(
      {
        host: env.MAIL_SMTP_HOST!,
        port,
        seguridad: (env.MAIL_SMTP_SECURITY as "tls" | "starttls" | "none" | undefined) ?? (port === 587 ? "starttls" : "tls"),
        usuario: env.MAIL_SMTP_USER!,
        clave: env.MAIL_SMTP_PASSWORD!,
        nombre: "Subsecretaría de Planificación Presupuestaria y Estadística",
      },
      mensajes.slice(i, i + 40)
    );
    enviados += r.enviados;
    errores.push(...r.errores);
    if (r.errores.some((e) => e.startsWith("Servidor de mail:"))) break; // sin conexión o sin login: no insistir
  }
  return { enviados, errores, detalle: "" };
}

async function enviarAppsScript(env: Env, mensajes: Mensaje[]): Promise<EnvioResultado> {
  let enviados = 0;
  const errores: string[] = [];
  // De a 50 por pedido: cada ejecución de Apps Script tiene 6 minutos de tope.
  for (let i = 0; i < mensajes.length; i += 50) {
    const lote = mensajes.slice(i, i + 50);
    try {
      const res = await fetch(env.MAIL_APPS_SCRIPT_URL!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: env.MAIL_TOKEN, nombre: "Subsecretaría de Planificación Presupuestaria y Estadística · Morón", mensajes: lote }),
        redirect: "follow",
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; enviados?: number; errores?: string[]; error?: string } | null;
      if (!res.ok || !body?.ok) {
        errores.push(body?.error ?? `Apps Script respondió ${res.status}`);
        continue;
      }
      enviados += body.enviados ?? 0;
      errores.push(...(body.errores ?? []));
    } catch (e) {
      errores.push(`No se pudo contactar al Apps Script: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { enviados, errores, detalle: "" };
}

async function enviarResend(env: Env, mensajes: Mensaje[]): Promise<EnvioResultado> {
  let enviados = 0;
  const errores: string[] = [];
  for (let i = 0; i < mensajes.length; i += 100) {
    const lote = mensajes.slice(i, i + 100).map((m) => ({ from: env.MAIL_FROM, ...m }));
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(lote),
    });
    if (res.ok) enviados += lote.length;
    else errores.push(`Resend respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return { enviados, errores, detalle: "" };
}

export async function enviarAvisoMasivo(env: Env, mensajes: Mensaje[]): Promise<EnvioResultado> {
  const proveedor = proveedorConfigurado(env);
  if (!proveedor) {
    return {
      enviados: 0,
      errores: [],
      detalle: `No hay proveedor de mail configurado (MAIL_PROVIDER). El aviso quedó guardado para ${mensajes.length} destinatarios, pero no se envió.`,
    };
  }
  if (mensajes.length === 0) return { enviados: 0, errores: [], detalle: "No hay suscriptos activos." };

  const r =
    env.MAIL_PROVIDER === "smtp"
      ? await enviarPorSmtp(env, mensajes)
      : env.MAIL_PROVIDER === "apps_script"
        ? await enviarAppsScript(env, mensajes)
        : await enviarResend(env, mensajes);
  r.detalle =
    `Enviado con ${proveedor} a ${r.enviados} de ${mensajes.length} suscriptos.` +
    (r.errores.length ? ` Errores: ${r.errores.slice(0, 5).join(" · ")}` : "");
  return r;
}

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Arma el mail (texto plano escrito en el panel -> HTML simple con la estética del sitio). */
export function armarMensaje(email: string, asunto: string, cuerpo: string, enlaceBaja: string, sitio: string): Mensaje {
  const parrafos = cuerpo
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.6">${escapar(p).replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#ce1520">$1</a>')}</p>`)
    .join("");
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#212121">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f5;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #e5e5e5">
<tr><td style="background:#212121;border-bottom:4px solid #f01c24;padding:18px 26px;color:#fff;font-size:14px">
<strong style="font-size:16px">Subsecretaría de Planificación Presupuestaria y Estadística</strong><br><span style="color:#bbb">Municipio de Morón</span></td></tr>
<tr><td style="padding:26px 26px 10px"><h1 style="margin:0 0 18px;font-size:22px;color:#f01c24">${escapar(asunto)}</h1>${parrafos}</td></tr>
<tr><td style="padding:16px 26px 24px;border-top:1px solid #eee;font-size:12px;color:#777;line-height:1.6">
Recibís este mail porque te sumaste a la lista de difusión de la Subsecretaría de Planificación Presupuestaria y Estadística (<a href="${sitio}" style="color:#ce1520">${escapar(sitio.replace(/^https?:\/\//, ""))}</a>).<br>
Consultas: dir.presupuesto@moron.gob.ar · Interno 7714 · <a href="${enlaceBaja}" style="color:#ce1520">Darme de baja</a></td></tr>
</table></td></tr></table></body></html>`;
  const text = `${asunto}\n\n${cuerpo}\n\n--\nSubsecretaría de Planificación Presupuestaria y Estadística · Municipio de Morón\nPara darte de baja: ${enlaceBaja}`;
  return { to: email, subject: asunto, html, text, baja: enlaceBaja };
}
