#!/usr/bin/env node
// Carga en la base del F17 (D1) la ejecución de gastos de RAFAM que baja el
// pipeline de RAFAMOR (rafam_ejecutado_bg.py deja un .xls por mes en
// <RAFAMOR>/ejecutados_AAAA/gastos_mensual/gastos_MNN_desde_a_hasta.xls,
// y el del mes en curso se vuelve a bajar todos los días).
//
// Por cada mes toma el reporte más nuevo, y solo recarga los meses cuya foto
// cambió respecto de lo que ya tiene la base (a menos que se pase --forzar).
//
// Uso:
//   node scripts/sync-rafamor.mjs                      # base local (wrangler dev)
//   node scripts/sync-rafamor.mjs --remote             # base de producción (Cloudflare)
//   node scripts/sync-rafamor.mjs --remote --desde=2025
//   node scripts/sync-rafamor.mjs --remote --archivo="C:\ruta\gastos.xls"   # un reporte suelto
//   node scripts/sync-rafamor.mjs --solo-sql           # arma los .sql en scripts/out/ sin ejecutarlos
//
// Carpeta de RAFAMOR: --dir=... o variable RAFAMOR_DIR (por defecto
// "..\Flujos semanales\Flujos semanales", al lado de este repo en el Escritorio).

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { parseReporteGastos } from "../src/lib/rafam-gastos.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "scripts", "out");
const DB_NAME = "f17_db";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  })
);
const archivosSueltos = process.argv
  .slice(2)
  .filter((a) => a.startsWith("--archivo="))
  .map((a) => a.slice("--archivo=".length));

const destino = args.remote ? "--remote" : "--local";
const soloSql = Boolean(args["solo-sql"]);
const forzar = Boolean(args.forzar);
const anioActual = new Date().getFullYear();
const desde = Number(args.desde ?? anioActual - 1);
const rafamorDir = path.resolve(
  String(args.dir ?? process.env.RAFAMOR_DIR ?? path.join(ROOT, "..", "Flujos semanales", "Flujos semanales"))
);

