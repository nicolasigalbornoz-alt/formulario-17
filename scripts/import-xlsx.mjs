#!/usr/bin/env node
// Convierte un archivo "registros f17" (.xlsx) en un archivo .sql para
// cargar en D1, reemplazando el loop de AppScript que generaba un Excel
// por cada combinación.
//
// Uso:
//   node scripts/import-xlsx.mjs <archivo.xlsx> [--sheet=basevig] [--anio=2026] [--datos-sheet=datos]
//   npx wrangler d1 execute f17_db --local  --file scripts/out/<archivo>.sql
//   npx wrangler d1 execute f17_db --remote --file scripts/out/<archivo>.sql
//
// Si no se pasa --sheet, procesa TODAS las hojas del archivo cuyo nombre sea
// un año de 4 dígitos (ej. "2024", "2025", "2026"). Si se pasa --sheet, hay
// que indicar también --anio (porque hojas como "basevig"/"añoant"/"vigente"
// no lo dicen en el nombre).

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { parseFactRows, parseDatosSheet, FUENTES_DEFAULT } from "../src/lib/registros.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// SheetJS solo expone readFile/readFileSync en su build CJS.
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

function sqlEscape(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      args[k] = v ?? true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function batched(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function buildEjecucionInserts(rows) {
  const cols = [
    "anio", "trim", "jurisdiccion_cod", "programa_cod", "catprog_cod", "catprog_denom",
    "fuente_cod", "partida_cod", "partida_denom", "aprobado", "vigente", "compromiso", "devengado", "pagado",
  ];
  const statements = [];
  for (const chunk of batched(rows, 200)) {
    const values = chunk
      .map((r) => `(${[
        r.anio, r.trim, sqlEscape(r.jurisdiccionCod), sqlEscape(r.programaCod),
        sqlEscape(r.catprogCod), sqlEscape(r.catprogDenom), sqlEscape(r.fuenteCod),
        sqlEscape(r.partidaCod), sqlEscape(r.partidaDenom), r.aprobado ?? "NULL",
        r.vigente ?? "NULL", r.compromiso ?? "NULL", r.devengado ?? "NULL", r.pagado ?? "NULL",
      ].join(",")})`)
      .join(",\n");
    statements.push(
      `INSERT INTO ejecucion (${cols.join(", ")})\nVALUES\n${values}\n` +
        `ON CONFLICT (anio, trim, jurisdiccion_cod, programa_cod, catprog_cod, fuente_cod, partida_cod)\n` +
        `DO UPDATE SET catprog_denom=excluded.catprog_denom, partida_denom=excluded.partida_denom,\n` +
        `  aprobado=excluded.aprobado, vigente=excluded.vigente, compromiso=excluded.compromiso,\n` +
        `  devengado=excluded.devengado, pagado=excluded.pagado, cargado_en=datetime('now');`
    );
  }
  return statements;
}

function buildProgramaInserts(programas) {
  return [...programas.values()].map(
    (p) =>
      `INSERT INTO programas (jurisdiccion_cod, programa_cod, denom) VALUES (${sqlEscape(p.jurisdiccionCod)}, ${sqlEscape(p.programaCod)}, ${sqlEscape(p.denom)}) ` +
      `ON CONFLICT (jurisdiccion_cod, programa_cod) DO UPDATE SET denom=excluded.denom;`
  );
}

function buildPartidaInserts(partidas) {
  return [...partidas.entries()].map(
    ([cod, denom]) =>
      `INSERT INTO partidas (cod, denom) VALUES (${sqlEscape(cod)}, ${sqlEscape(denom)}) ` +
      `ON CONFLICT (cod) DO UPDATE SET denom=excluded.denom;`
  );
}

function buildJurisdiccionInserts(jurisdicciones) {
  return [...jurisdicciones.entries()].map(
    ([cod, denom]) =>
      `INSERT INTO jurisdicciones (cod, denom) VALUES (${sqlEscape(cod)}, ${sqlEscape(denom)}) ` +
      `ON CONFLICT (cod) DO UPDATE SET denom=excluded.denom;`
  );
}

function buildFuenteInserts(fuentes) {
  return [...fuentes.entries()].map(
    ([cod, denom]) =>
      `INSERT INTO fuentes (cod, denom) VALUES (${sqlEscape(cod)}, ${sqlEscape(denom)}) ` +
      `ON CONFLICT (cod) DO UPDATE SET denom=excluded.denom;`
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = args._[0];
  if (!filePath) {
    console.error("Uso: node scripts/import-xlsx.mjs <archivo.xlsx> [--sheet=nombre] [--anio=YYYY] [--datos-sheet=datos]");
    process.exit(1);
  }

  const wb = XLSX.readFile(filePath, { cellDates: false });
  const datosSheetName = args["datos-sheet"] || "datos";

  let jurisdicciones = new Map();
  let fuentes = new Map(FUENTES_DEFAULT);
  if (wb.SheetNames.includes(datosSheetName)) {
    const datosRows = XLSX.utils.sheet_to_json(wb.Sheets[datosSheetName], { header: 1, defval: null });
    const parsed = parseDatosSheet(datosRows);
    jurisdicciones = parsed.jurisdicciones;
    for (const [cod, denom] of parsed.fuentes) fuentes.set(cod, denom);
  }

  const targetSheets = args.sheet
    ? [{ name: args.sheet, anio: args.anio ? Number(args.anio) : null }]
    : wb.SheetNames.filter((n) => /^\d{4}$/.test(n)).map((n) => ({ name: n, anio: Number(n) }));

  if (targetSheets.length === 0) {
    console.error("No se especificó --sheet y no hay hojas con nombre de año (YYYY) para procesar.");
    process.exit(1);
  }

  const allStatements = ["PRAGMA foreign_keys=OFF;", "BEGIN TRANSACTION;"];
  let totalRows = 0;

  for (const { name, anio } of targetSheets) {
    if (!anio) {
      console.error(`Falta --anio para la hoja "${name}" (su nombre no es un año).`);
      process.exit(1);
    }
    if (!wb.SheetNames.includes(name)) {
      console.error(`La hoja "${name}" no existe en el archivo. Hojas disponibles: ${wb.SheetNames.join(", ")}`);
      process.exit(1);
    }
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null });
    const { ejecucion, programas, partidas } = parseFactRows(rows, anio);
    console.log(`Hoja "${name}" (año ${anio}): ${ejecucion.length} filas de ejecución, ${programas.size} programas, ${partidas.size} partidas.`);

    allStatements.push(...buildJurisdiccionInserts(jurisdicciones));
    allStatements.push(...buildFuenteInserts(fuentes));
    allStatements.push(...buildProgramaInserts(programas));
    allStatements.push(...buildPartidaInserts(partidas));
    allStatements.push(...buildEjecucionInserts(ejecucion));

    allStatements.push(
      `INSERT INTO importaciones (archivo, anio, filas) VALUES (${sqlEscape(basename(filePath) + ":" + name)}, ${anio}, ${ejecucion.length});`
    );
    totalRows += ejecucion.length;
  }

  allStatements.push("COMMIT;");

  const outDir = join(__dirname, "out");
  mkdirSync(outDir, { recursive: true });
  const sheetsTag = targetSheets.map((s) => s.name).join("-");
  const outFile = join(outDir, `${basename(filePath, ".xlsx")}.${sheetsTag}.sql`);
  writeFileSync(outFile, allStatements.join("\n\n") + "\n");

  console.log(`\nOK: ${totalRows} filas totales. SQL generado en ${outFile}`);
  console.log(`Para cargarlo en desarrollo local:`);
  console.log(`  npx wrangler d1 execute f17_db --local --file ${outFile}`);
  console.log(`Para cargarlo en producción (Cloudflare):`);
  console.log(`  npx wrangler d1 execute f17_db --remote --file ${outFile}`);
}

main();
