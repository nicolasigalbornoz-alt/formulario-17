// Arma el Excel del F17 en el navegador con el mismo formato que la plantilla
// "f17" de las planillas registros f17 (encabezado, leyenda, colores de
// trimestres, fórmulas de Disponible y Total anual, y el formato condicional
// que pinta de rojo las partidas excedidas). Reemplaza al loop de AppScript
// que generaba un archivo por combinación: acá el Excel es solo una forma de
// guardar lo que se ve en pantalla.

import type { F17Reporte } from "../lib/f17";
import { fechaCorta, TRIMESTRE_ROMANO } from "../lib/f17";

export interface HojaF17 {
  nombre: string;
  reporte: F17Reporte;
  /** Montos cargados a mano en los trimestres a programar: [fila][trimestre 0..3]. */
  programado?: (number | null)[][];
}

const NAVY = "FF000A1E";
const GRIS = "FF666666";
const AZUL = "FF305480";
const ROJO = "FFC00000";
const BLANCO = "FFFFFFFF";
const NUM = "#,##0.00";

const solid = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Nombre de hoja válido para Excel (máx. 31 caracteres, sin : \ / ? * [ ]). */
export function nombreHoja(texto: string, usados: Set<string>): string {
  let base = texto.replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Hoja";
  let nombre = base;
  for (let i = 2; usados.has(nombre.toLowerCase()); i++) nombre = `${base.slice(0, 28)} ${i}`;
  usados.add(nombre.toLowerCase());
  return nombre;
}

