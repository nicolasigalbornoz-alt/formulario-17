// Lógica del Formulario 17 (Programación Financiera del Compromiso).
//
// Replica la plantilla "f17" de las planillas "registros f17/programa" y
// "registros f17/categoría" (fórmulas de las filas 8 en adelante), con una
// diferencia pedida por la Subsecretaría: el crédito vigente es el
// del último día con información cargada, no el del cierre del trimestre
// anterior.
//
//   Planilla (hoja f17)                        Acá
//   ------------------------------------------ ------------------------------------------
//   D5  Trimestre (elegido a mano)             se elige, pero solo entre los que tienen
//                                              cerrados todos los trimestres anteriores
//   C   UNIQUE(FILTER(partidas, vigente>0,     partidas con vigente > 0 a la fecha de corte
//       trim = D5-1))                          (o con compromiso en el año: salen en rojo)
//   E   SUMIFS(añoant compromiso)              compromiso total del año anterior
//   F   SUMIFS(añoant compromiso, trim = D5)   compromiso del año anterior en el trimestre D5
//   G   SUMIFS(vigente, trim = D5-1)           crédito vigente a la fecha de corte
//   H-K IF(trim < D5, SUMIFS(compromiso))      compromiso de cada trimestre ya cerrado
//   L   G - M                                  ídem
//   M   SUM(H:K)                               ídem
//   rojo: M > G                                ídem ("excedida")
//
// Todas las sumas son por jurisdicción + programa (+ categoría programática
// si se elige una) + fuente + partida. Sin categoría, el programa es la suma
// de todas sus categorías (lo mismo que hacía la macro "SumarPorConcepto"
// del .xlsm de categorías).

export interface CodDenom {
  cod: string;
  denom: string;
}

/** Acceso mínimo a SQL: D1 en el Worker, node:sqlite en los tests. */
export interface Sql {
  all<T>(query: string, ...binds: unknown[]): Promise<T[]>;
}

export function d1(db: D1Database): Sql {
  return {
    async all<T>(query: string, ...binds: unknown[]) {
      const res = await db.prepare(query).bind(...binds).all<T>();
      return res.results ?? [];
    },
  };
}

export interface Corte {
  anio: number;
  /** Mes de la foto más reciente del año. */
  mes: number;
  /** Último día con información (fecha `hasta` del último reporte cargado), AAAA-MM-DD. */
  hasta: string;
  mesesCargados: number[];
  /** Meses con el reporte del mes completo (del 1 al último día). */
  mesesCompletos: number[];
}

export interface F17Fila {
  fuenteCod: string;
  partidaCod: string;
  partidaDenom: string;
  compromisoAnioAnterior: number;
  igualTrimestreAnioAnterior: number;
  creditoVigente: number;
  /** Compromiso de cada trimestre cerrado; null = trimestre a programar. */
  trimestres: [number | null, number | null, number | null, number | null];
  /** Compromiso parcial del trimestre en curso (el que se programa), a la fecha de corte. */
  enCurso: number;
  disponible: number;
  totalAnual: number;
  excedida: boolean;
}

export interface F17Reporte {
  anio: number;
  corte: Corte;
  /** Trimestre que se carga (D5 de la planilla). */
  trimestre: number;
  jurisdiccion: CodDenom;
  programa: CodDenom;
  catprog: CodDenom | null;
  fuente: CodDenom;
  filas: F17Fila[];
  totales: Omit<F17Fila, "fuenteCod" | "partidaCod" | "partidaDenom" | "excedida">;
}

// ---------------------------------------------------------------------------
// Fecha de corte y trimestre

export async function getCorte(sql: Sql, anio?: number | null): Promise<Corte | null> {
  let rows: { anio: number; mes: number; hasta: string; mes_completo: number }[];
  try {
    rows = await sql.all(
      `SELECT anio, mes, hasta, mes_completo FROM rafam_cortes
       WHERE anio = COALESCE(?, (SELECT MAX(anio) FROM rafam_cortes))
       ORDER BY mes`,
      anio ?? null
    );
  } catch (e) {
    // Base sin la migración 0002 aplicada: se muestra "sin datos" en vez de un error.
    if (/no such table/i.test(String(e))) return null;
    throw e;
  }
  if (rows.length === 0) return null;
  const ultimo = rows.reduce((a, b) => (b.hasta > a.hasta ? b : a));
  return {
    anio: ultimo.anio,
    mes: ultimo.mes,
    hasta: ultimo.hasta,
    mesesCargados: rows.map((r) => r.mes),
    mesesCompletos: rows.filter((r) => r.mes_completo).map((r) => r.mes),
  };
}

