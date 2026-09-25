// Lógica compartida para interpretar las planillas "registros f17"
// (hojas basevig / añoant / vigente / 2024 / 2025 / 2026, y la hoja "datos").
//
// Todas las hojas de hechos comparten el mismo orden de columnas, aunque los
// encabezados varíen levemente entre archivos:
//   A trim | B jurisdicción | C jur_denom | D programa | E prog_denom
//   F catprog | G catprog_denom | H fuente | I partida | J partida_denom
//   K aprobado | L vigente | M compromiso | N devengado | [O pagado]
//
// Se usa la posición de columna, no el nombre del encabezado, porque el
// nombre cambia entre hojas ("jur_denom" vs "juris", "denominacion" repetido
// para catprog_denom y partida_denom, etc).

const FACT_COLS = {
  trim: 0,
  jurisdiccion: 1,
  jurDenom: 2,
  programa: 3,
  progDenom: 4,
  catprog: 5,
  catprogDenom: 6,
  fuente: 7,
  partida: 8,
  partidaDenom: 9,
  aprobado: 10,
  vigente: 11,
  compromiso: 12,
  devengado: 13,
  pagado: 14,
};

/** Normaliza un código numérico (jurisdicción, programa, fuente) a texto sin ceros a la izquierda. */
export function normalizeCod(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isNaN(n)) return String(Math.trunc(n));
  return String(value).trim();
}

/** Normaliza un código de partida/categoría programática (mantiene formato con puntos). */
function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function isHeaderRow(row) {
  const first = String(row?.[0] ?? "").trim().toLowerCase();
  return first === "trim";
}

/**
 * Interpreta las filas crudas (array de arrays, primera fila = encabezado)
 * de una hoja de hechos y devuelve filas normalizadas + dimensiones
 * derivadas (programas, partidas) que aparecen en esos datos.
 *
 * @param {any[][]} rows
 * @param {number} anio
 * @returns {{ ejecucion: object[], programas: Map<string, {jurisdiccionCod:string, programaCod:string, denom:string}>, partidas: Map<string,string> }}
 */
export function parseFactRows(rows, anio) {
  const ejecucion = [];
  const programas = new Map();
  const partidas = new Map();

  for (const row of rows) {
    if (!row || row.length === 0) continue;
    if (isHeaderRow(row)) continue;

    const jurisdiccionCod = normalizeCod(row[FACT_COLS.jurisdiccion]);
    const programaCod = normalizeCod(row[FACT_COLS.programa]);
    const fuenteCod = normalizeCod(row[FACT_COLS.fuente]);
    const partidaCod = normalizeText(row[FACT_COLS.partida]);
    const trim = toNumber(row[FACT_COLS.trim]);

    // Fila vacía / de separación.
    if (!jurisdiccionCod || !programaCod || !fuenteCod || !partidaCod || trim === null) {
      continue;
    }

    const catprogCod = normalizeText(row[FACT_COLS.catprog]);
    const catprogDenom = normalizeText(row[FACT_COLS.catprogDenom]);
    const partidaDenom = normalizeText(row[FACT_COLS.partidaDenom]);
    const progDenom = normalizeText(row[FACT_COLS.progDenom]);

    ejecucion.push({
      anio,
      trim,
      jurisdiccionCod,
      programaCod,
      catprogCod,
      catprogDenom,
      fuenteCod,
      partidaCod,
      partidaDenom,
      aprobado: toNumber(row[FACT_COLS.aprobado]),
      vigente: toNumber(row[FACT_COLS.vigente]),
      compromiso: toNumber(row[FACT_COLS.compromiso]),
      devengado: toNumber(row[FACT_COLS.devengado]),
      pagado: toNumber(row[FACT_COLS.pagado]),
    });

    if (progDenom) {
      programas.set(`${jurisdiccionCod}_${programaCod}`, {
        jurisdiccionCod,
        programaCod,
        denom: progDenom,
      });
    }
    if (partidaDenom) {
      partidas.set(partidaCod, partidaDenom);
    }
  }

  return { ejecucion, programas, partidas };
}

/**
 * Interpreta la hoja "datos" (dimensiones jurisdicción/fuente).
 * Columnas: A jur | B jur_denom | C programa_cod (jur_prog) | D programa_denom | E fuente | F fuente_denom
 * @param {any[][]} rows
 */
export function parseDatosSheet(rows) {
  const jurisdicciones = new Map();
  const fuentes = new Map();

  for (const row of rows.slice(1)) {
    if (!row) continue;
    const jur = normalizeCod(row[0]);
    const jurDenom = normalizeText(row[1]);
    if (jur && jurDenom) jurisdicciones.set(jur, jurDenom);

    const fuente = normalizeCod(row[4]);
    const fuenteDenom = normalizeText(row[5]);
    if (fuente && fuenteDenom) fuentes.set(fuente, fuenteDenom);
  }

  return { jurisdicciones, fuentes };
}

/** Fuentes de financiamiento conocidas, usadas como respaldo si el archivo no trae hoja "datos". */
export const FUENTES_DEFAULT = new Map([
  ["110", "Tesoro municipal"],
  ["131", "Afectado municipal"],
  ["132", "Afectado provincial"],
  ["133", "Afectado nacional"],
]);
