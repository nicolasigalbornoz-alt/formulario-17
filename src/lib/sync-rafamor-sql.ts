// Sincronización automática desde la API de RAFAMOR SQL (lectura, se
// regenera a diario con lo que baja RAFAMOR): mantiene fresco el mes en
// curso en `rafam_gastos` sin depender de que alguien corra
// `sync-rafamor.mjs` a mano en la PC de RAFAMOR. La llaman:
//  - src/pages/api/cron/sync-rafamor.ts (tarea programada, ver worker/index.mjs)
//  - src/pages/api/admin/sync-rafamor.ts (botón "Sincronizar ahora" del panel)
//
// Nunca toca un mes que ya quedó cerrado con un reporte de RAFAM (subido en
// el panel o con sync-rafamor.mjs): ver `mesYaCerrado`.
//
// Limitaciones de esta fuente respecto del reporte completo de RAFAM
// (src/lib/rafam-gastos.mjs):
//  - No tiene aprobado/modificaciones/preventivo (quedan en 0 en las filas
//    que entran por acá): el "disponible" de ese mes no resta preventivo
//    hasta que se cargue el reporte completo y lo reemplace.
//  - El campo "programa" de RAFAMOR SQL es en realidad la categoría
//    programática (ej. "01.17.00 - Administración de Políticas Tributarias").
//    El programa más grueso y su nombre se derivan como se puede: "01" es
//    siempre "Actividad Central" (convención estándar de RAFAM), y para el
//    resto, si la única categoría de ese programa es ella misma
//    (NN.00.00), se usa su nombre; si no, el nombre del programa queda sin
//    completar por esta vía (lo completa cualquier mes que sí tenga el
//    reporte completo, vía MAX() en src/lib/f17.ts).
//  - La fuente de financiamiento llega solo con el código (ej. "110"), sin
//    nombre: mismo criterio, queda sin completar hasta que algún mes con el
//    reporte completo lo aporte.
//  - La jurisdicción llega solo por nombre, sin el código RAFAM de 2 dígitos
//    (ej. "03"): se resuelve con JURISDICCION_CODIGO_POR_NOMBRE, la misma
//    tabla de migrations/0003_usuarios.sql. Un nombre que no está en esa
//    tabla se omite del sync (no hay código para escribirlo) y queda
//    reportado en `jurisdiccionesOmitidas`.

const RAFAMOR_SQL_URL = "https://rafamor-sql.pages.dev";

export interface RafamorSqlEnv {
  RAFAMOR_CF_CLIENT_ID?: string;
  RAFAMOR_CF_CLIENT_SECRET?: string;
}

export class ErrorRafamorSql extends Error {}

async function consultarRafamorSql<T extends unknown[] = unknown[]>(sql: string, env: RafamorSqlEnv): Promise<T[]> {
  const cid = (env.RAFAMOR_CF_CLIENT_ID ?? "").trim();
  const secreto = (env.RAFAMOR_CF_CLIENT_SECRET ?? "").trim();
  if (!cid || !secreto) throw new ErrorRafamorSql("Faltan los secrets RAFAMOR_CF_CLIENT_ID / RAFAMOR_CF_CLIENT_SECRET.");

  const res = await fetch(`${RAFAMOR_SQL_URL}/api/sql`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: RAFAMOR_SQL_URL,
      "x-rafamor": "1",
      "cf-access-client-id": cid,
      "cf-access-client-secret": secreto,
    },
    body: JSON.stringify({ sql }),
    redirect: "manual",
  });

  if (res.status >= 300 && res.status < 400) {
    throw new ErrorRafamorSql(`RAFAMOR SQL rechazó el acceso (HTTP ${res.status}): revisá las credenciales del token de servicio.`);
  }
  if (!res.ok) {
    const cuerpo = (await res.text().catch(() => "")).slice(0, 300);
    let msg: string = cuerpo;
    try {
      msg = JSON.parse(cuerpo)?.error ?? cuerpo;
    } catch {
      // el cuerpo no es JSON: se usa tal cual
    }
    throw new ErrorRafamorSql(`RAFAMOR SQL (HTTP ${res.status}): ${msg}`);
  }

  const body = (await res.json()) as { cols: string[]; rows: unknown[][]; truncado: boolean };
  if (body.truncado) throw new ErrorRafamorSql("La consulta a RAFAMOR SQL se cortó en 10.000 filas: hay que acotarla.");
  return body.rows as T[];
}

