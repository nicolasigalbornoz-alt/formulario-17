// Sincronización automática desde la API de RAFAMOR SQL (lectura, se
// regenera a diario con lo que baja RAFAMOR): mantiene al día `rafam_gastos`
// sin depender de que alguien corra `sync-rafamor.mjs` en la PC de RAFAMOR.
// La llaman la tarea programada del Worker (worker/index.mjs, cada 30 min) y
// el botón "Sincronizar ahora" del panel (src/pages/api/admin/sync-rafamor.ts).
//
// Cada corrida trae UN mes: el más reciente para el que RAFAMOR SQL tenga una
// foto más nueva que la cargada (el mes en curso, o uno que haya quedado
// parcial o sin cargar, que son los que traban el cierre de un trimestre). Un
// mes ya cerrado, o un reporte de RAFAM de la misma fecha, nunca se pisa.
//
// Límites del plan gratuito de Cloudflare, que mandan en el diseño:
//  - 10 ms de CPU por ejecución: armar las ~3.300 filas de un mes en
//    JavaScript cuesta ~35 ms (y Cloudflare corta la corrida sin escribir
//    nada). Por eso el mes se arma en la consulta a RAFAMOR SQL
//    (`consultaFilas`: solo códigos e importes) y esa respuesta pasa sin leer
//    a D1, que la recorre con json_each (INSERTAR_MES). Al Worker le queda ~1 ms.
//  - 100.000 filas escritas por día en D1: reemplazar un mes son ~20.000
//    (con índices), así que hay un tope de MAX_MESES_POR_DIA.
// Cada corrida queda registrada en `rafam_sync` (se ve en el panel y en
// /api/estado); una que quedó "corriendo" la cortó Cloudflare.
//
// RAFAMOR SQL suma los programas sin actividades (NN.00.00) a la categoría
// anterior (el error del parser de RAFAMOR que corrige rafam-gastos.mjs): una
// jurisdicción que los tenga en la foto anterior la conserva, hasta que
// RAFAMOR SQL los traiga.
//
// Limitaciones de esta fuente respecto del reporte completo de RAFAM:
//  - No tiene aprobado/modificaciones/preventivo (quedan en 0): el
//    "disponible" de ese mes no resta preventivo hasta que se cargue el
//    reporte completo y lo reemplace.
//  - Su "programa" es la categoría programática ("01.17.00 - Nombre"). El
//    nombre del programa sale de los meses ya cargados ("Actividad Central"
//    para el 01 si no hay); si falta, src/lib/f17.ts muestra "Programa NN".
//  - La fuente llega solo con el código: el nombre sale de la base o de
//    FUENTE_DENOM; si no, f17.ts muestra "Fuente NNN".
//  - La jurisdicción llega solo por nombre: se resuelve con
//    JURISDICCION_CODIGO_POR_NOMBRE (la tabla de migrations/0003_usuarios.sql)
//    y la que no esté ahí se omite (queda en `jurisdiccionesOmitidas`).

const RAFAMOR_SQL_URL = "https://rafamor-sql.pages.dev";

export interface RafamorSqlEnv {
  RAFAMOR_CF_CLIENT_ID?: string;
  RAFAMOR_CF_CLIENT_SECRET?: string;
}

export class ErrorRafamorSql extends Error {}

/** Nombres de las credenciales que no llegan al Worker (vacías o sin cargar). */
export function credencialesFaltantes(env: RafamorSqlEnv): string[] {
  return (["RAFAMOR_CF_CLIENT_ID", "RAFAMOR_CF_CLIENT_SECRET"] as const).filter((k) => !(env[k] ?? "").trim());
}

