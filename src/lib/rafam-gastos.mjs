// Parser del reporte "ESTADO DE EJECUCION DEL PRESUPUESTO DE GASTOS" de
// RAFAM (.xls), el mismo que baja a diario el pipeline de RAFAMOR
// (rafam_ejecutado_bg.py -> ejecutados_AAAA/gastos_mensual/*.xls) y el que
// cualquiera puede exportar a mano desde RAFAM.
//
// Se usa desde el script de sincronización (Node) y desde la subida manual
// del panel admin (Worker), por eso recibe filas ya leídas (array de arrays)
// y no depende de ninguna librería.
//
// Estructura del reporte (una fila de planilla por renglón impreso):
//   "Del 01/09/2026 al 24/09/2026"                 -> período (col 7)
//   "Jurisdicción: 1110106000 - Subjurisdicción X"  -> col 0
//   "Apertura Programática:" | "01.00.00 - Actividad Central"  -> programa (col 0 + col 3)
//   "01.18.00 - Control Comunal"                    -> categoría programática (col 3)
//   "Apertura Programática:17.00.00 - Administración de Infractores"
//                                                    -> programa SIN actividades: todo en col 0
//   "110 - Tesoro Municipal"                        -> fuente (col 0)
//   "1.1.1.0 - Retribuciones del cargo"             -> partida (col 2); la fila
//                                                      siguiente trae los importes (cols 5..14)
//
// Diferencias a propósito con el parser de RAFAMOR (generar_base_mensual.py):
//  - Reconoce la apertura programática escrita toda en la columna 0
//    ("Apertura Programática:17.00.00 - ..."). RAFAMOR no la ve y asigna esos
//    gastos a la categoría anterior (ej. el programa 17 de Control Comunal
//    termina sumado a 01.18.00).
//  - El código de jurisdicción sale del propio código RAFAM (1110106000 -> 06)
//    en vez de buscar el nombre en una tabla: así "Servicios de la Deuda",
//    "Jefatura de Gabinete" o "Sec. de Mujeres..." no quedan sin código.

const PERIODO_RE = /Del (\d{2})\/(\d{2})\/(\d{4}) al (\d{2})\/(\d{2})\/(\d{4})/;
const JURIS_RE = /^Jurisdicci[oó]n:\s*(\d{10})\s*-\s*(.+)$/;
const APERTURA_RE = /^Apertura Program[aá]tica:\s*(.*)$/;
const CATPROG_RE = /^(\d{2})\.(\d{2})\.(\d{2})\s*-\s*(.+)$/;
const PARTIDA_RE = /^(\d+\.\d+\.\d+\.\d+)\s*-\s*(.+)$/;
const FUENTE_RE = /^(\d{2,4})\s*-\s*(.+)$/;
const FILTRO_RE = /^Filtro aplicado:\s*(.+)$/i;

const str = (v) => (typeof v === "string" ? v.trim() : "");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** "1110106000" -> "06"; H.C.D. ("1110200000", otro poder) -> "00". */
export function jurisdiccionCodigo(rafamCod) {
  if (rafamCod.slice(3, 5) === "01") return rafamCod.slice(5, 7);
  return "00";
}

/** "Subjurisdicción  Economía y Finanzas" -> "Economía y Finanzas". */
function limpiarJurisdiccion(nombre) {
  return nombre.replace(/^Subjurisdicci[oó]n\s+/i, "").replace(/\s+/g, " ").trim();
}

function iso(d, m, y) {
  return `${y}-${m}-${d}`;
}

