// Avisos y fechas de vencimiento que carga el administrador, y las alertas
// por mail de los vencimientos (ver migrations/0004).

import { armarMensaje, enviarAvisoMasivo, proveedorConfigurado } from "./mail-sender";
import { enlaceBaja, listarSuscriptores } from "./mailing";

export interface Aviso {
  id: number;
  titulo: string;
  texto: string;
  desde: string;
  hasta: string | null;
  importante: number;
  creado_por: string | null;
  creado_en: string;
}

export interface Vencimiento {
  id: number;
  titulo: string;
  descripcion: string | null;
  fecha: string;
  alerta_dias: number;
  alerta_mismo_dia: number;
  creado_por: string | null;
  creado_en: string;
}

export interface VencimientoConAlertas extends Vencimiento {
  alerta_anticipada_en: string | null;
  alerta_mismo_dia_en: string | null;
}

/** Fecha de hoy en Argentina, AAAA-MM-DD. */
export function hoyAR(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

/** "2026-10-15" -> "jueves 15/10". */
export function fechaLarga(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const dia = d.toLocaleDateString("es-AR", { weekday: "long", timeZone: "UTC" });
  return `${dia} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

export function diasHasta(iso: string, hoy = hoyAR()): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Consultas públicas (tolerantes a una base sin la migración 0004)

async function seguro<T>(p: Promise<T>, vacio: T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (/no such table/i.test(String(e))) return vacio;
    throw e;
  }
}

export async function avisosVigentes(db: D1Database, limite = 5): Promise<Aviso[]> {
  const hoy = hoyAR();
  return seguro(
    db
      .prepare(
        `SELECT * FROM avisos WHERE desde <= ? AND (hasta IS NULL OR hasta >= ?)
         ORDER BY importante DESC, desde DESC, id DESC LIMIT ?`
      )
      .bind(hoy, hoy, limite)
      .all<Aviso>()
      .then((r) => r.results ?? []),
    []
  );
}

export async function proximosVencimientos(db: D1Database, limite = 6): Promise<Vencimiento[]> {
  return seguro(
    db
      .prepare("SELECT * FROM vencimientos WHERE fecha >= ? ORDER BY fecha, id LIMIT ?")
      .bind(hoyAR(), limite)
      .all<Vencimiento>()
      .then((r) => r.results ?? []),
    []
  );
}

// ---------------------------------------------------------------------------
// Administración

export async function listarAvisos(db: D1Database): Promise<Aviso[]> {
  const r = await db.prepare("SELECT * FROM avisos ORDER BY desde DESC, id DESC LIMIT 100").all<Aviso>();
  return r.results ?? [];
}

export async function listarVencimientos(db: D1Database): Promise<VencimientoConAlertas[]> {
  const r = await db
    .prepare(
      `SELECT v.*,
              (SELECT enviado_en FROM vencimientos_alertas a WHERE a.vencimiento_id = v.id AND a.tipo = 'anticipada') AS alerta_anticipada_en,
              (SELECT enviado_en FROM vencimientos_alertas a WHERE a.vencimiento_id = v.id AND a.tipo = 'mismo_dia') AS alerta_mismo_dia_en
       FROM vencimientos v
       WHERE v.fecha >= date(?, '-60 days')
       ORDER BY v.fecha, v.id`
    )
    .bind(hoyAR())
    .all<VencimientoConAlertas>();
  return r.results ?? [];
}

export async function guardarAviso(
  db: D1Database,
  d: { id?: number; titulo: string; texto: string; desde: string; hasta: string | null; importante: boolean; usuario: string }
): Promise<void> {
  if (d.id) {
    await db
      .prepare("UPDATE avisos SET titulo = ?, texto = ?, desde = ?, hasta = ?, importante = ? WHERE id = ?")
      .bind(d.titulo, d.texto, d.desde, d.hasta, d.importante ? 1 : 0, d.id)
      .run();
  } else {
    await db
      .prepare("INSERT INTO avisos (titulo, texto, desde, hasta, importante, creado_por) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(d.titulo, d.texto, d.desde, d.hasta, d.importante ? 1 : 0, d.usuario)
      .run();
  }
}

export async function guardarVencimiento(
  db: D1Database,
  d: { id?: number; titulo: string; descripcion: string | null; fecha: string; alertaDias: number; alertaMismoDia: boolean; usuario: string }
): Promise<void> {
  if (d.id) {
    const antes = await db.prepare("SELECT fecha FROM vencimientos WHERE id = ?").bind(d.id).first<{ fecha: string }>();
    await db
      .prepare("UPDATE vencimientos SET titulo = ?, descripcion = ?, fecha = ?, alerta_dias = ?, alerta_mismo_dia = ? WHERE id = ?")
      .bind(d.titulo, d.descripcion, d.fecha, d.alertaDias, d.alertaMismoDia ? 1 : 0, d.id)
      .run();
    // Si cambió la fecha, las alertas vuelven a salir para la fecha nueva.
    if (antes && antes.fecha !== d.fecha) {
      await db.prepare("DELETE FROM vencimientos_alertas WHERE vencimiento_id = ?").bind(d.id).run();
    }
  } else {
    await db
      .prepare(
        "INSERT INTO vencimientos (titulo, descripcion, fecha, alerta_dias, alerta_mismo_dia, creado_por) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(d.titulo, d.descripcion, d.fecha, d.alertaDias, d.alertaMismoDia ? 1 : 0, d.usuario)
      .run();
  }
}

export async function borrar(db: D1Database, tabla: "avisos" | "vencimientos", id: number): Promise<void> {
  if (tabla === "vencimientos") {
    await db.batch([
      db.prepare("DELETE FROM vencimientos_alertas WHERE vencimiento_id = ?").bind(id),
      db.prepare("DELETE FROM vencimientos WHERE id = ?").bind(id),
    ]);
  } else {
    await db.prepare("DELETE FROM avisos WHERE id = ?").bind(id).run();
  }
}

// ---------------------------------------------------------------------------
// Mails

/** Manda un mail a toda la lista de difusión y lo deja en el historial (avisos_enviados). */
export async function mandarALaLista(
  env: Env,
  sitio: string,
  asunto: string,
  cuerpo: string
): Promise<{ estado: string; detalle: string; enviados: number; destinatarios: number }> {
  const suscriptores = await listarSuscriptores(env.DB, true);
  const mensajes = suscriptores.map((s) => armarMensaje(s.email, asunto, cuerpo, enlaceBaja(sitio, s.email), sitio));
  const r = await enviarAvisoMasivo(env, mensajes);
  const estado = !proveedorConfigurado(env)
    ? "pendiente"
    : r.enviados === mensajes.length
      ? "enviado"
      : r.enviados > 0
        ? "parcial"
        : "error";
  await env.DB
    .prepare("INSERT INTO avisos_enviados (asunto, cuerpo, destinatarios, enviados, estado, detalle) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(asunto, cuerpo, mensajes.length, r.enviados, estado, r.detalle)
    .run();
  return { estado, detalle: r.detalle, enviados: r.enviados, destinatarios: mensajes.length };
}

/** Asunto y texto de la alerta de un vencimiento (anticipada o del mismo día). */
export function textoAlerta(
  v: Pick<Vencimiento, "titulo" | "descripcion" | "fecha">,
  faltan: number,
  sitio: string
): { asunto: string; cuerpo: string } {
  const cuando = faltan === 0 ? "hoy" : faltan === 1 ? "mañana" : `en ${faltan} días`;
  return {
    asunto: faltan === 0 ? `Hoy vence: ${v.titulo}` : `Recordatorio: ${v.titulo} vence ${cuando}`,
    cuerpo:
      `${v.titulo}: vence ${cuando}, el ${fechaLarga(v.fecha)}.` +
      (v.descripcion ? `\n\n${v.descripcion}` : "") +
      `\n\nEl F17 prellenado está en ${sitio}/formulario-17`,
  };
}

export interface ResultadoAlertas {
  revisados: number;
  enviadas: string[];
  pendientes: string[];
}

/**
 * Alertas de vencimientos que corresponden hoy: la anticipada (desde
 * `alerta_dias` antes) y la del mismo día. Cada una sale una sola vez. Sin
 * proveedor de mail configurado no se registra nada, así salen cuando se
 * configure (si todavía están a tiempo).
 */
export async function enviarAlertasDelDia(env: Env, sitio: string): Promise<ResultadoAlertas> {
  const db = env.DB;
  const hoy = hoyAR();
  const res = await db
    .prepare(
      `SELECT v.*,
              (SELECT 1 FROM vencimientos_alertas a WHERE a.vencimiento_id = v.id AND a.tipo = 'anticipada') AS ya_anticipada,
              (SELECT 1 FROM vencimientos_alertas a WHERE a.vencimiento_id = v.id AND a.tipo = 'mismo_dia') AS ya_mismo_dia
       FROM vencimientos v WHERE v.fecha >= ? AND v.fecha <= date(?, '+30 days')`
    )
    .bind(hoy, hoy)
    .all<Vencimiento & { ya_anticipada: number | null; ya_mismo_dia: number | null }>();

  const out: ResultadoAlertas = { revisados: res.results?.length ?? 0, enviadas: [], pendientes: [] };
  const hayProveedor = Boolean(proveedorConfigurado(env));

  for (const v of res.results ?? []) {
    const faltan = diasHasta(v.fecha, hoy);
    let tipo: "anticipada" | "mismo_dia" | null = null;
    if (faltan === 0 && v.alerta_mismo_dia && !v.ya_mismo_dia) tipo = "mismo_dia";
    else if (faltan > 0 && v.alerta_dias > 0 && faltan <= v.alerta_dias && !v.ya_anticipada) tipo = "anticipada";
    if (!tipo) continue;

    const { asunto, cuerpo } = textoAlerta(v, faltan, sitio);

    if (!hayProveedor) {
      out.pendientes.push(`${v.titulo} (${tipo === "mismo_dia" ? "mismo día" : "anticipada"})`);
      continue;
    }
    const r = await mandarALaLista(env, sitio, asunto, cuerpo);
    if (r.enviados > 0) {
      await db
        .prepare(
          "INSERT OR REPLACE INTO vencimientos_alertas (vencimiento_id, tipo, destinatarios, enviados, detalle) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(v.id, tipo, r.destinatarios, r.enviados, r.detalle)
        .run();
      out.enviadas.push(`${v.titulo} (${tipo === "mismo_dia" ? "mismo día" : "anticipada"})`);
    } else {
      out.pendientes.push(`${v.titulo}: ${r.detalle}`);
    }
  }
  return out;
}