/** Respuesta de RAFAMOR SQL ({cols, rows, truncado}) como texto, sin parsear. */
async function pedirRafamorSql(sql: string, env: RafamorSqlEnv): Promise<string> {
  const cid = (env.RAFAMOR_CF_CLIENT_ID ?? "").trim();
  const secreto = (env.RAFAMOR_CF_CLIENT_SECRET ?? "").trim();
  const faltan = credencialesFaltantes(env);
  if (faltan.length) {
    throw new ErrorRafamorSql(
      `Falta ${faltan.join(" y ")} en el Worker: cargalo en Cloudflare → Workers → presupuesto → Settings → Variables and Secrets ` +
        `(la sección de arriba, no la de Build), tipo Secret, y apretá Deploy.`
    );
  }

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
  const texto = await res.text();
  if (!res.ok) {
    let msg = texto.slice(0, 300);
    try {
      msg = JSON.parse(texto)?.error ?? msg;
    } catch {
      // el cuerpo no es JSON: se usa tal cual
    }
    throw new ErrorRafamorSql(`RAFAMOR SQL (HTTP ${res.status}): ${msg}`);
  }
  if (texto.includes('"truncado":true')) throw new ErrorRafamorSql("La consulta a RAFAMOR SQL se cortó en 10.000 filas: hay que acotarla.");
  return texto;
}

