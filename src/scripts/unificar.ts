// Unifica en el navegador los F17 por categoría programática de un programa
// en un solo F17 por programa (misma plantilla), sumando partida por partida
// lo programado. Los Excel no se suben: del servidor solo se piden las
// columnas prellenadas del programa (/api/f17/reporte) y se registra, como en
// cualquier descarga, que el área bajó el F17 de ese programa.

import { compararPartidas, type F17Fila, type F17Reporte } from "../lib/f17";
import { descargarExcel, nombreArchivo } from "./f17-excel";

export type Catalogo = Record<string, { denom: string; programas: Record<string, { denom: string; categorias: Record<string, { denom: string; fuentes: string[] }> }> }>;

interface FilaArchivo {
  partida: string;
  denom: string;
  e: number; // compromiso año anterior
  f: number; // igual trimestre año anterior
  g: number; // crédito vigente
  trim: (number | null)[]; // H..K
  l: number; // disponible
}

export interface Archivo {
  nombre: string;
  jurisdiccion: string;
  jurisdiccionDenom: string;
  catprog: string;
  catprogDenom: string;
  fuente: string;
  fuenteDenom: string;
  trimestre: number;
  datosAl: string; // AAAA-MM-DD
  filas: FilaArchivo[];
}

/** Valor numérico de una celda de ExcelJS: número, fórmula con resultado, o texto "1.234,56". */
function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && v && "result" in v) return numero((v as { result: unknown }).result);
  if (typeof v === "string") {
    let s = v.replace(/[\s$]/g, "");
    if (!s) return null;
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
const texto = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" && v && "result" in v ? String((v as { result: unknown }).result ?? "") : String(v)).trim();
const cod2 = (v: unknown) => texto(v).padStart(2, "0");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function leer(file: File, ExcelJS: any): Promise<Archivo> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error("no es un Excel .xlsx válido");
  }
  const ws = wb.worksheets[0];
  const celda = (ref: string) => ws.getCell(ref).value;
  if (!/jurisdicci/i.test(texto(celda("B2"))) || !/fte/i.test(texto(celda("B7")))) {
    throw new Error("no tiene el formato del F17 de este sitio");
  }
  if (/programa/i.test(texto(celda("B3")))) throw new Error("es un F17 por programa: no hace falta unificarlo");
  if (!/categor/i.test(texto(celda("B3")))) throw new Error("no es un F17 por categoría programática");

  const catprog = texto(celda("D3"));
  if (!/^\d{2}\.\d{2}\.\d{2}$/.test(catprog)) throw new Error(`la categoría «${catprog}» no es válida`);
  const trimestre = Number(texto(celda("D5")));
  if (!(trimestre >= 1 && trimestre <= 4)) throw new Error("no se pudo leer el trimestre (celda D5)");
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(texto(celda("H5")));

  const filas: FilaArchivo[] = [];
  for (let n = 8; n < 8 + 2000; n++) {
    const row = ws.getRow(n);
    const partida = texto(row.getCell(3).value);
    const denom = texto(row.getCell(4).value);
    if (!partida) {
      if (/^total$/i.test(denom) || !denom) break;
      continue;
    }
    filas.push({
      partida,
      denom,
      e: numero(row.getCell(5).value) ?? 0,
      f: numero(row.getCell(6).value) ?? 0,
      g: numero(row.getCell(7).value) ?? 0,
      trim: [8, 9, 10, 11].map((c) => numero(row.getCell(c).value)),
      l: numero(row.getCell(12).value) ?? 0,
    });
  }
  if (!filas.length) throw new Error("no tiene partidas");

  return {
    nombre: file.name,
    jurisdiccion: cod2(celda("D2")),
    jurisdiccionDenom: texto(celda("E2")),
    catprog,
    catprogDenom: texto(celda("E3")),
    fuente: texto(celda("D4")),
    fuenteDenom: texto(celda("E4")),
    trimestre,
    datosAl: m ? `${m[3]}-${m[2]}-${m[1]}` : "",
    filas,
  };
}

