// Lógica del Formulario 17: reconstruida a partir de las fórmulas de la
// planilla "registros f17" (hoja `f17`, filas 8+). Ver migrations/0001_init.sql
// para el modelo de datos.
//
// Diferencia clave respecto de la planilla original: acá no hay selector de
// trimestre. El "trimestre actual" se calcula como el último trimestre con
// datos cargados para el filtro elegido (MAX(trim)), y el "crédito vigente"
// es el vigente de ESE trimestre — es decir, el vigente al último día
// disponible de información, no el de un trimestre elegido a mano.

export interface CodDenom {
  cod: string;
  denom: string;
}

export interface F17Row {
  partidaCod: string;
  partidaDenom: string;
  creditoVigente: number;
  compromisoAnioAnterior: number;
  igualTrimestreAnioAnterior: number;
  trimestres: [number | null, number | null, number | null, number | null];
  totalAnual: number;
  disponible: number;
  excedido: boolean;
}

export interface F17Report {
  anio: number;
  anioAnterior: number;
  trimActual: number;
  jurisdiccion: CodDenom;
  programa: CodDenom;
  catprog: CodDenom | null;
  fuente: CodDenom;
  filas: F17Row[];
}

export interface F17Params {
  jurisdiccionCod: string;
  programaCod: string;
  fuenteCod: string;
  catprogCod?: string | null;
  anio?: number | null;
}

async function first<T = Record<string, unknown>>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T | null> {
  const row = await db.prepare(sql).bind(...binds).first<T>();
  return row ?? null;
}

async function all<T = Record<string, unknown>>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T[]> {
  const res = await db.prepare(sql).bind(...binds).all<T>();
  return res.results ?? [];
}

/** Último año con datos cargados (no hay selector de año en la UI: siempre se muestra el más reciente). */
export async function getUltimoAnioDisponible(db: D1Database): Promise<number | null> {
  const row = await first<{ anio: number }>(db, "SELECT MAX(anio) as anio FROM ejecucion");
  return row?.anio ?? null;
}

export async function listJurisdicciones(db: D1Database): Promise<CodDenom[]> {
  return all<CodDenom>(
    db,
    `SELECT DISTINCT j.cod as cod, j.denom as denom
     FROM jurisdicciones j
     JOIN ejecucion e ON e.jurisdiccion_cod = j.cod
     ORDER BY CAST(j.cod AS INTEGER)`
  );
}

export async function listProgramas(db: D1Database, jurisdiccionCod: string): Promise<CodDenom[]> {
  return all<CodDenom>(
    db,
    `SELECT DISTINCT p.programa_cod as cod, p.denom as denom
     FROM programas p
     JOIN ejecucion e ON e.jurisdiccion_cod = p.jurisdiccion_cod AND e.programa_cod = p.programa_cod
     WHERE p.jurisdiccion_cod = ?
     ORDER BY p.denom`,
    jurisdiccionCod
  );
}

export async function listCategoriasProgramaticas(
  db: D1Database,
  jurisdiccionCod: string,
  programaCod: string
): Promise<CodDenom[]> {
  return all<CodDenom>(
    db,
    `SELECT DISTINCT catprog_cod as cod, catprog_denom as denom
     FROM ejecucion
     WHERE jurisdiccion_cod = ? AND programa_cod = ? AND catprog_cod IS NOT NULL
     ORDER BY catprog_cod`,
    jurisdiccionCod,
    programaCod
  );
}

export async function listFuentes(
  db: D1Database,
  jurisdiccionCod: string,
  programaCod: string,
  catprogCod?: string | null
): Promise<CodDenom[]> {
  const catprogClause = catprogCod ? "AND e.catprog_cod = ?" : "";
  const binds = catprogCod
    ? [jurisdiccionCod, programaCod, catprogCod]
    : [jurisdiccionCod, programaCod];
  return all<CodDenom>(
    db,
    `SELECT DISTINCT f.cod as cod, f.denom as denom
     FROM fuentes f
     JOIN ejecucion e ON e.fuente_cod = f.cod
     WHERE e.jurisdiccion_cod = ? AND e.programa_cod = ? ${catprogClause}
     ORDER BY f.cod`,
    ...binds
  );
}