/** Para consultas chicas (decenas de filas): esas sí se leen acá. */
async function consultarRafamorSql<T extends unknown[]>(sql: string, env: RafamorSqlEnv): Promise<T[]> {
  return JSON.parse(await pedirRafamorSql(sql, env)).rows as T[];
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

/** Nombres de las fuentes como figuran en las planillas "registros f17" (RAFAMOR SQL solo da el código). */
const FUENTE_DENOM: Record<string, string> = {
  "110": "Tesoro municipal",
  "131": "Afectado municipal",
  "132": "Afectado provincial",
  "133": "Afectado nacional",
};

/** Meses que se reemplazan por día (UTC), por el tope de filas escritas de D1. */
const MAX_MESES_POR_DIA = 3;

/** Marca en rafam_cortes.archivo: "<MARCA> (al AAAA-MM-DD) de las jurisdicciones 06, 27". */
const MARCA_CONSERVADAS = "RAFAMOR SQL no separa sus programas sin actividades; se mantuvo la foto anterior";
const MARCA_RE = /\(al (\d{4}-\d{2}-\d{2})\) de las jurisdicciones (.+)$/;

export interface Conservadas {
  /** Hasta qué día llegan los datos de esas jurisdicciones en ese mes. */
  hasta: string;
  jurisdicciones: string[];
}

function leerMarca(archivo: string | null | undefined): Conservadas | null {
  if (!archivo?.startsWith(MARCA_CONSERVADAS)) return null;
  const m = MARCA_RE.exec(archivo);
  return m ? { hasta: m[1], jurisdicciones: m[2].split(", ") } : null;
}

/** Jurisdicciones que en ese mes conservan una foto más vieja que la del resto (para avisarlo en el F17). */
export async function conservadasDelMes(db: D1Database, anio: number, mes: number): Promise<Conservadas | null> {
  const c = await db.prepare("SELECT archivo FROM rafam_cortes WHERE anio = ? AND mes = ?").bind(anio, mes).first<{ archivo: string | null }>();
  return leerMarca(c?.archivo);
}

/** Una categoría "NN.00.00" (programa sin actividades) en la respuesta de RAFAMOR SQL. */
const PROGRAMA_SIN_ACTIVIDADES = /"\d\d\.00\.00"/;

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

// ---------------------------------------------------------------------------
// Consultas a RAFAMOR SQL: el armado del mes (jurisdicción -> código,
// categoría, gastos + crédito vigente sumados por partida) se hace allá, para
// que lo que vuelve sean solo códigos e importes (texto ASCII, ~180 KB) que el
// Worker pasa a D1 sin leer. Los nombres vienen aparte, en una consulta chica.

const JUR = `jur(n, c) AS (VALUES ${Object.entries(JURISDICCION_CODIGO_POR_NOMBRE)
  .map(([n, c]) => `(${lit(n)}, ${lit(c)})`)
  .join(", ")})`;
const ES_CATEGORIA = "programa GLOB '[0-9][0-9].[0-9][0-9].[0-9][0-9] - *'";

/** Filas [jurisdiccion_codigo, catprog_codigo, fuente, partida_codigo, vigente, compromiso, devengado, pagado]. */
const consultaFilas = (anio: number, mes: number) => `WITH ${JUR},
  u AS (
    SELECT jurisdiccion AS j, substr(programa, 1, 8) AS c, fuente AS f, partida_codigo AS p, 0 AS v, compromiso AS co, devengado AS d, pagado AS pa
    FROM gastos WHERE anio = ${anio} AND mes = ${mes} AND ${ES_CATEGORIA}
    UNION ALL
    SELECT jurisdiccion, substr(programa, 1, 8), fuente, partida_codigo, vigente, 0, 0, 0
    FROM credito_vigente WHERE anio = ${anio} AND mes = ${mes} AND ${ES_CATEGORIA}
  )
SELECT jur.c, u.c, u.f, u.p, ROUND(SUM(u.v), 2), ROUND(SUM(u.co), 2), ROUND(SUM(u.d), 2), ROUND(SUM(u.pa), 2)
FROM u JOIN jur ON jur.n = u.j GROUP BY 1, 2, 3, 4`;

/**
 * Filas [tipo, jurisdiccion_codigo, codigo, nombre]: "c" categoría (sin el
 * "(NO USAR)" si hay otro nombre para el mismo código), "p" partida,
 * "j" jurisdicción, "x" jurisdicción sin código (se omite).
 */
const consultaNombres = (anio: number, mes: number) => `WITH ${JUR},
  u AS (
    SELECT jurisdiccion, programa, partida_codigo, partida FROM gastos WHERE anio = ${anio} AND mes = ${mes} AND ${ES_CATEGORIA}
    UNION ALL
    SELECT jurisdiccion, programa, partida_codigo, partida FROM credito_vigente WHERE anio = ${anio} AND mes = ${mes} AND ${ES_CATEGORIA}
  )
SELECT 'c', jur.c, substr(u.programa, 1, 8),
       COALESCE(MIN(CASE WHEN u.programa NOT LIKE '%(NO USAR)%' THEN trim(substr(u.programa, 12)) END), MIN(trim(substr(u.programa, 12))))
FROM u JOIN jur ON jur.n = u.jurisdiccion GROUP BY 2, 3
UNION ALL SELECT 'p', NULL, partida_codigo, MAX(partida) FROM u GROUP BY 3
UNION ALL SELECT 'j', jur.c, NULL, MIN(u.jurisdiccion) FROM u JOIN jur ON jur.n = u.jurisdiccion GROUP BY 2
UNION ALL SELECT 'x', NULL, NULL, jurisdiccion FROM u WHERE jurisdiccion NOT IN (SELECT n FROM jur) GROUP BY 4`;

// SQL que escribe el mes en D1 con esas dos respuestas, tal cual llegaron.
//   ?1 anio  ?2 mes  ?3 filas  ?4 nombres  ?5 jurisdicciones que conservan su foto (JSON)
const INSERTAR_MES = `
INSERT INTO rafam_gastos (anio, mes, jurisdiccion_codigo, jurisdiccion, programa_codigo, programa, catprog_codigo, catprog,
  fuente_codigo, fuente, inciso, partida_codigo, partida, aprobado, modificaciones, vigente, preventivo, compromiso, devengado, pagado)
WITH
  src AS (
    SELECT ${["jcod", "cat", "fuente", "partida_codigo", "vigente", "compromiso", "devengado", "pagado"]
      .map((c, i) => `json_extract(value, '$[${i}]') AS ${c}`)
      .join(", ")}
    FROM json_each(?3, '$.rows')
  ),
  nombres AS MATERIALIZED (
    SELECT json_extract(value, '$[0]') AS t, json_extract(value, '$[1]') AS j, json_extract(value, '$[2]') AS c, json_extract(value, '$[3]') AS nom
    FROM json_each(?4, '$.rows')
  ),
  -- Nombres que ya tiene la base (de los reportes completos de RAFAM).
  nom_jur AS MATERIALIZED (SELECT jurisdiccion_codigo AS j, MAX(jurisdiccion) AS nom FROM rafam_gastos WHERE anio >= ?1 - 1 GROUP BY 1),
  nom_prog AS MATERIALIZED (
    SELECT jurisdiccion_codigo AS j, programa_codigo AS p, MAX(programa) AS nom FROM rafam_gastos WHERE anio >= ?1 - 1 GROUP BY 1, 2
  ),
  nom_cat AS MATERIALIZED (
    SELECT jurisdiccion_codigo AS j, catprog_codigo AS c, MAX(catprog) AS nom FROM rafam_gastos
    WHERE anio >= ?1 - 1 AND catprog NOT LIKE '%(NO USAR)%' GROUP BY 1, 2
  ),
  nom_fuente AS MATERIALIZED (SELECT fuente_codigo AS f, MAX(fuente) AS nom FROM rafam_gastos WHERE anio >= ?1 - 1 GROUP BY 1)
SELECT ?1, ?2, s.jcod, COALESCE(nj.nom, jr.nom), substr(s.cat, 1, 2),
       COALESCE(np.nom, CASE WHEN substr(s.cat, 1, 2) = '01' THEN 'Actividad Central' END),
       s.cat, COALESCE(nc.nom, cr.nom), s.fuente,
       COALESCE(nf.nom, CASE s.fuente ${Object.entries(FUENTE_DENOM)
         .map(([c, n]) => `WHEN ${lit(c)} THEN ${lit(n)}`)
         .join(" ")} END),
       substr(s.partida_codigo, 1, instr(s.partida_codigo, '.') - 1), s.partida_codigo, pr.nom,
       0, 0, s.vigente, 0, s.compromiso, s.devengado, s.pagado
FROM src s
LEFT JOIN nombres cr ON cr.t = 'c' AND cr.j = s.jcod AND cr.c = s.cat
LEFT JOIN nombres pr ON pr.t = 'p' AND pr.c = s.partida_codigo
LEFT JOIN nombres jr ON jr.t = 'j' AND jr.j = s.jcod
LEFT JOIN nom_jur nj ON nj.j = s.jcod
LEFT JOIN nom_prog np ON np.j = s.jcod AND np.p = substr(s.cat, 1, 2)
LEFT JOIN nom_cat nc ON nc.j = s.jcod AND nc.c = s.cat
LEFT JOIN nom_fuente nf ON nf.f = s.fuente
WHERE s.jcod NOT IN (SELECT value FROM json_each(?5))`;

// ---------------------------------------------------------------------------
// Registro de corridas

const CREAR_REGISTRO = `CREATE TABLE IF NOT EXISTS rafam_sync (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  inicio      TEXT NOT NULL DEFAULT (datetime('now')),
  fin         TEXT,
  origen      TEXT NOT NULL,
  estado      TEXT NOT NULL DEFAULT 'corriendo',
  anio        INTEGER,
  mes         INTEGER,
  hasta       TEXT,
  filas       INTEGER,
  detalle     TEXT
)`;

export interface Corrida {
  inicio: string;
  fin: string | null;
  origen: string;
  /** corriendo (si quedó así, la cortó Cloudflare) | ok | al_dia | tope | error */
  estado: string;
  anio: number | null;
  mes: number | null;
  hasta: string | null;
  filas: number | null;
  detalle: string | null;
}

export async function ultimasCorridas(db: D1Database, cuantas = 5): Promise<Corrida[]> {
  try {
    const r = await db
      .prepare("SELECT inicio, fin, origen, estado, anio, mes, hasta, filas, detalle FROM rafam_sync ORDER BY id DESC LIMIT ?")
      .bind(cuantas)
      .all<Corrida>();
    return r.results ?? [];
  } catch (e) {
    if (/no such table/i.test(String(e))) return [];
    throw e;
  }
}

// ---------------------------------------------------------------------------

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
  /** El mes traído en esta corrida (o ninguno). */
  meses: MesSincronizado[];
  /** Meses que también tienen datos más nuevos en RAFAMOR SQL y quedan para las próximas corridas. */
  pendientes: number;
  /** Último día con datos en RAFAMOR SQL (AAAA-MM-DD). */
  ultimoDia: string;
  jurisdiccionesOmitidas: string[];
  /** Por qué no se trajo nada aunque hay pendientes (tope diario). */
  aviso?: string;
}