const fmt = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dma = (iso: string) => iso.split("-").reverse().join("/");
const escapar = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function iniciarUnificador() {
  const raiz = document.querySelector<HTMLElement>("#unificador");
  if (!raiz) return;
  const catalogo: Catalogo = JSON.parse(raiz.dataset.catalogo ?? "{}");
  const input = raiz.querySelector<HTMLInputElement>("#archivos")!;
  const zona = raiz.querySelector<HTMLElement>("#zona")!;
  const mensajes = raiz.querySelector<HTMLElement>("#mensajes")!;
  const resultado = raiz.querySelector<HTMLElement>("#resultado")!;
  const lista = raiz.querySelector<HTMLElement>("#lista")!;
  const resumen = raiz.querySelector<HTMLElement>("#resumen")!;
  const boton = raiz.querySelector<HTMLButtonElement>("#descargar-unificado")!;
  const limpiar = raiz.querySelector<HTMLButtonElement>("#limpiar")!;

  let archivos: Archivo[] = [];
  const errores: string[] = [];
  const notas: string[] = []; // de la última descarga

  const pintar = () => {
    const avisos: string[] = [];
    const problemas = [...errores];
    const base = archivos[0];
    if (base) {
      for (const a of archivos.slice(1)) {
        if (a.jurisdiccion !== base.jurisdiccion) problemas.push(`${a.nombre}: es de otra jurisdicción (${a.jurisdiccion}).`);
        if (a.catprog.slice(0, 2) !== base.catprog.slice(0, 2)) problemas.push(`${a.nombre}: es de otro programa (${a.catprog.slice(0, 2)}).`);
        if (a.fuente !== base.fuente) problemas.push(`${a.nombre}: es de otra fuente (${a.fuente}).`);
        if (a.trimestre !== base.trimestre) problemas.push(`${a.nombre}: es de otro trimestre (${a.trimestre}).`);
        if (a.datosAl !== base.datosAl) avisos.push(`${a.nombre} tiene datos de RAFAM de otra fecha (${dma(a.datosAl)}).`);
      }
      const vistos = new Set<string>();
      for (const a of archivos) {
        if (vistos.has(a.catprog)) problemas.push(`La categoría ${a.catprog} está repetida.`);
        vistos.add(a.catprog);
      }
      const prog = catalogo[base.jurisdiccion]?.programas[base.catprog.slice(0, 2)];
      if (prog) {
        const faltan = Object.entries(prog.categorias)
          .filter(([cod, c]) => c.fuentes.includes(base.fuente) && !vistos.has(cod))
          .map(([cod, c]) => `${cod} ${c.denom}`);
        if (faltan.length) avisos.push(`Faltan categorías del programa con crédito en la fuente ${base.fuente}: ${faltan.join(" · ")}.`);
      } else if (!catalogo[base.jurisdiccion]) {
        problemas.push(`Tu usuario no tiene acceso a la jurisdicción ${base.jurisdiccion}.`);
      }
    }

    mensajes.innerHTML =
      problemas.map((p) => `<div class="alert alert-error">${escapar(p)}</div>`).join("") +
      avisos.map((p) => `<div class="alert alert-warning">${escapar(p)}</div>`).join("") +
      notas.map((p) => `<div class="alert alert-info">${escapar(p)}</div>`).join("");
    resultado.hidden = archivos.length === 0;
    lista.innerHTML = archivos
      .map((a, i) => {
        const programado = a.filas.reduce((s, f) => s + f.trim.reduce<number>((x, v, t) => x + (t + 1 >= a.trimestre ? v ?? 0 : 0), 0), 0);
        return `<tr><td><strong>${escapar(a.catprog)}</strong> · ${escapar(a.catprogDenom)}</td><td style="font-size:13px;">${escapar(a.nombre)}</td>
          <td class="num">${a.filas.length}</td><td class="num">$ ${fmt(programado)}</td>
          <td><button class="btn btn-secondary btn-sm" type="button" data-quitar="${i}">Quitar</button></td></tr>`;
      })
      .join("");
    if (base) {
      const prog = catalogo[base.jurisdiccion]?.programas[base.catprog.slice(0, 2)];
      resumen.textContent = `Programa ${base.catprog.slice(0, 2)}${prog ? ` · ${prog.denom}` : ""} · Fuente ${base.fuente} · Trimestre ${base.trimestre} · ${archivos.length} categoría(s)`;
    }
    boton.disabled = archivos.length === 0 || problemas.length > 0;
  };

  // Recibe una copia: el navegador vacía la lista del input (y la del arrastre)
  // antes de que termine de cargar ExcelJS.
  const agregar = async (files: File[]) => {
    const mod = await import("exceljs");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ExcelJS: any = (mod as any).default ?? mod;
    errores.length = 0;
    notas.length = 0;
    for (const file of files) {
      try {
        archivos.push(await leer(file, ExcelJS));
      } catch (e) {
        errores.push(`${file.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    archivos.sort((a, b) => a.catprog.localeCompare(b.catprog));
    pintar();
  };

  input.addEventListener("change", () => {
    const files = [...(input.files ?? [])];
    input.value = ""; // para poder volver a elegir el mismo archivo
    if (files.length) agregar(files);
  });
  zona.addEventListener("dragover", (e) => {
    e.preventDefault();
    zona.classList.add("arrastrando");
  });
  zona.addEventListener("dragleave", () => zona.classList.remove("arrastrando"));
  zona.addEventListener("drop", (e) => {
    e.preventDefault();
    zona.classList.remove("arrastrando");
    if (e.dataTransfer?.files.length) agregar([...e.dataTransfer.files]);
  });
  lista.addEventListener("click", (e) => {
    const i = (e.target as HTMLElement).closest<HTMLElement>("[data-quitar]")?.dataset.quitar;
    if (i === undefined) return;
    archivos.splice(Number(i), 1);
    errores.length = 0;
    notas.length = 0;
    pintar();
  });
  limpiar.addEventListener("click", () => {
    archivos = [];
    errores.length = 0;
    notas.length = 0;
    pintar();
  });

  boton.addEventListener("click", async () => {
    const base = archivos[0];
    const texto0 = boton.innerHTML;
    boton.disabled = true;
    boton.textContent = "Generando…";
    notas.length = 0;
    try {
      // Columnas prellenadas: las del F17 por programa (ver unificar()).
      const qs = new URLSearchParams({ jurisdiccion: base.jurisdiccion, programa: base.catprog.slice(0, 2), fuente: base.fuente, trimestre: String(base.trimestre) });
      if (base.datosAl) qs.set("anio", base.datosAl.slice(0, 4));
      const servidor: F17Reporte | null = await fetch(`/api/f17/reporte?${qs}`)
        .then((r) => (r.ok ? (r.json() as Promise<F17Reporte>) : null))
        .catch(() => null);
      const { reporte, valores } = unificar(archivos, catalogo, servidor);
      if (!servidor) {
        notas.push(
          "No se pudieron traer del sitio los datos del programa: el unificado suma lo que traen los Excel (puede faltar el compromiso del año anterior de categorías que este año no tienen crédito)."
        );
      } else if (base.datosAl && servidor.corte.hasta !== base.datosAl) {
        notas.push(
          `El unificado tiene los datos de RAFAM al ${dma(servidor.corte.hasta)} (los Excel eran al ${dma(base.datosAl)}): se actualizaron el crédito vigente, el disponible y los trimestres ejecutados. Revisá que lo programado siga entrando.`
        );
      }
      fetch("/api/f17/descarga", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modo: "programa", trimestre: reporte.trimestre, jurisdiccion: reporte.jurisdiccion.cod, programa: reporte.programa.cod, fuente: reporte.fuente.cod }),
        keepalive: true,
      }).catch(() => undefined);
      await descargarExcel([{ nombre: "F17", reporte, valores }], nombreArchivo(reporte, "_unificado"));
    } catch (e) {
      alert(`No se pudo generar el Excel: ${e instanceof Error ? e.message : e}`);
    } finally {
      boton.innerHTML = texto0;
      pintar();
    }
  });
}

/**
 * Arma el F17 del programa: lo programado (trimestres a cargar) es la suma
 * partida por partida de los Excel de las categorías. Las columnas
 * prellenadas salen del F17 por programa del servidor (`servidor`), igual que
 * al sacarlo por programa: incluye el compromiso del año anterior de
 * categorías que este año no tienen crédito y que por eso no tienen Excel.
 * Sin `servidor` (no se pudo traer), también se suman de los Excel.
 */
export function unificar(
  archivos: Archivo[],
  catalogo: Catalogo,
  servidor?: F17Reporte | null
): { reporte: F17Reporte; valores: (number | null)[][] } {
  const base = archivos[0];
  const T = base.trimestre;
  const programa = base.catprog.slice(0, 2);
  const suma = new Map<string, { denom: string; e: number; f: number; g: number; l: number; trim: (number | null)[] }>();
  for (const a of archivos) {
    for (const f of a.filas) {
      const p = suma.get(f.partida) ?? { denom: f.denom, e: 0, f: 0, g: 0, l: 0, trim: [null, null, null, null] };
      p.e += f.e;
      p.f += f.f;
      p.g += f.g;
      p.l += f.l;
      f.trim.forEach((v, t) => {
        if (v !== null) p.trim[t] = (p.trim[t] ?? 0) + v;
      });
      suma.set(f.partida, p);
    }
  }
  const c2 = (n: number) => Math.round(n * 100) / 100;
  const srv = servidor?.trimestre === T && servidor.fuente.cod === base.fuente ? servidor : null;
  const prellenado = new Map((srv?.filas ?? []).map((f) => [f.partidaCod, f]));
  const orden = [...new Set([...prellenado.keys(), ...suma.keys()])].sort(compararPartidas);
  const filas: F17Fila[] = [];
  const valores: (number | null)[][] = [];
  for (const cod of orden) {
    const p = suma.get(cod);
    const programado = [0, 1, 2, 3].map((t) => (t + 1 >= T && p && p.trim[t] !== null ? c2(p.trim[t]!) : null));
    const s = prellenado.get(cod);
    const fila: F17Fila = s
      ? { ...s }
      : {
          fuenteCod: base.fuente,
          partidaCod: cod,
          partidaDenom: p!.denom,
          compromisoAnioAnterior: c2(p!.e),
          igualTrimestreAnioAnterior: c2(p!.f),
          creditoVigente: c2(p!.g),
          trimestres: [0, 1, 2, 3].map((t) => (t + 1 < T ? c2(p!.trim[t] ?? 0) : null)) as F17Fila["trimestres"],
          disponible: c2(p!.l),
          totalAnual: 0,
          excedida: false,
        };
    if (!s) fila.totalAnual = c2(fila.trimestres.reduce<number>((a, v) => a + (v ?? 0), 0));
    const total = fila.totalAnual + programado.reduce<number>((a, v) => a + (v ?? 0), 0);
    fila.excedida = fila.disponible < 0 || total > fila.creditoVigente;
    filas.push(fila);
    valores.push(programado);
  }
  const sum = (f: (x: F17Fila) => number) => c2(filas.reduce((a, x) => a + f(x), 0));
  const hasta = srv?.corte.hasta || base.datosAl || new Date().toISOString().slice(0, 10);
  const reporte: F17Reporte = {
    anio: Number(hasta.slice(0, 4)),
    corte: srv?.corte ?? { anio: Number(hasta.slice(0, 4)), mes: Number(hasta.slice(5, 7)), hasta, mesesCargados: [], mesesCompletos: [] },
    trimestre: T,
    jurisdiccion: srv?.jurisdiccion ?? { cod: base.jurisdiccion, denom: base.jurisdiccionDenom || catalogo[base.jurisdiccion]?.denom || "" },
    programa: srv?.programa ?? { cod: programa, denom: catalogo[base.jurisdiccion]?.programas[programa]?.denom ?? `Programa ${programa}` },
    catprog: null,
    fuente: srv?.fuente ?? { cod: base.fuente, denom: base.fuenteDenom },
    filas,
    totales: {
      compromisoAnioAnterior: sum((x) => x.compromisoAnioAnterior),
      igualTrimestreAnioAnterior: sum((x) => x.igualTrimestreAnioAnterior),
      creditoVigente: sum((x) => x.creditoVigente),
      trimestres: [0, 1, 2, 3].map((i) => (i + 1 < T ? sum((x) => x.trimestres[i] ?? 0) : null)) as F17Fila["trimestres"],
      disponible: sum((x) => x.disponible),
      totalAnual: sum((x) => x.totalAnual),
    },
  };
  return { reporte, valores };
}
