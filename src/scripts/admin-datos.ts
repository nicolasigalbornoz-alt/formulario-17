// Subida manual de un reporte de gastos de RAFAM desde el panel. El .xls se
// lee y se interpreta en el navegador (mismo parser que el script de
// sincronización) y al servidor solo viaja el resultado: así el Worker no
// gasta CPU leyendo un Excel de 1 MB.

import { parseReporteGastos } from "../lib/rafam-gastos.mjs";

type Reporte = ReturnType<typeof parseReporteGastos>;

const COLS = [
  "jurisdiccion_codigo", "jurisdiccion", "programa_codigo", "programa", "catprog_codigo", "catprog",
  "fuente_codigo", "fuente", "inciso", "partida_codigo", "partida",
  "aprobado", "modificaciones", "vigente", "preventivo", "compromiso", "devengado", "pagado",
] as const;

const pesos = (n: number) => `$ ${n.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;

export function iniciarSubidaRafam() {
  const form = document.querySelector<HTMLFormElement>("#subir-reporte");
  if (!form) return;
  const input = form.querySelector<HTMLInputElement>("input[type=file]")!;
  const boton = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
  const vista = form.querySelector<HTMLDivElement>("#vista-previa")!;
  let reporte: Reporte | null = null;
  let archivo = "";

  const mostrar = (clase: string, html: string) => {
    vista.hidden = false;
    vista.className = `alert ${clase}`;
    vista.innerHTML = html;
  };

  input.addEventListener("change", async () => {
    reporte = null;
    boton.disabled = true;
    const file = input.files?.[0];
    if (!file) return;
    archivo = file.name;
    mostrar("alert-warning", "Leyendo el archivo…");
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true }) as unknown[][];
      reporte = parseReporteGastos(filas);
      if (!reporte.filas.length) throw new Error("El reporte no tiene partidas con importes.");
      const vig = reporte.filas.reduce((a, f) => a + Number(f.vigente), 0);
      const comp = reporte.filas.reduce((a, f) => a + Number(f.compromiso), 0);
      const juris = new Set(reporte.filas.map((f) => f.jurisdiccion_codigo)).size;
      const p = reporte.periodo;
      mostrar(
        "alert-success",
        `<strong>Del ${p.desde.split("-").reverse().join("/")} al ${p.hasta.split("-").reverse().join("/")}</strong>` +
          `${p.mesCompleto ? "" : " (mes parcial)"}<br>${reporte.filas.length.toLocaleString("es-AR")} partidas · ${juris} jurisdicciones<br>` +
          `Crédito vigente ${pesos(vig)} · Compromiso del mes ${pesos(comp)}` +
          (reporte.avisos.length ? `<br><small>${reporte.avisos.length} aviso(s): ${reporte.avisos.slice(0, 2).join(" · ")}</small>` : "")
      );
      boton.disabled = false;
    } catch (e) {
      mostrar("alert-error", `No se pudo leer: ${e instanceof Error ? e.message : e}`);
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!reporte) return;
    boton.disabled = true;
    boton.textContent = "Cargando…";
    try {
      const res = await fetch("/api/admin/rafam", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          archivo,
          periodo: reporte.periodo,
          columnas: COLS,
          filas: reporte.filas.map((f) => COLS.map((c) => f[c])),
        }),
      });
      const body = (await res.json().catch(() => ({ error: `Error ${res.status}` }))) as { error?: string; mensaje?: string };
      if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
      location.href = `/admin/datos?ok=1&msg=${encodeURIComponent(body.mensaje ?? "Reporte cargado.")}`;
    } catch (err) {
      mostrar("alert-error", `No se pudo cargar: ${err instanceof Error ? err.message : err}`);
      boton.disabled = false;
      boton.textContent = "Cargar";
    }
  });
}

interface ResultadoSync {
  anio: number;
  mes: number;
  hasta: string;
  filas: number;
  omitido?: string;
  jurisdiccionesOmitidas: string[];
  error?: string;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function iniciarSyncRafamor() {
  const boton = document.querySelector<HTMLButtonElement>("#sync-rafamor-boton");
  const vista = document.querySelector<HTMLDivElement>("#sync-rafamor-resultado");
  if (!boton || !vista) return;

  const mostrar = (clase: string, html: string) => {
    vista.hidden = false;
    vista.className = `alert ${clase}`;
    vista.innerHTML = html;
  };

  boton.addEventListener("click", async () => {
    boton.disabled = true;
    boton.textContent = "Sincronizando…";
    mostrar("alert-warning", "Consultando RAFAMOR SQL…");
    try {
      const res = await fetch("/api/admin/sync-rafamor", { method: "POST" });
      const r = (await res.json()) as ResultadoSync;
      if (!res.ok || r.error) throw new Error(r.error ?? `Error ${res.status}`);
      const mesTxt = r.mes ? `${MESES[r.mes - 1]} de ${r.anio}` : "";
      if (r.omitido) {
        mostrar("alert-warning", r.omitido);
      } else {
        mostrar(
          "alert-success",
          `<strong>${mesTxt}</strong> actualizado al ${r.hasta.split("-").reverse().join("/")}: ${r.filas.toLocaleString("es-AR")} partidas.` +
            (r.jurisdiccionesOmitidas.length
              ? `<br><small>Sin código de jurisdicción, no se sincronizaron: ${r.jurisdiccionesOmitidas.join(", ")}.</small>`
              : "")
        );
      }
      setTimeout(() => location.reload(), r.omitido ? 0 : 1500);
    } catch (err) {
      mostrar("alert-error", `No se pudo sincronizar: ${err instanceof Error ? err.message : err}`);
    } finally {
      boton.disabled = false;
      boton.textContent = "Sincronizar ahora";
    }
  });
}