/** Corre la sincronización y la deja registrada en rafam_sync. */
export async function sincronizarRafamorSql(db: D1Database, env: RafamorSqlEnv, origen: "tarea" | "panel"): Promise<ResultadoSync> {
  await db.prepare(CREAR_REGISTRO).run();
  const { meta } = await db.prepare("INSERT INTO rafam_sync (origen) VALUES (?)").bind(origen).run();
  const id = meta.last_row_id;
  const cerrar = (estado: string, m: Partial<MesSincronizado>, detalle: string | null) =>
    db.batch([
      db
        .prepare("UPDATE rafam_sync SET fin = datetime('now'), estado = ?, anio = ?, mes = ?, hasta = ?, filas = ?, detalle = ? WHERE id = ?")
        .bind(estado, m.anio ?? null, m.mes ?? null, m.hasta ?? null, m.filas ?? null, detalle, id),
      db.prepare("DELETE FROM rafam_sync WHERE id <= ?").bind(id - 300),
    ]);
  try {
    const r = await sincronizar(db, env);
    const m = r.meses[0];
    const detalle = [
      m?.conservadas.length ? `Conservaron su foto anterior: ${m.conservadas.join(", ")}.` : "",
      r.pendientes ? `Quedan ${r.pendientes} mes(es) por traer.` : "",
      r.jurisdiccionesOmitidas.length ? `Sin código de jurisdicción: ${r.jurisdiccionesOmitidas.join(", ")}.` : "",
      r.aviso ?? "",
    ]
      .filter(Boolean)
      .join(" ");
    await cerrar(m ? "ok" : r.aviso ? "tope" : "al_dia", m ?? { hasta: r.ultimoDia }, detalle || null);
    return r;
  } catch (e) {
    await cerrar("error", {}, (e instanceof Error ? e.message : String(e)).slice(0, 500)).catch(() => {});
    throw e;
  }
}

