/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    session?: { admin: true; issuedAt: number };
  }
}

interface Env {
  DB: D1Database;
  ADMIN_PASSWORD_HASH?: string;
  SESSION_SECRET?: string;
  MAIL_PROVIDER_API_KEY?: string;
}
