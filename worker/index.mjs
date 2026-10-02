// Entrada del Worker que se despliega (wrangler.toml -> main):
//  - fetch: la app de Astro tal cual la genera `npm run build`.
//  - scheduled: las tareas de wrangler.toml -> [triggers]:
//      - "0 11 * * *": alertas de vencimientos por mail, una vez al día, por
//        la ruta /api/cron/alertas de la app (con un token de SESSION_SECRET).
//      - el resto: sincronización con RAFAMOR SQL. Se llama directo, sin pasar
//        por la app, para gastar lo menos posible de los 10 ms de CPU del plan
//        gratuito (ver src/lib/sync-rafamor-sql.ts).
//
// @astrojs/cloudflare 11 no deja agregar handlers además de fetch, por eso
// se envuelve la salida del build.

import astro from "../dist/_worker.js/index.js";
import { sincronizarRafamorSql } from "../src/lib/sync-rafamor-sql.ts";

async function hmacHex(value, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  ...astro,
  async scheduled(controller, env, ctx) {
    if (controller.cron === "0 11 * * *") {
      const base = (env.SITE_URL || "https://presupuesto.interno").replace(/\/$/, "");
      const req = new Request(`${base}/api/cron/alertas`, {
        method: "POST",
        headers: { "x-cron-token": await hmacHex("cron-alertas", env.SESSION_SECRET ?? "") },
      });
      ctx.waitUntil(astro.fetch(req, env, ctx).then(async (res) => console.log(`alertas: ${res.status} ${await res.text()}`)));
    } else {
      ctx.waitUntil(
        sincronizarRafamorSql(env.DB, env, "tarea").then(
          (r) => console.log(`sync RAFAMOR SQL: ${JSON.stringify(r)}`),
          (e) => console.error(`sync RAFAMOR SQL: ${e?.message ?? e}`)
        )
      );
    }
  },
};