/** Un trimestre está cerrado cuando sus tres meses están cargados completos. */
export function trimestreCerrado(corte: Corte, t: number): boolean {
  return [3 * t - 2, 3 * t - 1, 3 * t].every((m) => corte.mesesCompletos.includes(m));
}

/**
 * Trimestres que se pueden cargar: solo aquellos cuyos trimestres anteriores
 * del año ya están cerrados (la información del pasado es definitiva). Con
 * datos al 24/09 se pueden elegir el I, el II y el III; el IV recién cuando
 * se cargue septiembre completo.
 */
export function trimestresDisponibles(corte: Corte): number[] {
  let cerrados = 0;
  while (cerrados < 4 && trimestreCerrado(corte, cerrados + 1)) cerrados++;
  return Array.from({ length: Math.min(cerrados + 1, 4) }, (_, i) => i + 1);
}

/** Trimestre que se ofrece por defecto: el más reciente de los disponibles. */
export function trimestreAProgramar(corte: Corte): number {
  return trimestresDisponibles(corte).at(-1)!;
}

/** El trimestre pedido si está disponible; si no, el de por defecto. */
export function trimestreElegido(corte: Corte, pedido: unknown): number {
  const t = Number(pedido);
  return trimestresDisponibles(corte).includes(t) ? t : trimestreAProgramar(corte);
}

export const NOMBRE_TRIMESTRE = ["enero a marzo", "abril a junio", "julio a septiembre", "octubre a diciembre"];

export const trimestreDeMes = (mes: number) => Math.floor((mes - 1) / 3) + 1;

// ---------------------------------------------------------------------------
// Listas para los filtros (año en curso, solo lo que tiene crédito o gasto)

const CON_MOVIMIENTO = "(vigente <> 0 OR compromiso <> 0)";

export async function listJurisdicciones(sql: Sql, corte: Corte): Promise<CodDenom[]> {
  return sql.all<CodDenom>(
    `SELECT jurisdiccion_codigo AS cod, MAX(jurisdiccion) AS denom
     FROM rafam_gastos WHERE anio = ? AND ${CON_MOVIMIENTO}
     GROUP BY jurisdiccion_codigo ORDER BY jurisdiccion_codigo`,
    corte.anio
  );
}

export async function listProgramas(sql: Sql, corte: Corte, jurisdiccion: string): Promise<CodDenom[]> {
  return sql.all<CodDenom>(
    `SELECT programa_codigo AS cod, MAX(programa) AS denom
     FROM rafam_gastos WHERE anio = ? AND jurisdiccion_codigo = ? AND ${CON_MOVIMIENTO}
     GROUP BY programa_codigo ORDER BY programa_codigo`,
    corte.anio,
    jurisdiccion
  );
}

export async function listCategorias(sql: Sql, corte: Corte, jurisdiccion: string, programa: string): Promise<CodDenom[]> {
  return sql.all<CodDenom>(
    `SELECT catprog_codigo AS cod, MAX(catprog) AS denom
     FROM rafam_gastos WHERE anio = ? AND jurisdiccion_codigo = ? AND programa_codigo = ? AND ${CON_MOVIMIENTO}
     GROUP BY catprog_codigo ORDER BY catprog_codigo`,
    corte.anio,
    jurisdiccion,
    programa
  );
}

export interface CategoriaConPrograma extends CodDenom {
  programa: CodDenom;
}

/** Todas las categorías programáticas de una jurisdicción, con su programa (carril "por categoría"). */
export async function listCategoriasJurisdiccion(sql: Sql, corte: Corte, jurisdiccion: string): Promise<CategoriaConPrograma[]> {
  const rows = await sql.all<{ cod: string; denom: string; programa_cod: string; programa_denom: string }>(
    `SELECT catprog_codigo AS cod, MAX(catprog) AS denom, programa_codigo AS programa_cod, MAX(programa) AS programa_denom
     FROM rafam_gastos WHERE anio = ? AND jurisdiccion_codigo = ? AND ${CON_MOVIMIENTO}
     GROUP BY catprog_codigo, programa_codigo ORDER BY catprog_codigo`,
    corte.anio,
    jurisdiccion
  );
  return rows.map((r) => ({ cod: r.cod, denom: r.denom, programa: { cod: r.programa_cod, denom: r.programa_denom } }));
}

