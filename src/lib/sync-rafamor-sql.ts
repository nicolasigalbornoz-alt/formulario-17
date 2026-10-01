// Sincronización automática desde la API de RAFAMOR SQL (lectura, se
// regenera a diario con lo que baja RAFAMOR): mantiene al día `rafam_gastos`
// sin depender de que alguien corra `sync-rafamor.mjs` en la PC de RAFAMOR.
// La llaman:
//  - src/pages/api/cron/sync-rafamor.ts (tarea programada, ver worker/index.mjs)
//  - src/pages/api/admin/sync-rafamor.ts (botón "Sincronizar ahora" del panel)
//
// Trae cada mes (de los últimos 12) para el que RAFAMOR SQL tenga una foto
// más nueva que la cargada: el mes en curso y los que hayan quedado parciales
// o sin cargar, que son los que traban el cierre de un trimestre. Un mes ya
// cerrado, o un reporte de RAFAM de la misma fecha, nunca se pisa.
//
// RAFAMOR SQL suma los programas sin actividades (NN.00.00) a la categoría
// anterior: una jurisdicción que los tenga conserva su foto anterior de ese
// mes hasta que RAFAMOR SQL los traiga (ver `jurisdiccionesAConservar`).
//
// Limitaciones de esta fuente respecto del reporte completo de RAFAM
// (src/lib/rafam-gastos.mjs):
//  - No tiene aprobado/modificaciones/preventivo (quedan en 0 en las filas
//    que entran por acá): el "disponible" de ese mes no resta preventivo
//    hasta que se cargue el reporte completo y lo reemplace.
//  - El campo "programa" de RAFAMOR SQL es en realidad la categoría
//    programática (ej. "01.17.00 - Administración de Políticas Tributarias").
//    El nombre del programa se toma del que ya tenga la base para esa
//    jurisdicción; si no hay, "01" es "Actividad Central" y un programa sin
//    actividades (única categoría NN.00.00) lleva el nombre de esa categoría.
//    Si tampoco, queda vacío y src/lib/f17.ts muestra "Programa NN".
//  - La fuente llega solo con el código (ej. "110"): el nombre sale de la
//    base o de FUENTE_DENOM; si no, f17.ts muestra "Fuente NNN".
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

/**
 * Nombre del programa cuando la base todavía no lo tiene: "01" es "Actividad
 * Central"; para el resto, solo si el programa no tiene actividades (su única
 * categoría es NN.00.00, que lleva el nombre del programa).
 */
function denomPrograma(programaCodigo: string, catprogs: Map<string, string>): string | null {
  if (programaCodigo === "01") return "Actividad Central";
  const propio = `${programaCodigo}.00.00`;
  return catprogs.size === 1 && catprogs.has(propio) ? catprogs.get(propio)! : null;
}

/** Nombres de las fuentes como figuran en las planillas "registros f17" (RAFAMOR SQL solo da el código). */
const FUENTE_DENOM: Record<string, string> = {
  "110": "Tesoro municipal",
  "131": "Afectado municipal",
  "132": "Afectado provincial",
  "133": "Afectado nacional",
};

/** Meses que se traen por corrida: tope de CPU y de consultas a D1 por invocación del Worker. */
const MAX_MESES_POR_CORRIDA = 3;

/**
 * Marca en rafam_cortes.archivo de un mes en el que algunas jurisdicciones
 * conservaron su foto anterior (ver `jurisdiccionesAConservar`): ese mes se
 * vuelve a revisar en cada corrida hasta que RAFAMOR SQL traiga sus programas.
 */
const CONSERVADAS = "RAFAMOR SQL no separa sus programas sin actividades; se mantuvo la foto anterior de las jurisdicciones ";

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
  fuente_codigo: string;
  inciso: string;
  partida_codigo: string;
  partida: string;
  vigente: number;
  compromiso: number;
  devengado: number;
  pagado: number;
}

/** Nombres que ya tiene la base (de los reportes completos de RAFAM) para lo que RAFAMOR SQL no trae. */
interface NombresCargados {
  fuente: Map<string, string>;
  /** Clave "jurisdiccion_codigo|programa_codigo". */
  programa: Map<string, string>;
}

async function nombresCargados(db: D1Database): Promise<NombresCargados> {
  const [fuentes, programas] = await db.batch<{ cod: string; denom: string }>([
    db.prepare("SELECT fuente_codigo AS cod, MAX(fuente) AS denom FROM rafam_gastos WHERE fuente IS NOT NULL GROUP BY fuente_codigo"),
    db.prepare(
      `SELECT jurisdiccion_codigo || '|' || programa_codigo AS cod, MAX(programa) AS denom
       FROM rafam_gastos WHERE programa IS NOT NULL GROUP BY jurisdiccion_codigo, programa_codigo`
    ),
  ]);
  const aMapa = (r: D1Result<{ cod: string; denom: string }>) => new Map((r.results ?? []).map((x) => [x.cod, x.denom]));
  return { fuente: aMapa(fuentes), programa: aMapa(programas) };
}