export function nombreArchivo(r: F17Reporte, completo = false): string {
  const t = r.trimestre ? `T${pad2(r.trimestre)}` : `${r.anio}`;
  if (completo) return `F17_${t}_J${r.jurisdiccion.cod}_P${r.programa.cod}_completo.xlsx`;
  const est = r.catprog ? `C${r.catprog.cod}` : `P${r.programa.cod}`;
  return `F17_${t}_J${r.jurisdiccion.cod}_${est}_F${r.fuente.cod}.xlsx`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function agregarHoja(wb: any, hoja: HojaF17) {
  const r = hoja.reporte;
  const T = r.trimestre;
  const ws = wb.addWorksheet(hoja.nombre, {
    views: [{ state: "frozen", ySplit: 7, showGridLines: false }],
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [2.7, 8.1, 11.4, 46.6, 17.3, 17.3, 17.3, 15.5, 15.5, 15.5, 15.5, 18, 17.3].map((width) => ({ width }));

  const etiqueta = (celda: string, rango: string, texto: string) => {
    ws.mergeCells(rango);
    const c = ws.getCell(celda);
    c.value = texto;
    c.font = { bold: true, color: { argb: NAVY } };
  };
  const valor = (celda: string, v: string | number, rango?: string) => {
    if (rango) ws.mergeCells(rango);
    const c = ws.getCell(celda);
    c.value = v;
    c.alignment = { horizontal: "left" };
  };

  etiqueta("B2", "B2:C2", "Jurisdicción:");
  valor("D2", Number(r.jurisdiccion.cod));
  valor("E2", r.jurisdiccion.denom, "E2:F2");
  if (r.catprog) {
    etiqueta("B3", "B3:C3", "Categoría:");
    valor("D3", r.catprog.cod);
    valor("E3", r.catprog.denom, "E3:F3");
  } else {
    etiqueta("B3", "B3:C3", "Programa:");
    valor("D3", Number(r.programa.cod));
    valor("E3", r.programa.denom, "E3:F3");
  }
  etiqueta("B4", "B4:C4", "Fuente:");
  valor("D4", Number(r.fuente.cod));
  valor("E4", r.fuente.denom, "E4:F4");
  etiqueta("B5", "B5:C5", "Trimestre:");
  valor("D5", T ? pad2(T) : "—", "D5:F5");

  // Leyenda (igual que la plantilla)
  ws.getCell("H2").value = "si la partida se ve";
  const asi = ws.getCell("I2");
  asi.value = "así";
  asi.fill = solid(ROJO);
  asi.font = { bold: true, color: { argb: BLANCO } };
  asi.alignment = { horizontal: "center" };
  ws.getCell("J2").value = "está excedida";
  ws.mergeCells("H3:J3");
  ws.getCell("H3").value = "(total anual supera al crédito vigente)";
  for (const [rango, texto, color] of [
    ["L2:M2", "trimestre ejecutado", GRIS],
    ["L3:M3", "trimestre a programar", AZUL],
  ] as const) {
    ws.mergeCells(rango);
    const c = ws.getCell(rango.split(":")[0]);
    c.value = texto;
    c.fill = solid(color);
    c.font = { bold: true, color: { argb: BLANCO } };
    c.alignment = { horizontal: "center" };
  }
  ws.mergeCells("H5:M5");
  const fuenteDatos = ws.getCell("H5");
  fuenteDatos.value = `Datos de RAFAM al ${fechaCorta(r.corte.hasta)} · crédito vigente a esa fecha`;
  fuenteDatos.font = { italic: true, color: { argb: GRIS } };

  for (let t = 1; t <= 4; t++) {
    const c = ws.getCell(6, 7 + t);
    c.value = pad2(t);
    c.font = { color: { argb: "FFCCCCCC" } };
    c.fill = solid("FFF2F2F2");
    c.alignment = { horizontal: "center" };
  }

  const encabezados = [
    "Fte. de Fin.",
    "Partida",
    "Denominación",
    "Compromiso del Año Anterior",
    "Igual Trimestre Año Anterior",
    "Crédito Vigente",
    ...TRIMESTRE_ROMANO.map((x) => `Trimestre ${x}`),
    T ? `Disponible (al trim. ${pad2(T)})` : "Disponible",
    "Total anual",
  ];
  const fila7 = ws.getRow(7);
  fila7.height = 32;
  encabezados.forEach((texto, i) => {
    const c = fila7.getCell(2 + i);
    c.value = texto;
    const t = i - 5; // 1..4 para las columnas de trimestres
    const color = t >= 1 && t <= 4 ? (T !== null && t >= T ? AZUL : GRIS) : NAVY;
    c.fill = solid(color);
    c.font = { bold: true, color: { argb: BLANCO } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });

  const primera = 8;
  r.filas.forEach((f, i) => {
    const n = primera + i;
    const row = ws.getRow(n);
    row.getCell(2).value = Number(f.fuenteCod);
    row.getCell(3).value = f.partidaCod;
    row.getCell(4).value = f.partidaDenom;
    row.getCell(5).value = f.compromisoAnioAnterior;
    row.getCell(6).value = f.igualTrimestreAnioAnterior;
    row.getCell(7).value = f.creditoVigente;
    f.trimestres.forEach((v, t) => {
      const cargado = hoja.programado?.[i]?.[t];
      const valor = v ?? cargado ?? null;
      if (valor !== null) row.getCell(8 + t).value = valor;
    });
    const total = f.trimestres.reduce<number>((a, v, t) => a + (v ?? hoja.programado?.[i]?.[t] ?? 0), 0);
    row.getCell(12).value = { formula: `G${n}-M${n}`, result: f.creditoVigente - total };
    row.getCell(13).value = { formula: `SUM(H${n}:K${n})`, result: total };
    row.getCell(2).alignment = { horizontal: "center" };
    row.getCell(3).alignment = { horizontal: "center" };
    for (let c = 5; c <= 13; c++) row.getCell(c).numFmt = NUM;
  });

  const ultima = primera + Math.max(r.filas.length, 1) - 1;
  if (r.filas.length) {
    ws.addConditionalFormatting({
      ref: `B${primera}:M${ultima}`,
      rules: [
        {
          type: "expression",
          priority: 1,
          formulae: [`$M${primera}>$G${primera}`],
          style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: ROJO } }, font: { color: { argb: BLANCO } } },
        },
        {
          type: "expression",
          priority: 2,
          formulae: [`$G${primera}=0`],
          style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFD9D9D9" } }, font: { color: { argb: GRIS } } },
        },
      ],
    });

    const tot = ws.getRow(ultima + 1);
    tot.getCell(4).value = "Total";
    for (let c = 5; c <= 13; c++) {
      const col = String.fromCharCode(64 + c);
      tot.getCell(c).value = { formula: `SUM(${col}${primera}:${col}${ultima})` };
      tot.getCell(c).numFmt = NUM;
    }
    tot.eachCell((c: { font: unknown; border: unknown }) => {
      c.font = { bold: true };
      c.border = { top: { style: "thin", color: { argb: GRIS } } };
    });
  }

  const nota = ws.getCell(`B${ultima + 3}`);
  nota.value =
    "Este archivo no reemplaza la carga del Formulario 17 en RAFAM: es una plantilla prellenada. Distribuí las partidas en los trimestres a programar según el instructivo y después cargalas en RAFAM.";
  nota.font = { italic: true, color: { argb: GRIS } };
}

export async function generarLibro(hojas: HojaF17[]): Promise<ArrayBuffer> {
  const mod = await import("exceljs");
  // exceljs se publica como UMD: según el bundler llega como default o como namespace.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExcelJS: any = (mod as any).default ?? mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Dirección de Presupuesto · Municipio de Morón";
  wb.created = new Date();
  for (const h of hojas) agregarHoja(wb, h);
  return wb.xlsx.writeBuffer();
}

export async function descargarExcel(hojas: HojaF17[], archivo: string) {
  const buffer = await generarLibro(hojas);
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = archivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
