/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    /** Usuario con sesión iniciada (lo carga src/middleware.ts), o null. */
    usuario: import("./lib/auth").Usuario | null;
  }
}

interface Env {
  DB: D1Database;
  ADMIN_PASSWORD_HASH?: string;
  SESSION_SECRET?: string;
  /** URL pública del sitio, para los enlaces de baja de los mails (si falta se usa la del pedido). */
  SITE_URL?: string;
  /** "apps_script" | "resend" (ver src/lib/mail-sender.ts). */
  MAIL_PROVIDER?: string;
  MAIL_APPS_SCRIPT_URL?: string;
  MAIL_TOKEN?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
}