export interface MesSincronizado {
  anio: number;
  mes: number;
  hasta: string;
  filas: number;
  mesCompleto: boolean;
  /** Jurisdicciones que conservaron la foto anterior de ese mes (nombres). */
  conservadas: string[];
}

export interface ResultadoSync {
  /** Meses traídos en esta corrida, el más reciente primero. */
  meses: MesSincronizado[];
  /** Meses que también tienen datos más nuevos en RAFAMOR SQL y quedan para la próxima corrida. */
  pendientes: number;
  /** Último día con datos en RAFAMOR SQL (AAAA-MM-DD). */
  ultimoDia: string;
  jurisdiccionesOmitidas: string[];
}

/**
 * Trae de RAFAMOR SQL los meses (de los últimos 12) cuya foto es más nueva
 * que la cargada en la base: el mes en curso y cualquier mes que haya quedado
 * parcial o sin cargar. Por eso nunca pisa un mes ya cerrado (su foto llega
 * al último día) ni un reporte de RAFAM de la misma fecha (que además trae
 * aprobado/modificaciones/preventivo).
 */
export async function sincronizarRafamorSql(db: D1Database, env: RafamorSqlEnv): Promise<ResultadoSync> {
  const disponibles = await consultarRafamorSql<[number, number, string]>(
    "SELECT anio, mes, MAX(fecha) AS fecha FROM credito_vigente GROUP BY anio, mes ORDER BY anio DESC, mes DESC LIMIT 12",
    env
  );
  const ultimoDia = disponibles[0]?.[2] ?? "";
  if (disponibles.length === 0) return { meses: [], pendientes: 0, ultimoDia, jurisdiccionesOmitidas: [] };

  const cargados = await db
    .prepare("SELECT anio, mes, hasta, origen, archivo FROM rafam_cortes WHERE anio >= ?")
    .bind(disponibles[disponibles.length - 1][0])
    .all<{ anio: number; mes: number; hasta: string; origen: string; archivo: string | null }>();
  const cargado = new Map((cargados.results ?? []).map((c) => [`${c.anio}-${c.mes}`, c]));
  const nuevos = disponibles.filter(([anio, mes, hasta]) => {
    const c = cargado.get(`${anio}-${mes}`);
    return !c || hasta > c.hasta;
  });
  // Primero los datos nuevos; después, volver a probar los meses con jurisdicciones conservadas.
  const reintentos = disponibles.filter(([anio, mes, hasta]) => {
    const c = cargado.get(`${anio}-${mes}`);
    return c && hasta === c.hasta && c.origen === "rafamor_sql" && (c.archivo ?? "").startsWith(CONSERVADAS);
  });
  const atrasados = [...nuevos, ...reintentos];

  const meses: MesSincronizado[] = [];
  const jurisdiccionesOmitidas = new Set<string>();
  if (atrasados.length > 0) {
    const nombres = await nombresCargados(db);
    for (const [anio, mes, hasta] of atrasados.slice(0, MAX_MESES_POR_CORRIDA)) {
      meses.push(await sincronizarMes(db, env, anio, mes, hasta, nombres, jurisdiccionesOmitidas));
    }
  }
  return {
    meses,
    pendientes: Math.max(0, nuevos.length - MAX_MESES_POR_CORRIDA),
    ultimoDia,
    jurisdiccionesOmitidas: [...jurisdiccionesOmitidas],
  };
}

