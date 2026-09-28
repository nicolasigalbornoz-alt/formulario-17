import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  output: "server",
  adapter: cloudflare({
    imageService: "compile",
    platformProxy: { enabled: true },
  }),
  // exceljs y xlsx pesan ~1 MB pero se cargan con import() recién al tocar
  // "Descargar Excel" o al subir un reporte en el panel: no afectan la carga
  // de las páginas.
  vite: { build: { chunkSizeWarningLimit: 1000 } },
  // Rutas del sitio anterior (Google Sites) y de la primera versión.
  redirects: {
    "/formulario-17/programas": "/formulario-17",
    "/formulario-17/categorias-programaticas": "/formulario-17",
    "/mailing": "/lista-de-difusion",
    "/instructivos/formulacion": "/instructivos",
    "/instructivos/trimestrales": "/instructivos/f17",
  },
});