export async function listFuentes(
  sql: Sql,
  corte: Corte,
  jurisdiccion: string,
  programa: string,
  catprog?: string | null
): Promise<CodDenom[]> {
  return sql.all<CodDenom>(
    `SELECT fuente_codigo AS cod, MAX(fuente) AS denom
     FROM rafam_gastos
     WHERE anio = ? AND jurisdiccion_codigo = ? AND programa_codigo = ? AND (? IS NULL OR catprog_codigo = ?)
       AND ${CON_MOVIMIENTO}
     GROUP BY fuente_codigo ORDER BY fuente_codigo`,
    corte.anio,
    jurisdiccion,
    programa,
    catprog ?? null,
    catprog ?? null
  );
}

// ---------------------------------------------------------------------------
// Datos de un programa completo (todas sus categorías y fuentes)

interface FilaActual {
  catprog_codigo: string;
  catprog: string;
  fuente_codigo: string;
  fuente: string;
  partida_codigo: string;
  partida: string;
  trim: number;
  compromiso: number;
  vigente: number;
}

interface FilaAnterior {
  catprog_codigo: string;
  fuente_codigo: string;
  partida_codigo: string;
  trim: number;
  compromiso: number;
}

export interface DatosPrograma {
  corte: Corte;
  /** Trimestre que se carga: se puede cambiar antes de armarF17 (ver trimestresDisponibles). */
  trimestre: number;
  jurisdiccion: CodDenom;
  programa: CodDenom;
  categorias: CodDenom[];
  fuentes: CodDenom[];
  actual: FilaActual[];
  anterior: FilaAnterior[];
}

export async function getDatosPrograma(
  sql: Sql,
  corte: Corte,
  jurisdiccion: string,
  programa: string
): Promise<DatosPrograma | null> {
  const [actual, anterior, nombres] = await Promise.all([
    // Compromiso por trimestre y vigente de la foto de corte, en una pasada.
    sql.all<FilaActual>(
      `SELECT catprog_codigo, MAX(catprog) AS catprog, fuente_codigo, MAX(fuente) AS fuente,
              partida_codigo, MAX(partida) AS partida, (mes + 2) / 3 AS trim,
              SUM(compromiso) AS compromiso,
              SUM(CASE WHEN mes = ? THEN vigente ELSE 0 END) AS vigente
       FROM rafam_gastos
       WHERE anio = ? AND jurisdiccion_codigo = ? AND programa_codigo = ?
       GROUP BY catprog_codigo, fuente_codigo, partida_codigo, trim`,
      corte.mes,
      corte.anio,
      jurisdiccion,
      programa
    ),
    sql.all<FilaAnterior>(
      `SELECT catprog_codigo, fuente_codigo, partida_codigo, (mes + 2) / 3 AS trim, SUM(compromiso) AS compromiso
       FROM rafam_gastos
       WHERE anio = ? AND jurisdiccion_codigo = ? AND programa_codigo = ?
       GROUP BY catprog_codigo, fuente_codigo, partida_codigo, trim`,
      corte.anio - 1,
      jurisdiccion,
      programa
    ),
    sql.all<{ jurisdiccion: string; programa: string }>(
      `SELECT MAX(jurisdiccion) AS jurisdiccion, MAX(programa) AS programa
       FROM rafam_gastos WHERE anio = ? AND jurisdiccion_codigo = ? AND programa_codigo = ?`,
      corte.anio,
      jurisdiccion,
      programa
    ),
  ]);
  if (actual.length === 0 || !nombres[0]?.programa) return null;

  const categorias = new Map<string, string>();
  const fuentes = new Map<string, string>();
  for (const r of actual) {
    if (r.vigente === 0 && r.compromiso === 0) continue;
    categorias.set(r.catprog_codigo, r.catprog);
    fuentes.set(r.fuente_codigo, r.fuente);
  }
  const ordenar = (m: Map<string, string>) =>
    [...m].map(([cod, denom]) => ({ cod, denom })).sort((a, b) => a.cod.localeCompare(b.cod));

  return {
    corte,
    trimestre: trimestreAProgramar(corte),
    jurisdiccion: { cod: jurisdiccion, denom: nombres[0].jurisdiccion },
    programa: { cod: programa, denom: nombres[0].programa },
    categorias: ordenar(categorias),
    fuentes: ordenar(fuentes),
    actual,
    anterior,
  };
}

