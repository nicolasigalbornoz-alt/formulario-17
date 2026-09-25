import type { APIRoute } from "astro";
import * as XLSX from "xlsx";
import { parseFactRows, parseDatosSheet, FUENTES_DEFAULT } from "../../../lib/registros.mjs";
import { importarEjecucion, type EjecucionRow } from "../../../lib/import-registros";

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const db = locals.runtime.env.DB;
  const form = await request.formData();
  const file = form.get("archivo");
  const anio = Number(form.get("anio"));
  const sheetName = String(form.get("hoja") || "").trim();

  if (!(file instanceof File) || !anio) {
    return redirect("/admin/importar?error=faltan_datos");
  }

  let wb: XLSX.WorkBook;
  try {
    const buf = await file.arrayBuffer();
    wb = XLSX.read(buf, { type: "array" });
  } catch {
    return redirect("/admin/importar?error=archivo_invalido");
  }

  const targetSheet = sheetName || wb.SheetNames[0];
  if (!wb.SheetNames.includes(targetSheet)) {
    return redirect(`/admin/importar?error=hoja_inexistente`);
  }

  let jurisdicciones = new Map<string, string>();
  let fuentes = new Map<string, string>(FUENTES_DEFAULT);
  if (wb.SheetNames.includes("datos")) {
    const datosRows = XLSX.utils.sheet_to_json(wb.Sheets["datos"], { header: 1, defval: null }) as unknown[][];
    const parsed = parseDatosSheet(datosRows);
    jurisdicciones = parsed.jurisdicciones;
    for (const [cod, denom] of parsed.fuentes) fuentes.set(cod, denom);
  }

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[targetSheet], { header: 1, defval: null }) as unknown[][];
  const parsed = parseFactRows(rows, anio) as {
    ejecucion: EjecucionRow[];
    programas: Map<string, { jurisdiccionCod: string; programaCod: string; denom: string }>;
    partidas: Map<string, string>;
  };
  const { ejecucion, programas, partidas } = parsed;

  if (ejecucion.length === 0) {
    return redirect("/admin/importar?error=sin_filas");
  }

  const resultado = await importarEjecucion(db, ejecucion, programas, partidas, jurisdicciones, fuentes, file.name);

  return redirect(`/admin/importar?ok=1&filas=${resultado.filas}`);
};