export async function getF17Report(db: D1Database, params: F17Params): Promise<F17Report | null> {
  const { jurisdiccionCod, programaCod, fuenteCod } = params;
  const catprogCod = params.catprogCod || null;
  const catprogClause = catprogCod ? "AND catprog_cod = ?" : "";
  const scopeBinds = (extra: unknown[] = []) =>
    catprogCod
      ? [jurisdiccionCod, programaCod, fuenteCod, catprogCod, ...extra]
      : [jurisdiccionCod, programaCod, fuenteCod, ...extra];

  const anio = params.anio ?? (await getUltimoAnioDisponible(db));
  if (!anio) return null;
  const anioAnterior = anio - 1;

  const [jurisdiccion, programa, fuente, catprog] = await Promise.all([
    first<CodDenom>(db, "SELECT cod, denom FROM jurisdicciones WHERE cod = ?", jurisdiccionCod),
    first<CodDenom>(db, "SELECT denom FROM programas WHERE jurisdiccion_cod = ? AND programa_cod = ?", jurisdiccionCod, programaCod).then(
      (r) => (r ? { cod: programaCod, denom: r.denom } : null)
    ),
    first<CodDenom>(db, "SELECT cod, denom FROM fuentes WHERE cod = ?", fuenteCod),
    catprogCod
      ? first<{ denom: string }>(
          db,
          "SELECT catprog_denom as denom FROM ejecucion WHERE jurisdiccion_cod=? AND programa_cod=? AND catprog_cod=? LIMIT 1",
          jurisdiccionCod,
          programaCod,
          catprogCod
        ).then((r) => (r ? { cod: catprogCod, denom: r.denom } : null))
      : Promise.resolve(null),
  ]);

  if (!jurisdiccion || !programa || !fuente) return null;

  const trimRow = await first<{ trim: number }>(
    db,
    `SELECT MAX(trim) as trim FROM ejecucion WHERE anio = ? AND jurisdiccion_cod = ? AND programa_cod = ? AND fuente_cod = ? ${catprogClause}`,
    anio,
    ...scopeBinds()
  );
  const trimActual = trimRow?.trim ?? 0;

  // Partidas activas (crédito vigente > 0) al último trimestre disponible, sumando
  // entre categorías programáticas cuando no se filtra por una en particular.
  const partidasRows = await all<{ partida_cod: string; partida_denom: string; vigente: number }>(
    db,
    `SELECT partida_cod, MAX(partida_denom) as partida_denom, SUM(vigente) as vigente
     FROM ejecucion
     WHERE anio = ? AND trim = ? AND jurisdiccion_cod = ? AND programa_cod = ? AND fuente_cod = ? ${catprogClause}
     GROUP BY partida_cod
     HAVING SUM(vigente) > 0
     ORDER BY partida_cod`,
    anio,
    trimActual,
    ...scopeBinds()
  );

  const trimestralRows =
    trimActual > 0
      ? await all<{ partida_cod: string; trim: number; compromiso: number }>(
          db,
          `SELECT partida_cod, trim, SUM(compromiso) as compromiso
           FROM ejecucion
           WHERE anio = ? AND trim BETWEEN 1 AND ? AND jurisdiccion_cod = ? AND programa_cod = ? AND fuente_cod = ? ${catprogClause}
           GROUP BY partida_cod, trim`,
          anio,
          trimActual,
          ...scopeBinds()
        )
      : [];

  const anteriorTotalRows = await all<{ partida_cod: string; compromiso: number }>(
    db,
    `SELECT partida_cod, SUM(compromiso) as compromiso
     FROM ejecucion
     WHERE anio = ? AND jurisdiccion_cod = ? AND programa_cod = ? AND fuente_cod = ? ${catprogClause}
     GROUP BY partida_cod`,
    anioAnterior,
    ...scopeBinds()
  );

  const anteriorMismoTrimRows =
    trimActual > 0
      ? await all<{ partida_cod: string; compromiso: number }>(
          db,
          `SELECT partida_cod, SUM(compromiso) as compromiso
           FROM ejecucion
           WHERE anio = ? AND trim = ? AND jurisdiccion_cod = ? AND programa_cod = ? AND fuente_cod = ? ${catprogClause}
           GROUP BY partida_cod`,
          anioAnterior,
          trimActual,
          ...scopeBinds()
        )
      : [];

  const trimestralByPartida = new Map<string, Map<number, number>>();
  for (const r of trimestralRows) {
    if (!trimestralByPartida.has(r.partida_cod)) trimestralByPartida.set(r.partida_cod, new Map());
    trimestralByPartida.get(r.partida_cod)!.set(r.trim, r.compromiso ?? 0);
  }
  const anteriorTotalByPartida = new Map(anteriorTotalRows.map((r) => [r.partida_cod, r.compromiso ?? 0]));
  const anteriorMismoTrimByPartida = new Map(anteriorMismoTrimRows.map((r) => [r.partida_cod, r.compromiso ?? 0]));

  const filas: F17Row[] = partidasRows.map((p) => {
    const trims = trimestralByPartida.get(p.partida_cod);
    const trimestres: [number | null, number | null, number | null, number | null] = [1, 2, 3, 4].map((t) =>
      t <= trimActual ? trims?.get(t) ?? 0 : null
    ) as [number | null, number | null, number | null, number | null];
    const totalAnual = trimestres.reduce<number>((acc, v) => acc + (v ?? 0), 0);
    const creditoVigente = p.vigente ?? 0;
    return {
      partidaCod: p.partida_cod,
      partidaDenom: p.partida_denom,
      creditoVigente,
      compromisoAnioAnterior: anteriorTotalByPartida.get(p.partida_cod) ?? 0,
      igualTrimestreAnioAnterior: anteriorMismoTrimByPartida.get(p.partida_cod) ?? 0,
      trimestres,
      totalAnual,
      disponible: creditoVigente - totalAnual,
      excedido: totalAnual > creditoVigente,
    };
  });

  return {
    anio,
    anioAnterior,
    trimActual,
    jurisdiccion,
    programa,
    catprog,
    fuente,
    filas,
  };
}