async function sincronizar(db: D1Database, env: RafamorSqlEnv): Promise<ResultadoSync> {
  const disponibles = await consultarRafamorSql<[number, number, string]>(
    "SELECT anio, mes, MAX(fecha) AS fecha FROM credito_vigente GROUP BY anio, mes ORDER BY anio DESC, mes DESC LIMIT 12",
    env
  );
  const ultimoDia = disponibles[0]?.[2] ?? "";
  const vacio = { meses: [], pendientes: 0, ultimoDia, jurisdiccionesOmitidas: [] };
  if (disponibles.length === 0) return vacio;

  const cargados = await db
    .prepare("SELECT anio, mes, hasta, origen, archivo FROM rafam_cortes WHERE anio >= ?")
    .bind(disponibles[disponibles.length - 1][0])
    .all<{ anio: number; mes: number; hasta: string; origen: string; archivo: string | null }>();
  const cargado = new Map((cargados.results ?? []).map((c) => [`${c.anio}-${c.mes}`, c]));
  const nuevos = disponibles.filter(([anio, mes, hasta]) => {
    const c = cargado.get(`${anio}-${mes}`);
    return !c || hasta > c.hasta;
  });

  let elegido = nuevos[0];
  if (!elegido) {
    // Un mes que conservó jurisdicciones se vuelve a traer solo si RAFAMOR SQL ya separa esos programas.
    const marcados = disponibles.filter(([anio, mes]) => leerMarca(cargado.get(`${anio}-${mes}`)?.archivo));
    for (const m of marcados) {
      const [[n]] = await consultarRafamorSql<[number]>(
        `SELECT COUNT(*) FROM credito_vigente WHERE anio = ${Number(m[0])} AND mes = ${Number(m[1])} AND programa GLOB '[0-9][0-9].00.00 - *'`,
        env
      );
      if (n > 0) {
        elegido = m;
        break;
      }
    }
  }
  if (!elegido) return vacio;

  const hoy = await db
    .prepare("SELECT COUNT(*) AS n FROM rafam_sync WHERE estado = 'ok' AND inicio >= date('now')")
    .first<{ n: number }>();
  if ((hoy?.n ?? 0) >= MAX_MESES_POR_DIA) {
    return { ...vacio, pendientes: nuevos.length, aviso: `Ya se reemplazaron ${MAX_MESES_POR_DIA} meses hoy (tope de escrituras de D1): sigue mañana.` };
  }

  const [anio, mes, hasta] = elegido;
  const [filas, nombres] = await Promise.all([
    pedirRafamorSql(consultaFilas(Number(anio), Number(mes)), env),
    pedirRafamorSql(consultaNombres(Number(anio), Number(mes)), env),
  ]);
  const jurisdiccionesOmitidas = (JSON.parse(nombres).rows as [string, string | null, string | null, string][])
    .filter(([t]) => t === "x")
    .map(([, , , n]) => n);

  // Si RAFAMOR SQL no trae ningún programa sin actividades, las jurisdicciones
  // que los tienen en la foto anterior la conservan (ver arriba).
  let conservar: string[] = [];
  if (!PROGRAMA_SIN_ACTIVIDADES.test(filas)) {
    const r = await db
      .prepare(`SELECT DISTINCT jurisdiccion_codigo AS j FROM rafam_gastos WHERE anio = ? AND mes = ? AND catprog_codigo LIKE '__.00.00' ORDER BY 1`)
      .bind(anio, mes)
      .all<{ j: string }>();
    conservar = (r.results ?? []).map((x) => x.j);
  }

  const mesCompleto = Number(hasta.slice(8)) === new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const conservarJson = JSON.stringify(conservar);
  // Hasta qué día llega lo conservado: la fecha que ya decía la marca, o la de la foto que se reemplaza.
  const previo = cargado.get(`${anio}-${mes}`);
  const fotoAnterior = leerMarca(previo?.archivo)?.hasta ?? previo?.hasta ?? hasta;
  await db.batch([
    db.prepare("DELETE FROM rafam_gastos WHERE anio = ?1 AND mes = ?2 AND jurisdiccion_codigo NOT IN (SELECT value FROM json_each(?3))").bind(anio, mes, conservarJson),
    db.prepare(INSERTAR_MES).bind(anio, mes, filas, nombres, conservarJson),
    db
      .prepare(
        `INSERT OR REPLACE INTO rafam_cortes (anio, mes, desde, hasta, mes_completo, filas, archivo, origen, cargado_en)
         VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COUNT(*) FROM rafam_gastos WHERE anio = ?1 AND mes = ?2), ?6, 'rafamor_sql', datetime('now'))`
      )
      .bind(
        anio,
        mes,
        `${anio}-${String(mes).padStart(2, "0")}-01`,
        hasta,
        mesCompleto ? 1 : 0,
        conservar.length ? `${MARCA_CONSERVADAS} (al ${fotoAnterior}) de las jurisdicciones ${conservar.join(", ")}` : null
      ),
  ]);
  const corte = await db.prepare("SELECT filas FROM rafam_cortes WHERE anio = ? AND mes = ?").bind(anio, mes).first<{ filas: number }>();

  const nombreDe = new Map<string, string>();
  for (const [n, c] of Object.entries(JURISDICCION_CODIGO_POR_NOMBRE)) if (!nombreDe.has(c)) nombreDe.set(c, n);
  return {
    meses: [{ anio, mes, hasta, filas: corte?.filas ?? 0, mesCompleto, conservadas: conservar.map((j) => nombreDe.get(j) ?? j) }],
    pendientes: Math.max(0, nuevos.length - (nuevos.includes(elegido) ? 1 : 0)),
    ultimoDia,
    jurisdiccionesOmitidas,
  };
}
