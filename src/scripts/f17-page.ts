// Comportamiento de /formulario-17 en el navegador: filtros encadenados, el
// switch programa/categoría y las descargas a Excel. La página no guarda
// nada de lo que se programa: los trimestres se completan en el Excel.

import { armarF17, type DatosPrograma, type F17Reporte } from "../lib/f17";
import { descargarExcel, nombreArchivo, nombreHoja, type HojaF17 } from "./f17-excel";

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
      // Cambiar de carril arranca de cero (se conserva la jurisdicción).
      limpiar("programa", "catprog", "fuente");
      enviar();
    })
  );
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

/** Deja constancia de la descarga para el seguimiento (no bloquea la descarga si falla). */
function registrar(datos: {
  modo: "programa" | "categoria" | "completo";
  jurisdiccion: string;
  programa: string;
  catprog?: string | null;
  fuente?: string | null;
}) {
  fetch("/api/f17/descarga", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(datos),
    keepalive: true,
  }).catch(() => undefined);
}

function avisoConsolidar(r: F17Reporte, otras: string[]): string | undefined {
  if (!r.catprog) return undefined;
  return (
    `Sacado por categoría programática. El F17 se carga en RAFAM por programa: consolidalo con las demás categorías ` +
    `del programa ${r.programa.cod}${otras.length ? ` (${otras.join(", ")})` : ""} antes de cargarlo.`
  );
}

export function iniciarDescargas() {
  const seccion = document.querySelector<HTMLElement>("#f17");
  if (!seccion?.dataset.reporte) return;
  const reporte: F17Reporte = JSON.parse(seccion.dataset.reporte);
  const modo = seccion.dataset.modo === "categoria" ? "categoria" : "programa";

  const boton = seccion.querySelector<HTMLButtonElement>("#descargar")!;
  boton.addEventListener("click", async () => {
    await conEspera(boton, async () => {
      const otras = (seccion.dataset.otras ?? "").split(",").filter(Boolean);
      registrar({
        modo,
        jurisdiccion: reporte.jurisdiccion.cod,
        programa: reporte.programa.cod,
        catprog: reporte.catprog?.cod ?? null,
        fuente: reporte.fuente.cod,
      });
      await descargarExcel([{ nombre: "F17", reporte, aviso: avisoConsolidar(reporte, otras) }], nombreArchivo(reporte));
    });
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
          if (r?.filas.length) {
            const otras = datos.categorias.filter((x) => x.cod !== c.cod).map((x) => x.cod);
            hojas.push({ nombre: nombreHoja(`F${f.cod} ${c.cod}`, usados), reporte: r, aviso: avisoConsolidar(r, otras) });
          }
        }
      }
      if (!hojas.length) throw new Error("El programa no tiene partidas para exportar.");
      registrar({ modo: "completo", jurisdiccion: datos.jurisdiccion.cod, programa: datos.programa.cod });
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
