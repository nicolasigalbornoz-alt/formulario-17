import type { APIRoute } from "astro";
import * as XLSX from "xlsx";
import { getF17Report } from "../../../lib/f17";

export const GET: APIRoute = async ({ url, locals }) => {
  const jurisdiccionCod = url.searchParams.get("jurisdiccion");
  const programaCod = url.searchParams.get("programa");
  const fuenteCod = url.searchParams.get("fuente");
  const catprogCod = url.searchParams.get("catprog");

  if (!jurisdiccionCod || !programaCod || !fuenteCod) {
    return new Response("Faltan parámetros (jurisdiccion, programa, fuente)", { status: 400 });
  }

  const db = locals.runtime.env.DB;
  const report = await getF17Report(db, { jurisdiccionCod, programaCod, fuenteCod, catprogCod });
  if (!report) return new Response("Sin datos para ese filtro", { status: 404 });

  const header = [
    ["Jurisdicción:", `${report.jurisdiccion.cod} - ${report.jurisdiccion.denom}`],
    ["Programa:", `${report.programa.cod} - ${report.programa.denom}`],
    ...(report.catprog ? [["Categoría programática:", `${report.catprog.cod} - ${report.catprog.denom}`]] : []),
    ["Fuente:", `${report.fuente.cod} - ${report.fuente.denom}`],
    ["Año:", report.anio],
    ["Último trimestre con datos:", report.trimActual || "—"],
    [],
  ];

  const tableHeader = [
    "Partida",
    "Denominación",
    "Compromiso Año Anterior",
    "Igual Trimestre Año Anterior",
    "Crédito Vigente",
    "Trimestre I",
    "Trimestre II",
    "Trimestre III",
    "Trimestre IV",
    "Disponible",
    "Total anual",
    "Estado",
  ];

  const rows = report.filas.map((f) => [
    f.partidaCod,
    f.partidaDenom,
    f.compromisoAnioAnterior,
    f.igualTrimestreAnioAnterior,
    f.creditoVigente,
    f.trimestres[0],
    f.trimestres[1],
    f.trimestres[2],
    f.trimestres[3],
    f.disponible,
    f.totalAnual,
    f.excedido ? "EXCEDIDO (total anual supera al crédito vigente)" : "",
  ]);

  const sheetData = [...header, tableHeader, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws["!cols"] = [
    { wch: 10 },
    { wch: 40 },
    { wch: 18 },
    { wch: 20 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
    { wch: 14 },
    { wch: 30 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "F17");
  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });

  const catSuffix = report.catprog ? `_C${report.catprog.cod}` : "";
  const filename = `F17_J${report.jurisdiccion.cod}_P${report.programa.cod}${catSuffix}_F${report.fuente.cod}.xlsx`;

  return new Response(buffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
};