// ---------------------------------------------------------------------------
// Armado del formulario (puro: se usa en el servidor y en el navegador)

const cero = () => [0, 0, 0, 0] as [number, number, number, number];
/** Redondeo a centavos: las sumas en coma flotante dejan residuos (…719,410001). */
const c2 = (n: number) => Math.round(n * 100) / 100;

export function armarF17(datos: DatosPrograma, fuente: string, catprog?: string | null): F17Reporte | null {
  const fuenteDenom = datos.fuentes.find((f) => f.cod === fuente)?.denom;
  if (!fuenteDenom) return null;
  const catprogInfo = catprog ? datos.categorias.find((c) => c.cod === catprog) ?? null : null;
  if (catprog && !catprogInfo) return null;

  const enAlcance = (r: { catprog_codigo: string; fuente_codigo: string }) =>
    r.fuente_codigo === fuente && (!catprog || r.catprog_codigo === catprog);

  const T = datos.trimestre;
  const cerrado = (t: number) => t < T;

  const porPartida = new Map<string, { denom: string; vigente: number; comp: [number, number, number, number]; ant: [number, number, number, number] }>();
  const get = (cod: string, denom = "") => {
    let p = porPartida.get(cod);
    if (!p) {
      p = { denom, vigente: 0, comp: cero(), ant: cero() };
      porPartida.set(cod, p);
    }
    if (!p.denom && denom) p.denom = denom;
    return p;
  };

  for (const r of datos.actual) {
    if (!enAlcance(r)) continue;
    const p = get(r.partida_codigo, r.partida);
    p.vigente += r.vigente;
    p.comp[r.trim - 1] += r.compromiso;
  }
  for (const r of datos.anterior) {
    if (!enAlcance(r)) continue;
    // Una partida que solo tuvo gasto el año pasado no entra al formulario
    // (la planilla también partía de las partidas del año en curso).
    const p = porPartida.get(r.partida_codigo);
    if (p) p.ant[r.trim - 1] += r.compromiso;
  }

  const filas: F17Fila[] = [];
  for (const [partidaCod, p] of porPartida) {
    const trimestres = [1, 2, 3, 4].map((t) => (cerrado(t) ? c2(p.comp[t - 1]) : null)) as F17Fila["trimestres"];
    const totalAnual = c2(trimestres.reduce<number>((a, v) => a + (v ?? 0), 0));
    const vigente = c2(p.vigente);
    if (!(vigente > 0 || totalAnual !== 0)) continue;
    filas.push({
      fuenteCod: fuente,
      partidaCod,
      partidaDenom: p.denom,
      compromisoAnioAnterior: c2(p.ant.reduce((a, v) => a + v, 0)),
      igualTrimestreAnioAnterior: c2(p.ant[T - 1]),
      creditoVigente: vigente,
      trimestres,
      enCurso: c2(p.comp[T - 1]),
      disponible: c2(vigente - totalAnual),
      totalAnual,
      excedida: totalAnual > vigente,
    });
  }
  filas.sort((a, b) => compararPartidas(a.partidaCod, b.partidaCod));

  const sum = (f: (x: F17Fila) => number) => c2(filas.reduce((a, x) => a + f(x), 0));
  const totales = {
    compromisoAnioAnterior: sum((x) => x.compromisoAnioAnterior),
    igualTrimestreAnioAnterior: sum((x) => x.igualTrimestreAnioAnterior),
    creditoVigente: sum((x) => x.creditoVigente),
    trimestres: [0, 1, 2, 3].map((i) => (cerrado(i + 1) ? sum((x) => x.trimestres[i] ?? 0) : null)) as F17Fila["trimestres"],
    enCurso: sum((x) => x.enCurso),
    disponible: sum((x) => x.disponible),
    totalAnual: sum((x) => x.totalAnual),
  };

  return {
    anio: datos.corte.anio,
    corte: datos.corte,
    trimestre: T,
    jurisdiccion: datos.jurisdiccion,
    programa: datos.programa,
    catprog: catprogInfo,
    fuente: { cod: fuente, denom: fuenteDenom },
    filas,
    totales,
  };
}

/** Orden numérico de partidas: 1.1.1.0 < 1.1.10.0 < 2.1.1.0. */
export function compararPartidas(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function fechaCorta(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export const TRIMESTRE_ROMANO = ["I", "II", "III", "IV"];
