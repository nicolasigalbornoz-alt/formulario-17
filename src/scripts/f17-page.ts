// Comportamiento de /formulario-17 en el navegador: filtros encadenados,
// trimestres a programar editables (recalculan Disponible, Total anual y el
// rojo de "excedida" como las fórmulas de la plantilla) y descargas a Excel.

import { armarF17, type DatosPrograma, type F17Reporte } from "../lib/f17";
import { descargarExcel, nombreArchivo, nombreHoja, type HojaF17 } from "./f17-excel";

const fmt = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1.234.567,89", "1234567,89" o "1234567.89" -> número; vacío -> null. */
export function parseMonto(texto: string): number | null {
  let s = texto.replace(/[\s$]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function iniciarFiltros() {
  const form = document.querySelector<HTMLFormElement>("#filtros");
  if (!form) return;
  // (cast: @cloudflare/workers-types redefine Element y choca con HTMLSelectElement)
  const campo = (id: string) => form.querySelector(`#${id}`) as unknown as HTMLSelectElement;
  const [jurisdiccion, programa, catprog, fuente] = ["jurisdiccion", "programa", "catprog", "fuente"].map(campo);
  const enviar = () => {
    // Un select deshabilitado no viaja en el GET: se habilitan antes de enviar.
    for (const s of [programa, catprog, fuente]) s.disabled = false;
    form.submit();
  };
  jurisdiccion.addEventListener("change", () => {
    programa.value = catprog.value = fuente.value = "";
    enviar();
  });
  programa.addEventListener("change", () => {
    catprog.value = fuente.value = "";
    enviar();
  });
  catprog.addEventListener("change", enviar);
  fuente.addEventListener("change", enviar);
}

export function iniciarFormulario() {
  const seccion = document.querySelector<HTMLElement>("#f17");
  if (!seccion?.dataset.reporte) return;
  const reporte: F17Reporte = JSON.parse(seccion.dataset.reporte);
  const tabla = seccion.querySelector<HTMLTableElement>("#f17-tabla")!;
  const filasDom = [...tabla.querySelectorAll<HTMLTableRowElement>("tbody tr")];

  // Lo cargado queda guardado en este navegador, por formulario.
  const clave = [
    "f17",
    reporte.anio,
    reporte.trimestre,
    reporte.jurisdiccion.cod,
    reporte.programa.cod,
    reporte.catprog?.cod ?? "-",
    reporte.fuente.cod,
  ].join(":");
  const programado: (number | null)[][] = reporte.filas.map(() => [null, null, null, null]);
  try {
    const guardado = JSON.parse(localStorage.getItem(clave) ?? "null");
    if (guardado && typeof guardado === "object") {
      reporte.filas.forEach((f, i) => {
        const v = guardado[f.partidaCod];
        if (Array.isArray(v)) programado[i] = v.map((x) => (typeof x === "number" ? x : null));
      });
    }
  } catch {
    /* sin almacenamiento disponible: se trabaja igual */
  }
  const guardar = () => {
    try {
      const obj: Record<string, (number | null)[]> = {};
      reporte.filas.forEach((f, i) => {
        if (programado[i].some((v) => v !== null)) obj[f.partidaCod] = programado[i];
      });
      localStorage.setItem(clave, JSON.stringify(obj));
    } catch {
      /* ídem */
    }
  };

  const recalcular = () => {
    const totTrim = [0, 0, 0, 0];
    let totAnual = 0;
    let totDisp = 0;
    reporte.filas.forEach((f, i) => {
      const valores = f.trimestres.map((v, t) => v ?? programado[i][t] ?? 0);
      const total = valores.reduce((a, v) => a + v, 0);
      const disponible = f.creditoVigente - total;
      valores.forEach((v, t) => (totTrim[t] += v));
      totAnual += total;
      totDisp += disponible;
      const tr = filasDom[i];
      tr.querySelector("[data-total]")!.textContent = fmt(total);
      tr.querySelector("[data-disponible]")!.textContent = fmt(disponible);
      tr.classList.toggle("excedida", total > f.creditoVigente + 0.005);
    });
    totTrim.forEach((v, t) => {
      const td = tabla.querySelector(`[data-total-trim="${t}"]`);
      if (td) td.textContent = fmt(v);
    });
    tabla.querySelector("[data-total-anual]")!.textContent = fmt(totAnual);
    tabla.querySelector("[data-total-disponible]")!.textContent = fmt(totDisp);
  };

  filasDom.forEach((tr, i) => {
    tr.querySelectorAll<HTMLInputElement>("input[data-trim]").forEach((input) => {
      const t = Number(input.dataset.trim);
      const inicial = programado[i][t];
      if (inicial !== null) input.value = fmt(inicial);
      input.addEventListener("input", () => {
        programado[i][t] = parseMonto(input.value);
        input.setCustomValidity(input.value.trim() && programado[i][t] === null ? "Monto inválido" : "");
        recalcular();
        guardar();
      });
      input.addEventListener("blur", () => {
        const v = programado[i][t];
        if (v !== null) input.value = fmt(v);
      });
    });
  });
  recalcular();

  const boton = seccion.querySelector<HTMLButtonElement>("#descargar")!;
  boton.addEventListener("click", async () => {
    await conEspera(boton, () =>
      descargarExcel([{ nombre: "F17", reporte, programado }], nombreArchivo(reporte))
    );
  });

  const botonPrograma = seccion.querySelector<HTMLButtonElement>("#descargar-programa")!;
  botonPrograma.addEventListener("click", async () => {
    await conEspera(botonPrograma, async () => {
      const qs = new URLSearchParams({
        jurisdiccion: botonPrograma.dataset.jurisdiccion!,
        programa: botonPrograma.dataset.programa!,
      });
      const res = await fetch(`/api/f17/programa?${qs}`);
      if (!res.ok) throw new Error(await res.text());
      const datos: DatosPrograma = await res.json();
      const usados = new Set<string>();
      const hojas: HojaF17[] = [];
      for (const f of datos.fuentes) {
        const total = armarF17(datos, f.cod, null);
        if (total?.filas.length) hojas.push({ nombre: nombreHoja(`F${f.cod} Programa ${datos.programa.cod}`, usados), reporte: total });
        for (const c of datos.categorias) {
          const r = armarF17(datos, f.cod, c.cod);
          if (r?.filas.length) hojas.push({ nombre: nombreHoja(`F${f.cod} ${c.cod}`, usados), reporte: r });
        }
      }
      if (!hojas.length) throw new Error("El programa no tiene partidas para exportar.");
      await descargarExcel(hojas, nombreArchivo(hojas[0].reporte, true));
    });
  });
}

async function conEspera(boton: HTMLButtonElement, tarea: () => Promise<void>) {
  const texto = boton.innerHTML;
  boton.disabled = true;
  boton.textContent = "Generando…";
  try {
    await tarea();
  } catch (e) {
    alert(`No se pudo generar el Excel: ${e instanceof Error ? e.message : e}`);
  } finally {
    boton.disabled = false;
    boton.innerHTML = texto;
  }
}
