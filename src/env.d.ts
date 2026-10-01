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
  /** "smtp" | "apps_script" | "resend" (ver src/lib/mail-sender.ts). */
  MAIL_PROVIDER?: string;
  MAIL_SMTP_HOST?: string;
  MAIL_SMTP_PORT?: string;
  /** "tls" (465) | "starttls" (587); por defecto según el puerto. */
  MAIL_SMTP_SECURITY?: string;
  MAIL_SMTP_USER?: string;
  MAIL_SMTP_PASSWORD?: string;
  MAIL_APPS_SCRIPT_URL?: string;
  MAIL_TOKEN?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  /** Token de servicio de Cloudflare Access para RAFAMOR SQL (ver src/lib/sync-rafamor-sql.ts). */
  RAFAMOR_CF_CLIENT_ID?: string;
  RAFAMOR_CF_CLIENT_SECRET?: string;
}
