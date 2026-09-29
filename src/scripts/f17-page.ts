// Comportamiento de /formulario-17 en el navegador: filtros encadenados, el
// switch programa/categoría y la descarga a Excel. La página no guarda nada
// de lo que se programa: los trimestres se completan en el Excel.

import type { F17Reporte } from "../lib/f17";
import { descargarExcel, nombreArchivo } from "./f17-excel";

export function iniciarFiltros() {
  const form = document.querySelector<HTMLFormElement>("#filtros");
  if (!form) return;
  // (cast: @cloudflare/workers-types redefine Element y choca con HTMLSelectElement)
  const campo = (name: string) => form.querySelector(`[name="${name}"]`) as unknown as HTMLSelectElement | null;
  const enviar = () => {
    // Un select deshabilitado no viaja en el GET: se habilitan antes de enviar.
    form.querySelectorAll("select").forEach((s) => ((s as unknown as HTMLSelectElement).disabled = false));
    form.submit();
  };
  const limpiar = (...nombres: string[]) => nombres.forEach((n) => campo(n) && (campo(n)!.value = ""));

  form.querySelectorAll<HTMLInputElement>('input[name="modo"]').forEach((radio) =>
    radio.addEventListener("change", () => {
      // Cambiar de carril arranca de cero (se conservan trimestre y jurisdicción).
      limpiar("programa", "catprog", "fuente");
      enviar();
    })
  );
  campo("trimestre")?.addEventListener("change", enviar);
  campo("jurisdiccion")?.addEventListener("change", () => {
    limpiar("programa", "catprog", "fuente");
    enviar();
  });
  campo("programa")?.addEventListener("change", () => {
    limpiar("fuente");
    enviar();
  });
  campo("catprog")?.addEventListener("change", () => {
    limpiar("fuente");
    enviar();
  });
  campo("fuente")?.addEventListener("change", enviar);
}

/** Deja constancia de la descarga para el seguimiento (no frena la descarga si falla). */
function registrar(r: F17Reporte, modo: "programa" | "categoria") {
  fetch("/api/f17/descarga", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      modo,
      trimestre: r.trimestre,
      jurisdiccion: r.jurisdiccion.cod,
      programa: r.programa.cod,
      catprog: r.catprog?.cod ?? null,
      fuente: r.fuente.cod,
    }),
    keepalive: true,
  }).catch(() => undefined);
}

export function iniciarDescargas() {
  const seccion = document.querySelector<HTMLElement>("#f17");
  if (!seccion?.dataset.reporte) return;
  const reporte: F17Reporte = JSON.parse(seccion.dataset.reporte);
  const modo = seccion.dataset.modo === "categoria" ? "categoria" : "programa";
  const otras = (seccion.dataset.otras ?? "").split(",").filter(Boolean);
  const aviso = reporte.catprog
    ? `Sacado por categoría programática. El F17 se carga en RAFAM por programa: unificalo con las demás categorías ` +
      `del programa ${reporte.programa.cod}${otras.length ? ` (${otras.join(", ")})` : ""} en «Unificar categorías» antes de cargarlo.`
    : undefined;

  const boton = seccion.querySelector<HTMLButtonElement>("#descargar")!;
  boton.addEventListener("click", async () => {
    const texto = boton.innerHTML;
    boton.disabled = true;
    boton.textContent = "Generando…";
    try {
      registrar(reporte, modo);
      await descargarExcel([{ nombre: "F17", reporte, aviso }], nombreArchivo(reporte));
    } catch (e) {
      alert(`No se pudo generar el Excel: ${e instanceof Error ? e.message : e}`);
    } finally {
      boton.disabled = false;
      boton.innerHTML = texto;
    }
  });
}