/** Reemplaza la foto de un mes en rafam_gastos/rafam_cortes con lo que tiene RAFAMOR SQL. */
async function sincronizarMes(
  db: D1Database,
  env: RafamorSqlEnv,
  anio: number,
  mes: number,
  hasta: string,
  nombres: NombresCargados,
  jurisdiccionesOmitidas: Set<string>
): Promise<MesSincronizado> {
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
  /** "jurisdiccion|catprog" -> nombre de la categoría. */
  const catprogDenom = new Map<string, string>();
  /** "jurisdiccion|programa" -> categorías del programa (código -> nombre). */
  const catprogsPorPrograma = new Map<string, Map<string, string>>();

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
    const claveCatprog = `${jurisdiccionCodigo}|${catprog.codigo}`;
    const denom = mejorDenom(catprogDenom.get(claveCatprog), catprog.denom);
    catprogDenom.set(claveCatprog, denom);
    const clavePrograma = `${jurisdiccionCodigo}|${catprog.codigo.slice(0, 2)}`;
    if (!catprogsPorPrograma.has(clavePrograma)) catprogsPorPrograma.set(clavePrograma, new Map());
    catprogsPorPrograma.get(clavePrograma)!.set(catprog.codigo, denom);

    const clave = `${claveCatprog}|${fuenteCodigo}|${partidaCodigo}`;
    let f = porClave.get(clave);
    if (!f) {
      f = {
        jurisdiccion_codigo: jurisdiccionCodigo,
        jurisdiccion: jurisdiccionNombre,
        catprog_codigo: catprog.codigo,
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

  const programaDenom = (jurisdiccionCodigo: string, programaCodigo: string) => {
    const clave = `${jurisdiccionCodigo}|${programaCodigo}`;
    return nombres.programa.get(clave) ?? denomPrograma(programaCodigo, catprogsPorPrograma.get(clave) ?? new Map());
  };

  const filas = [...porClave.values()].map((f) => {
    const programaCodigo = f.catprog_codigo.slice(0, 2);
    return COLS.map((c) => {
      switch (c) {
        case "jurisdiccion_codigo": return f.jurisdiccion_codigo;
        case "jurisdiccion": return f.jurisdiccion;
        case "programa_codigo": return programaCodigo;
        case "programa": return programaDenom(f.jurisdiccion_codigo, programaCodigo);
        case "catprog_codigo": return f.catprog_codigo;
        // Un solo nombre por categoría (sin el "(NO USAR)" si hay otro), así MAX() no elige el viejo.
        case "catprog": return catprogDenom.get(`${f.jurisdiccion_codigo}|${f.catprog_codigo}`)!;
        case "fuente_codigo": return f.fuente_codigo;
        case "fuente": return nombres.fuente.get(f.fuente_codigo) ?? FUENTE_DENOM[f.fuente_codigo] ?? null;
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

  const mesCompleto = Number(hasta.slice(8)) === ultimoDiaDelMes(anio, mes);

  const { conservar, filasConservadas } = await jurisdiccionesAConservar(db, anio, mes, porClave.values());
  const aEscribir = filas.filter((f) => !conservar.has(f[0] as string));
  const nombre = new Map([...porClave.values()].map((f) => [f.jurisdiccion_codigo, f.jurisdiccion]));
  const conservadas = [...conservar].sort().map((j) => nombre.get(j) ?? j);
  if (aEscribir.length === 0) return { anio, mes, hasta, filas: 0, mesCompleto, conservadas };

  const extraer = COLS.map((_, i) => `json_extract(value, '$[${i}]')`).join(", ");
  const insertar = db.prepare(`INSERT INTO rafam_gastos (anio, mes, ${COLS.join(", ")}) SELECT ?1, ?2, ${extraer} FROM json_each(?3)`);
  const lotes = [];
  for (let i = 0; i < aEscribir.length; i += 600) lotes.push(insertar.bind(anio, mes, JSON.stringify(aEscribir.slice(i, i + 600))));

  const borrar = conservar.size
    ? db
        .prepare(`DELETE FROM rafam_gastos WHERE anio = ? AND mes = ? AND jurisdiccion_codigo NOT IN (${[...conservar].map(() => "?").join(",")})`)
        .bind(anio, mes, ...conservar)
    : db.prepare("DELETE FROM rafam_gastos WHERE anio = ? AND mes = ?").bind(anio, mes);

  await db.batch([
    borrar,
    ...lotes,
    db
      .prepare(
        `INSERT OR REPLACE INTO rafam_cortes (anio, mes, desde, hasta, mes_completo, filas, archivo, origen, cargado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'rafamor_sql', datetime('now'))`
      )
      .bind(
        anio,
        mes,
        `${anio}-${String(mes).padStart(2, "0")}-01`,
        hasta,
        mesCompleto ? 1 : 0,
        aEscribir.length + filasConservadas,
        conservar.size ? `${CONSERVADAS}${[...conservar].sort().join(", ")}` : null
      ),
  ]);

  return { anio, mes, hasta, filas: aEscribir.length, mesCompleto, conservadas };
}

/**
 * RAFAMOR SQL no reconoce los programas sin actividades (categoría NN.00.00,
 * ej. el 17 de Control Comunal) y los suma a la categoría anterior: es el
 * mismo error del parser de RAFAMOR que corrige src/lib/rafam-gastos.mjs.
 * Si la foto que se va a reemplazar tiene alguno de esos programas para una
 * jurisdicción y RAFAMOR SQL no lo trae, esa jurisdicción conserva su foto
 * anterior (un reporte de RAFAM), en vez de quedar con los programas mezclados.
 */
async function jurisdiccionesAConservar(
  db: D1Database,
  anio: number,
  mes: number,
  filasRafamor: Iterable<Fila>
): Promise<{ conservar: Set<string>; filasConservadas: number }> {
  const [sinActividades, porJurisdiccion] = await db.batch<{ j: string; c?: string; n?: number }>([
    db
      .prepare("SELECT DISTINCT jurisdiccion_codigo AS j, catprog_codigo AS c FROM rafam_gastos WHERE anio = ? AND mes = ? AND catprog_codigo LIKE '__.00.00'")
      .bind(anio, mes),
    db.prepare("SELECT jurisdiccion_codigo AS j, COUNT(*) AS n FROM rafam_gastos WHERE anio = ? AND mes = ? GROUP BY jurisdiccion_codigo").bind(anio, mes),
  ]);
  const enRafamor = new Set([...filasRafamor].map((f) => `${f.jurisdiccion_codigo}|${f.catprog_codigo}`));
  const conservar = new Set<string>();
  for (const r of sinActividades.results ?? []) if (!enRafamor.has(`${r.j}|${r.c}`)) conservar.add(r.j);
  const filasConservadas = (porJurisdiccion.results ?? []).filter((r) => conservar.has(r.j)).reduce((a, r) => a + (r.n ?? 0), 0);
  return { conservar, filasConservadas };
}