// ---------------------------------------------------------------------------
// Jurisdicción: nombre (único dato que da RAFAMOR SQL) -> código de 2 dígitos
// que ya usa rafam_gastos. Misma tabla que migrations/0003_usuarios.sql
// ("secretarías con presupuesto 2026"); incluye además las variantes
// abreviadas con las que aparecen en RAFAMOR SQL.

export const JURISDICCION_CODIGO_POR_NOMBRE: Record<string, string> = {
  "H.C.D.": "00",
  "Economía y Finanzas": "03",
  Salud: "04",
  "Obras y Servicios Públicos": "05",
  "Obras y Serv. Públicos": "05",
  "Control Comunal": "06",
  "Educación y Desarrollo de la Comunidad": "07",
  "Educación y Des. de la Comunidad": "07",
  "Servicios de la Deuda": "09",
  "Asistencia Legal y Técnica": "10",
  "Planificación Estratégica": "11",
  "Mujeres, Géneros, Diversidad y DDHH": "13",
  "Sec.de Mujeres, Géneros, Diversidad y DDHH": "13",
  "Jefatura de Gabinete": "16",
  "Seguridad Ciudadana": "17",
  "Desarrollo Local, Empleo y Economía Social": "22",
  "Desarrollo Productivo": "25",
  "Tránsito y Transporte": "27",
};

// ---------------------------------------------------------------------------
// Categoría programática: RAFAMOR SQL la llama "programa" ("NN.NN.NN - Nombre").

function parseCatprog(texto: string): { codigo: string; denom: string } | null {
  const m = /^(\d{2}\.\d{2}\.\d{2})\s*-\s*(.+)$/.exec(texto.trim());
  return m ? { codigo: m[1], denom: m[2].trim() } : null;
}

const SIN_USAR_RE = /\(no usar\)/i;

/** Entre dos denominaciones para el mismo código, prefiere la que no está marcada "(NO USAR)". */
function mejorDenom(actual: string | undefined, nueva: string): string {
  if (!actual) return nueva;
  return SIN_USAR_RE.test(actual) && !SIN_USAR_RE.test(nueva) ? nueva : actual;
}

/** "01" siempre es "Actividad Central"; para el resto, solo si el programa no tiene actividades (su única categoría es NN.00.00). */
function denomPrograma(programaCodigo: string, catprogsDelPrograma: Set<string>, catprogDenom: Map<string, string>): string | null {
  if (programaCodigo === "01") return "Actividad Central";
  const propio = `${programaCodigo}.00.00`;
  if (catprogsDelPrograma.size === 1 && catprogsDelPrograma.has(propio)) return catprogDenom.get(propio) ?? null;
  return null;
}

function ultimoDiaDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

// ---------------------------------------------------------------------------

const COLS = [
  "jurisdiccion_codigo", "jurisdiccion", "programa_codigo", "programa", "catprog_codigo", "catprog",
  "fuente_codigo", "fuente", "inciso", "partida_codigo", "partida",
  "aprobado", "modificaciones", "vigente", "preventivo", "compromiso", "devengado", "pagado",
] as const;

interface Fila {
  jurisdiccion_codigo: string;
  jurisdiccion: string;
  catprog_codigo: string;
  catprog: string;
  fuente_codigo: string;
  inciso: string;
  partida_codigo: string;
  partida: string;
  vigente: number;
  compromiso: number;
  devengado: number;
  pagado: number;
}

export interface ResultadoSync {
  anio: number;
  mes: number;
  hasta: string;
  filas: number;
  /** Si no se escribió nada, por qué (no es un error: el mes ya está cerrado, o no hay datos nuevos). */
  omitido?: string;
  jurisdiccionesOmitidas: string[];
}

