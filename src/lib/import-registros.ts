// Carga en D1 de filas ya interpretadas por src/lib/registros.mjs.
// Usado por el endpoint de subida de archivos del panel admin (reemplaza el
// loop de AppScript).

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface EjecucionRow {
  anio: number;
  trim: number;
  jurisdiccionCod: string;
  programaCod: string;
  catprogCod: string | null;
  catprogDenom: string | null;
  fuenteCod: string;
  partidaCod: string;
  partidaDenom: string | null;
  aprobado: number | null;
  vigente: number | null;
  compromiso: number | null;
  devengado: number | null;
  pagado: number | null;
}

export interface ImportResult {
  filas: number;
  programas: number;
  partidas: number;
}

export async function importarEjecucion(
  db: D1Database,
  ejecucion: EjecucionRow[],
  programas: Map<string, { jurisdiccionCod: string; programaCod: string; denom: string }>,
  partidas: Map<string, string>,
  jurisdicciones: Map<string, string>,
  fuentes: Map<string, string>,
  archivo: string
): Promise<ImportResult> {
  for (const [cod, denom] of jurisdicciones) {
    await db
      .prepare("INSERT INTO jurisdicciones (cod, denom) VALUES (?, ?) ON CONFLICT (cod) DO UPDATE SET denom=excluded.denom")
      .bind(cod, denom)
      .run();
  }
  for (const [cod, denom] of fuentes) {
    await db
      .prepare("INSERT INTO fuentes (cod, denom) VALUES (?, ?) ON CONFLICT (cod) DO UPDATE SET denom=excluded.denom")
      .bind(cod, denom)
      .run();
  }
  for (const p of programas.values()) {
    await db
      .prepare(
        "INSERT INTO programas (jurisdiccion_cod, programa_cod, denom) VALUES (?, ?, ?) ON CONFLICT (jurisdiccion_cod, programa_cod) DO UPDATE SET denom=excluded.denom"
      )
      .bind(p.jurisdiccionCod, p.programaCod, p.denom)
      .run();
  }
  for (const [cod, denom] of partidas) {
    await db
      .prepare("INSERT INTO partidas (cod, denom) VALUES (?, ?) ON CONFLICT (cod) DO UPDATE SET denom=excluded.denom")
      .bind(cod, denom)
      .run();
  }

  const upsert = db.prepare(
    `INSERT INTO ejecucion (anio, trim, jurisdiccion_cod, programa_cod, catprog_cod, catprog_denom, fuente_cod, partida_cod, partida_denom, aprobado, vigente, compromiso, devengado, pagado)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (anio, trim, jurisdiccion_cod, programa_cod, catprog_cod, fuente_cod, partida_cod)
     DO UPDATE SET catprog_denom=excluded.catprog_denom, partida_denom=excluded.partida_denom,
       aprobado=excluded.aprobado, vigente=excluded.vigente, compromiso=excluded.compromiso,
       devengado=excluded.devengado, pagado=excluded.pagado, cargado_en=datetime('now')`
  );

  for (const group of chunk(ejecucion, 100)) {
    const statements = group.map((r) =>
      upsert.bind(
        r.anio,
        r.trim,
        r.jurisdiccionCod,
        r.programaCod,
        r.catprogCod,
        r.catprogDenom,
        r.fuenteCod,
        r.partidaCod,
        r.partidaDenom,
        r.aprobado,
        r.vigente,
        r.compromiso,
        r.devengado,
        r.pagado
      )
    );
    await db.batch(statements);
  }

  await db
    .prepare("INSERT INTO importaciones (archivo, anio, filas) VALUES (?, ?, ?)")
    .bind(archivo, ejecucion[0]?.anio ?? 0, ejecucion.length)
    .run();

  return { filas: ejecucion.length, programas: programas.size, partidas: partidas.size };
}
