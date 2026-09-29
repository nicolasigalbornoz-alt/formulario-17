// Entrada del Worker que se despliega (wrangler.toml -> main):
//  - fetch: la app de Astro tal cual la genera `npm run build`.
//  - scheduled: la tarea diaria (wrangler.toml -> [triggers]) que manda las
//    alertas de vencimientos por mail, llamando a /api/cron/alertas de la
//    propia app con un token derivado de SESSION_SECRET.
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

export default {
  ...astro,
  async scheduled(_controller, env, ctx) {
    const base = (env.SITE_URL || "https://formulario-17.interno").replace(/\/$/, "");
    const req = new Request(`${base}/api/cron/alertas`, {
      method: "POST",
      headers: { "x-cron-token": await hmacHex("cron-alertas", env.SESSION_SECRET ?? "") },
    });
    ctx.waitUntil(
      astro.fetch(req, env, ctx).then(async (res) => console.log(`alertas de vencimientos: ${res.status} ${await res.text()}`))
    );
  },
};