/**
 * Trae de RAFAMOR SQL el mes más reciente con una foto de crédito vigente y,
 * si no está ya cerrado con un reporte de RAFAM, reemplaza esa foto en
 * `rafam_gastos`/`rafam_cortes`.
 */
export async function sincronizarRafamorSql(db: D1Database, env: RafamorSqlEnv): Promise<ResultadoSync> {
  const cortes = await consultarRafamorSql<[number, number, string]>(
    "SELECT anio, mes, MAX(fecha) AS fecha FROM credito_vigente GROUP BY anio, mes ORDER BY anio DESC, mes DESC LIMIT 1",
    env
  );
  const [anio, mes, hasta] = cortes[0] ?? [];
  if (!anio || !mes) {
    return { anio: 0, mes: 0, hasta: "", filas: 0, omitido: "RAFAMOR SQL todavía no tiene ninguna foto de crédito vigente.", jurisdiccionesOmitidas: [] };
  }

  const corteExistente = await db
    .prepare("SELECT mes_completo, origen FROM rafam_cortes WHERE anio = ? AND mes = ?")
    .bind(anio, mes)
    .first<{ mes_completo: number; origen: string }>();
  if (corteExistente?.mes_completo && corteExistente.origen !== "rafamor_sql") {
    return {
      anio,
      mes,
      hasta,
      filas: 0,
      omitido: `${String(mes).padStart(2, "0")}/${anio} ya quedó cerrado con un reporte de RAFAM (${corteExistente.origen === "panel" ? "subido en el panel" : "sync-rafamor.mjs"}); no se toca.`,
      jurisdiccionesOmitidas: [],
    };
  }

  const [gastos, vigentes] = await Promise.all([
    consultarRafamorSql<[string, string, string, string, string, string, number, number, number]>(
      `SELECT jurisdiccion, programa, fuente, inciso, partida_codigo, partida,
              SUM(compromiso) AS compromiso, SUM(devengado) AS devengado, SUM(pagado) AS pagado
       FROM gastos WHERE anio = ${Number(anio)} AND mes = ${Number(mes)}
       GROUP BY jurisdiccion, programa, fuente, partida_codigo`,
      env
    ),
    consultarRafamorSql<[string, string, string, string, string, string, number]>(
      `SELECT jurisdiccion, programa, fuente, inciso, partida_codigo, partida, vigente
       FROM credito_vigente WHERE anio = ${Number(anio)} AND mes = ${Number(mes)}`,
      env
    ),
  ]);

  const porClave = new Map<string, Fila>();
  const jurisdiccionesOmitidas = new Set<string>();
  const catprogDenom = new Map<string, string>();
  const catprogsPorPrograma = new Map<string, Set<string>>();

  const resolver = (
    jurisdiccionNombre: string,
    programaTexto: string,
    fuenteCodigo: string,
    inciso: string,
    partidaCodigo: string,
    partidaDenom: string
  ) => {
    const jurisdiccionCodigo = JURISDICCION_CODIGO_POR_NOMBRE[jurisdiccionNombre];
    if (!jurisdiccionCodigo) {
      jurisdiccionesOmitidas.add(jurisdiccionNombre);
      return null;
    }
    const catprog = parseCatprog(programaTexto);
    if (!catprog) return null;
    catprogDenom.set(catprog.codigo, mejorDenom(catprogDenom.get(catprog.codigo), catprog.denom));
    const programaCodigo = catprog.codigo.slice(0, 2);
    if (!catprogsPorPrograma.has(programaCodigo)) catprogsPorPrograma.set(programaCodigo, new Set());
    catprogsPorPrograma.get(programaCodigo)!.add(catprog.codigo);

    const clave = `${jurisdiccionCodigo}|${catprog.codigo}|${fuenteCodigo}|${partidaCodigo}`;
    let f = porClave.get(clave);
    if (!f) {
      f = {
        jurisdiccion_codigo: jurisdiccionCodigo,
        jurisdiccion: jurisdiccionNombre,
        catprog_codigo: catprog.codigo,
        catprog: catprog.denom,
        fuente_codigo: fuenteCodigo,
        inciso,
        partida_codigo: partidaCodigo,
        partida: partidaDenom,
        vigente: 0,
        compromiso: 0,
        devengado: 0,
        pagado: 0,
      };
      porClave.set(clave, f);
    }
    return f;
  };

  for (const [jurisdiccion, programa, fuente, inciso, partidaCodigo, partida, compromiso, devengado, pagado] of gastos) {
    const f = resolver(jurisdiccion, programa, fuente, inciso, partidaCodigo, partida);
    if (f) {
      f.compromiso += compromiso;
      f.devengado += devengado;
      f.pagado += pagado;
    }
  }
  for (const [jurisdiccion, programa, fuente, inciso, partidaCodigo, partida, vigente] of vigentes) {
    const f = resolver(jurisdiccion, programa, fuente, inciso, partidaCodigo, partida);
    if (f) f.vigente += vigente;
  }

  const programaDenomPorCodigo = new Map<string, string | null>();
  for (const [codigo, catprogs] of catprogsPorPrograma) programaDenomPorCodigo.set(codigo, denomPrograma(codigo, catprogs, catprogDenom));

  const filas = [...porClave.values()].map((f) => {
    const programaCodigo = f.catprog_codigo.slice(0, 2);
    return COLS.map((c) => {
      switch (c) {
        case "jurisdiccion_codigo": return f.jurisdiccion_codigo;
        case "jurisdiccion": return f.jurisdiccion;
        case "programa_codigo": return programaCodigo;
        case "programa": return programaDenomPorCodigo.get(programaCodigo) ?? null;
        case "catprog_codigo": return f.catprog_codigo;
        case "catprog": return f.catprog;
        case "fuente_codigo": return f.fuente_codigo;
        case "fuente": return null; // RAFAMOR SQL no da el nombre de la fuente.
        case "inciso": return f.inciso;
        case "partida_codigo": return f.partida_codigo;
        case "partida": return f.partida;
        case "aprobado": return 0;
        case "modificaciones": return 0;
        case "vigente": return f.vigente;
        case "preventivo": return 0;
        case "compromiso": return f.compromiso;
        case "devengado": return f.devengado;
        case "pagado": return f.pagado;
      }
    });
  });

  if (filas.length === 0) {
    return { anio, mes, hasta, filas: 0, omitido: "No hay filas para ninguna jurisdicción conocida en ese mes.", jurisdiccionesOmitidas: [...jurisdiccionesOmitidas] };
  }

  const extraer = COLS.map((_, i) => `json_extract(value, '$[${i}]')`).join(", ");
  const insertar = db.prepare(`INSERT INTO rafam_gastos (anio, mes, ${COLS.join(", ")}) SELECT ?1, ?2, ${extraer} FROM json_each(?3)`);
  const lotes = [];
  for (let i = 0; i < filas.length; i += 600) lotes.push(insertar.bind(anio, mes, JSON.stringify(filas.slice(i, i + 600))));

  const desde = `${anio}-${String(mes).padStart(2, "0")}-01`;
  const mesCompleto = hasta.slice(8) === String(ultimoDiaDelMes(anio, mes)).padStart(2, "0") ? 1 : 0;

  await db.batch([
    db.prepare("DELETE FROM rafam_gastos WHERE anio = ? AND mes = ?").bind(anio, mes),
    ...lotes,
    db
      .prepare(
        `INSERT OR REPLACE INTO rafam_cortes (anio, mes, desde, hasta, mes_completo, filas, archivo, origen, cargado_en)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 'rafamor_sql', datetime('now'))`
      )
      .bind(anio, mes, desde, hasta, mesCompleto, filas.length),
  ]);

  return { anio, mes, hasta, filas: filas.length, jurisdiccionesOmitidas: [...jurisdiccionesOmitidas] };
}
