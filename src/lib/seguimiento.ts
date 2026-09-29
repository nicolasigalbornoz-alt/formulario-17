// Seguimiento de las cargas del F17: quién descargó el formulario de cada
// programa y qué programas ya se marcaron como cargados en RAFAM. No se
// guarda ningún importe del formulario.

import type { Corte, Sql } from "./f17";

export type ModoDescarga = "programa" | "categoria" | "completo";

export interface EstadoPrograma {
  jurisdiccion_codigo: string;
  jurisdiccion: string;
  programa_codigo: string;
  programa: string;
  categorias: number;
  ultima_descarga: string | null;
  descargado_por: string | null;
  modo_descarga: ModoDescarga | null;
  descargas: number;
  cargado_por: string | null;
  cargado_en: string | null;
}

/**
 * Programas con crédito vigente a la fecha de corte (los que tienen que
 * presentar el F17), con su última descarga y la marca de carga en RAFAM
 * del trimestre. `jurisdicciones` null = todas.
 */
export async function estadoProgramas(
  sql: Sql,
  corte: Corte,
  trimestre: number,
  jurisdicciones: string[] | null
): Promise<EstadoPrograma[]> {
  const filtro = jurisdicciones ? `AND g.jurisdiccion_codigo IN (${jurisdicciones.map(() => "?").join(",")})` : "";
  return sql.all<EstadoPrograma>(
    `WITH programas AS (
       SELECT g.jurisdiccion_codigo, MAX(g.jurisdiccion) AS jurisdiccion, g.programa_codigo, MAX(g.programa) AS programa,
              COUNT(DISTINCT g.catprog_codigo) AS categorias
       FROM rafam_gastos g
       WHERE g.anio = ? AND g.mes = ? ${filtro}
       GROUP BY g.jurisdiccion_codigo, g.programa_codigo
       HAVING SUM(g.vigente) > 0
     ),
     descargas AS (
       SELECT jurisdiccion_codigo, programa_codigo, COUNT(*) AS descargas, MAX(creado_en) AS ultima
       FROM f17_descargas WHERE anio = ? AND trimestre = ?
       GROUP BY jurisdiccion_codigo, programa_codigo
     )
     SELECT p.jurisdiccion_codigo, p.jurisdiccion, p.programa_codigo, p.programa, p.categorias,
            d.ultima AS ultima_descarga, COALESCE(d.descargas, 0) AS descargas,
            (SELECT usuario FROM f17_descargas x WHERE x.anio = ? AND x.trimestre = ? AND x.jurisdiccion_codigo = p.jurisdiccion_codigo
               AND x.programa_codigo = p.programa_codigo ORDER BY x.creado_en DESC, x.id DESC LIMIT 1) AS descargado_por,
            (SELECT modo FROM f17_descargas x WHERE x.anio = ? AND x.trimestre = ? AND x.jurisdiccion_codigo = p.jurisdiccion_codigo
               AND x.programa_codigo = p.programa_codigo ORDER BY x.creado_en DESC, x.id DESC LIMIT 1) AS modo_descarga,
            c.usuario AS cargado_por, c.marcado_en AS cargado_en
     FROM programas p
     LEFT JOIN descargas d ON d.jurisdiccion_codigo = p.jurisdiccion_codigo AND d.programa_codigo = p.programa_codigo
     LEFT JOIN f17_cargas c ON c.anio = ? AND c.trimestre = ? AND c.jurisdiccion_codigo = p.jurisdiccion_codigo
                            AND c.programa_codigo = p.programa_codigo
     ORDER BY p.jurisdiccion_codigo, p.programa_codigo`,
    corte.anio,
    corte.mes,
    ...(jurisdicciones ?? []),
    corte.anio,
    trimestre,
    corte.anio,
    trimestre,
    corte.anio,
    trimestre,
    corte.anio,
    trimestre
  );
}

export async function registrarDescarga(
  db: D1Database,
  d: {
    usuario: string;
    anio: number;
    trimestre: number | null;
    modo: ModoDescarga;
    jurisdiccion: string;
    programa: string;
    catprog: string | null;
    fuente: string | null;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO f17_descargas (usuario, anio, trimestre, modo, jurisdiccion_codigo, programa_codigo, catprog_codigo, fuente_codigo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(d.usuario, d.anio, d.trimestre, d.modo, d.jurisdiccion, d.programa, d.catprog, d.fuente)
    .run();
}

export async function marcarCarga(
  db: D1Database,
  anio: number,
  trimestre: number,
  jurisdiccion: string,
  programa: string,
  usuario: string,
  cargado: boolean
): Promise<void> {
  if (cargado) {
    await db
      .prepare(
        `INSERT OR REPLACE INTO f17_cargas (anio, trimestre, jurisdiccion_codigo, programa_codigo, usuario, marcado_en)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      )
      .bind(anio, trimestre, jurisdiccion, programa, usuario)
      .run();
  } else {
    await db
      .prepare("DELETE FROM f17_cargas WHERE anio = ? AND trimestre = ? AND jurisdiccion_codigo = ? AND programa_codigo = ?")
      .bind(anio, trimestre, jurisdiccion, programa)
      .run();
  }
}

/** "2026-09-28 17:46:52" (UTC, como guarda SQLite) -> "28/09 14:46" en hora de Argentina. */
export function fechaHoraAR(utc: string | null): string {
  if (!utc) return "";
  const d = new Date(`${utc.replace(" ", "T")}Z`);
  return d.toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
