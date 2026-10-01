// Entrada del Worker que se despliega (wrangler.toml -> main):
//  - fetch: la app de Astro tal cual la genera `npm run build`.
//  - scheduled: las tareas de wrangler.toml -> [triggers], cada una llamando
//    a su propia ruta /api/cron/* con un token derivado de SESSION_SECRET:
//      - alertas de vencimientos por mail, una vez al día.
//      - sincronización del mes en curso desde RAFAMOR SQL, varias veces al
//        día (ver src/lib/sync-rafamor-sql.ts).
//
// @astrojs/cloudflare 11 no deja agregar handlers además de fetch, por eso
// se envuelve la salida del build.

import astro from "../dist/_worker.js/index.js";

async function hmacHex(value, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function llamarCron(ruta, tokenFor, env, ctx) {
  const base = (env.SITE_URL || "https://formulario-17.interno").replace(/\/$/, "");
  const req = new Request(`${base}${ruta}`, {
    method: "POST",
    headers: { "x-cron-token": await hmacHex(tokenFor, env.SESSION_SECRET ?? "") },
  });
  ctx.waitUntil(astro.fetch(req, env, ctx).then(async (res) => console.log(`${ruta}: ${res.status} ${await res.text()}`)));
}

// "0 11 * * *" (alertas, una vez al día) vs. el resto (sync de RAFAMOR SQL,
// varias veces al día): ver wrangler.toml -> [triggers].
export default {
  ...astro,
  async scheduled(controller, env, ctx) {
    if (controller.cron === "0 11 * * *") {
      await llamarCron("/api/cron/alertas", "cron-alertas", env, ctx);
    } else {
      await llamarCron("/api/cron/sync-rafamor", "cron-sync-rafamor", env, ctx);
    }
  },
};