function ultimoDiaDelMes(anio, mes) {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/**
 * @param {unknown[][]} rows filas del reporte (header: 1, defval: null)
 * @returns {{
 *   periodo: { anio: number, mes: number, desde: string, hasta: string, mesCompleto: boolean },
 *   filas: Array<Record<string, string|number|null>>,
 *   avisos: string[],
 *   filtro: string | null
 * }}
 */
export function parseReporteGastos(rows) {
  let periodo = null;
  for (let i = 0; i < Math.min(rows.length, 20) && !periodo; i++) {
    for (const cell of rows[i] ?? []) {
      const m = PERIODO_RE.exec(str(cell));
      if (m) {
        const [, d1, m1, y1, d2, m2, y2] = m;
        periodo = { desde: iso(d1, m1, y1), hasta: iso(d2, m2, y2), anio: Number(y1), mes: Number(m1), m2: Number(m2), y2: Number(y2), d2: Number(d2) };
        break;
      }
    }
  }
  if (!periodo) throw new Error("No encontré el rango 'Del dd/mm/aaaa al dd/mm/aaaa': ¿es el reporte de Estado de Ejecución de Gastos de RAFAM?");
  if (periodo.m2 !== periodo.mes || periodo.y2 !== periodo.anio) {
    throw new Error(
      `El reporte va del ${periodo.desde} al ${periodo.hasta} y cruza meses. Exportalo de a un mes (del día 1 al último día del mes, o hasta hoy si es el mes en curso).`
    );
  }
  if (periodo.desde.slice(8) !== "01") {
    throw new Error(`El reporte empieza el ${periodo.desde}: tiene que arrancar el día 1 del mes para que el compromiso del mes quede completo.`);
  }
  const mesCompleto = periodo.d2 === ultimoDiaDelMes(periodo.anio, periodo.mes);

  const filas = [];
  const avisos = [];
  // Al pie: "Filtro aplicado: Ejercicio: 2026 - Jurisdicción: 1110107000 - Categoría Programática: 39.00.00 al 39.00.00 - ..."
  let filtro = null;
  let juris = null; // { codigo, nombre }
  let programa = null; // { codigo, nombre }
  let catprog = null; // { codigo, nombre }
  let fuente = null; // { codigo, nombre }

  const setApertura = (texto) => {
    const m = CATPROG_RE.exec(texto);
    if (!m) return false;
    const [, prog, act, obra, nombre] = m;
    const codigo = `${prog}.${act}.${obra}`;
    if (act === "00" && obra === "00") {
      // Encabezado de programa. Si el programa no tiene actividades, él mismo
      // es la categoría programática (hasta que aparezca una actividad).
      programa = { codigo: prog, nombre: nombre.trim() };
      catprog = { codigo, nombre: nombre.trim() };
    } else {
      if (!programa || programa.codigo !== prog) programa = { codigo: prog, nombre: nombre.trim() };
      catprog = { codigo, nombre: nombre.trim() };
    }
    fuente = null;
    return true;
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const c0 = str(row[0]);
    const c2 = str(row[2]);
    const c3 = str(row[3]);

    if (c0) {
      const mj = JURIS_RE.exec(c0);
      if (mj) {
        juris = { codigo: jurisdiccionCodigo(mj[1]), nombre: limpiarJurisdiccion(mj[2]) };
        programa = catprog = fuente = null;
        continue;
      }
      const ma = APERTURA_RE.exec(c0);
      if (ma) {
        const resto = ma[1].trim();
        if (resto) setApertura(resto);
        else if (c3) setApertura(c3);
        continue;
      }
      if (/^total/i.test(c0)) continue;
      const mfi = FILTRO_RE.exec(c0);
      if (mfi) {
        filtro = mfi[1].trim();
        continue;
      }
      const mf = FUENTE_RE.exec(c0);
      if (mf && !c2) {
        fuente = { codigo: mf[1], nombre: mf[2].trim() };
        continue;
      }
    }

    if (!c0 && c3 && CATPROG_RE.test(c3)) {
      setApertura(c3);
      continue;
    }

    const mp = PARTIDA_RE.exec(c2);
    if (mp) {
      const next = rows[i + 1] ?? [];
      if (!isNum(next[5])) continue; // partida agrupadora (1.0.0.0, 1.1.0.0): sin importes
      if (!juris || !catprog || !fuente) {
        avisos.push(`Fila ${i + 1}: partida ${mp[1]} sin jurisdicción/categoría/fuente previa; se omite.`);
        continue;
      }
      filas.push({
        anio: periodo.anio,
        mes: periodo.mes,
        jurisdiccion_codigo: juris.codigo,
        jurisdiccion: juris.nombre,
        programa_codigo: programa.codigo,
        programa: programa.nombre,
        catprog_codigo: catprog.codigo,
        catprog: catprog.nombre,
        fuente_codigo: fuente.codigo,
        fuente: fuente.nombre,
        inciso: mp[1].split(".")[0],
        partida_codigo: mp[1],
        partida: mp[2].trim(),
        aprobado: num(next[5]),
        modificaciones: num(next[6]),
        vigente: num(next[7]),
        preventivo: num(next[8]),
        compromiso: num(next[9]),
        devengado: num(next[10]),
        pagado: num(next[11]),
      });
      i += 1;
    }
  }

  // Un mismo reporte puede repetir una combinación (misma partida listada dos
  // veces bajo la misma categoría/fuente): se consolida sumando.
  const porClave = new Map();
  for (const f of filas) {
    const k = `${f.jurisdiccion_codigo}|${f.catprog_codigo}|${f.fuente_codigo}|${f.partida_codigo}`;
    const prev = porClave.get(k);
    if (!prev) {
      porClave.set(k, { ...f });
    } else {
      for (const c of ["aprobado", "modificaciones", "vigente", "preventivo", "compromiso", "devengado", "pagado"]) prev[c] += f[c];
    }
  }

  return {
    periodo: { anio: periodo.anio, mes: periodo.mes, desde: periodo.desde, hasta: periodo.hasta, mesCompleto },
    filas: [...porClave.values()],
    avisos,
    filtro,
  };
}