function wrangler(extra) {
  // En Windows npx es un .cmd y hay que pasar por el shell: los argumentos con
  // espacios (rutas, --command) van entre comillas.
  const win = process.platform === "win32";
  const argv = ["wrangler", "d1", "execute", DB_NAME, destino, ...extra].map((a) =>
    win && /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a
  );
  const res = spawnSync("npx", argv, {
    cwd: ROOT,
    shell: win,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(`wrangler falló:\n${res.stdout}\n${res.stderr}`);
  }
  return res.stdout;
}

function cortesCargados() {
  if (soloSql || forzar) return new Map();
  try {
    const out = wrangler(["--json", "--command", "SELECT anio, mes, hasta FROM rafam_cortes"]);
    const json = JSON.parse(out.slice(out.indexOf("[")));
    return new Map((json[0]?.results ?? []).map((r) => [`${r.anio}-${r.mes}`, r.hasta]));
  } catch (e) {
    console.warn("No pude leer rafam_cortes (¿falta aplicar las migraciones?). Se cargan todos los meses.\n", e.message);
    return new Map();
  }
}

/** { "2026-9": { archivo, hasta } } con el reporte más nuevo de cada mes. */
function buscarReportes() {
  const elegidos = new Map();
  const considerar = (archivo, anio, mes, hasta) => {
    const k = `${anio}-${mes}`;
    const prev = elegidos.get(k);
    if (!prev || hasta > prev.hasta) elegidos.set(k, { archivo, anio, mes, hasta });
  };

  if (archivosSueltos.length) {
    for (const a of archivosSueltos) considerar(path.resolve(a), 0, 0, "");
    return [...elegidos.values()];
  }

  if (!fs.existsSync(rafamorDir)) throw new Error(`No existe la carpeta de RAFAMOR: ${rafamorDir} (usá --dir=...)`);
  const RE = /^gastos_M(\d{2})_(\d{4})-\d{2}-\d{2}_a_(\d{4}-\d{2}-\d{2})\.xls$/i;
  for (let anio = desde; anio <= anioActual + 1; anio++) {
    const dir = path.join(rafamorDir, `ejecutados_${anio}`, "gastos_mensual");
    if (!fs.existsSync(dir)) continue;
    for (const nombre of fs.readdirSync(dir)) {
      const m = RE.exec(nombre);
      if (!m) continue;
      considerar(path.join(dir, nombre), Number(m[2]), Number(m[1]), m[3]);
    }
  }
  return [...elegidos.values()].sort((a, b) => (a.anio - b.anio) || (a.mes - b.mes));
}

const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const COLS = [
  "anio", "mes", "jurisdiccion_codigo", "jurisdiccion", "programa_codigo", "programa",
  "catprog_codigo", "catprog", "fuente_codigo", "fuente", "inciso", "partida_codigo", "partida",
  "aprobado", "modificaciones", "vigente", "preventivo", "compromiso", "devengado", "pagado",
];

function armarSql(reporte, archivo) {
  const { anio, mes, desde: d, hasta, mesCompleto } = reporte.periodo;
  const lineas = [`DELETE FROM rafam_gastos WHERE anio = ${anio} AND mes = ${mes};`];
  // Sentencias chicas: D1 limita cada sentencia a 100 KB.
  for (let i = 0; i < reporte.filas.length; i += 150) {
    const valores = reporte.filas.slice(i, i + 150).map((f) => `(${COLS.map((c) => q(f[c])).join(",")})`);
    lineas.push(`INSERT INTO rafam_gastos (${COLS.join(",")}) VALUES\n${valores.join(",\n")};`);
  }
  lineas.push(
    `INSERT OR REPLACE INTO rafam_cortes (anio, mes, desde, hasta, mes_completo, filas, archivo, origen, cargado_en) VALUES (${[
      anio, mes, d, hasta, mesCompleto ? 1 : 0, reporte.filas.length, path.basename(archivo), "sync",
    ].map(q).join(",")}, datetime('now'));`
  );
  return lineas.join("\n");
}

function main() {
  const reportes = buscarReportes();
  if (reportes.length === 0) {
    console.log("No encontré reportes de gastos para cargar.");
    return;
  }
  const cargados = cortesCargados();
  fs.mkdirSync(OUT, { recursive: true });

  let hechos = 0;
  for (const r of reportes) {
    const wb = XLSX.read(fs.readFileSync(r.archivo), { type: "buffer" });
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true });
    const reporte = parseReporteGastos(filas);
    const { anio, mes, hasta } = reporte.periodo;
    const etiqueta = `${anio}-${String(mes).padStart(2, "0")} (al ${hasta})`;

    if (cargados.get(`${anio}-${mes}`) === hasta) {
      console.log(`= ${etiqueta}: ya estaba cargado`);
      continue;
    }
    for (const a of reporte.avisos) console.warn(`  ! ${a}`);

    const sqlPath = path.join(OUT, `rafam_${anio}_${String(mes).padStart(2, "0")}.sql`);
    fs.writeFileSync(sqlPath, armarSql(reporte, r.archivo), "utf8");
    if (soloSql) {
      console.log(`· ${etiqueta}: ${reporte.filas.length} filas -> ${path.relative(ROOT, sqlPath)}`);
    } else {
      wrangler(["--yes", "--file", sqlPath]);
      console.log(`✓ ${etiqueta}: ${reporte.filas.length} filas cargadas (${destino.slice(2)})`);
    }
    hechos++;
  }
  console.log(hechos ? `Listo: ${hechos} mes(es) ${soloSql ? "preparados" : "actualizados"}.` : "La base ya estaba al día.");
}

try {
  main();
} catch (e) {
  console.error(e.message ?? e);
  process.exit(1);
}
