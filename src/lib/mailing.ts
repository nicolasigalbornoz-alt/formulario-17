// Lista de difusión de la Dirección de Presupuesto. Pide los mismos datos que
// el formulario de Google "inscripción" que estaba embebido en el Sites.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const CARGOS = [
  "Administrativo/a",
  "Coordinador/a, Jefe/a de departamento/división",
  "Director/a del área",
  "Director/a administrativo",
  "Subsecretario/a del área",
  "Subsecretario/a administrativo",
  "Secretario/a",
  "Otro",
] as const;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim()) && email.length <= 254;
}

export interface Suscriptor {
  id: number;
  email: string;
  nombre: string | null;
  secretaria: string | null;
  cargo: string | null;
  programas: string | null;
  telefono: string | null;
  email_alternativo: string | null;
  activo: number;
  creado_en: string;
  actualizado_en: string | null;
}

export type DatosSuscripcion = Omit<Suscriptor, "id" | "activo" | "creado_en" | "actualizado_en">;

const limpiar = (v: FormDataEntryValue | null, max = 300) => {
  const s = String(v ?? "").trim().slice(0, max);
  return s || null;
};

/** Valida el formulario público; devuelve los datos o el mensaje de error. */
export function leerFormulario(form: FormData): { datos: DatosSuscripcion } | { error: string } {
  const datos: DatosSuscripcion = {
    email: String(form.get("email") ?? "").trim().toLowerCase(),
    nombre: limpiar(form.get("nombre"), 120),
    secretaria: limpiar(form.get("secretaria"), 160),
    cargo: limpiar(form.get("cargo"), 80),
    programas: limpiar(form.get("programas"), 300),
    telefono: limpiar(form.get("telefono"), 40),
    email_alternativo: limpiar(form.get("email_alternativo"), 254)?.toLowerCase() ?? null,
  };
  if (!datos.nombre) return { error: "Completá tu nombre." };
  if (!datos.secretaria) return { error: "Completá la Secretaría." };
  if (!datos.cargo || !(CARGOS as readonly string[]).includes(datos.cargo)) return { error: "Elegí tu cargo." };
  if (!datos.programas) return { error: "Indicá los programas o categorías programáticas por las que respondés." };
  if (!isValidEmail(datos.email)) return { error: "El mail institucional no es válido." };
  if (datos.email_alternativo && !isValidEmail(datos.email_alternativo)) return { error: "El mail alternativo no es válido." };
  return { datos };
}

export async function suscribir(db: D1Database, d: DatosSuscripcion): Promise<void> {
  await db
    .prepare(
      `INSERT INTO suscriptores (email, nombre, secretaria, cargo, programas, telefono, email_alternativo, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT (email) DO UPDATE SET
         activo = 1, nombre = excluded.nombre, secretaria = excluded.secretaria, cargo = excluded.cargo,
         programas = excluded.programas, telefono = excluded.telefono,
         email_alternativo = excluded.email_alternativo, actualizado_en = datetime('now')`
    )
    .bind(d.email, d.nombre, d.secretaria, d.cargo, d.programas, d.telefono, d.email_alternativo)
    .run();
}

export async function desuscribir(db: D1Database, email: string): Promise<boolean> {
  const res = await db
    .prepare("UPDATE suscriptores SET activo = 0, actualizado_en = datetime('now') WHERE email = ? AND activo = 1")
    .bind(email.trim().toLowerCase())
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function reactivar(db: D1Database, id: number, activo: boolean): Promise<void> {
  await db
    .prepare("UPDATE suscriptores SET activo = ?, actualizado_en = datetime('now') WHERE id = ?")
    .bind(activo ? 1 : 0, id)
    .run();
}

export async function listarSuscriptores(db: D1Database, soloActivos = true): Promise<Suscriptor[]> {
  const where = soloActivos ? "WHERE activo = 1" : "";
  const res = await db.prepare(`SELECT * FROM suscriptores ${where} ORDER BY creado_en DESC, id DESC`).all<Suscriptor>();
  return res.results ?? [];
}

const COLUMNAS_CSV: [keyof Suscriptor, string][] = [
  ["nombre", "Nombre completo"],
  ["secretaria", "Secretaría"],
  ["cargo", "Cargo"],
  ["programas", "Programa(s) o Categoría(s) Programática(s)"],
  ["telefono", "Teléfono celular"],
  ["email", "Mail institucional"],
  ["email_alternativo", "Mail alternativo"],
  ["activo", "Activo"],
  ["creado_en", "Alta (UTC)"],
  ["actualizado_en", "Última modificación (UTC)"],
];

export function suscriptoresToCsv(rows: Suscriptor[]): string {
  // Evita que Excel interprete como fórmula un valor que empieza con = + - @.
  const celda = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = COLUMNAS_CSV.map(([, t]) => celda(t)).join(",");
  const lines = rows.map((r) =>
    COLUMNAS_CSV.map(([k]) => (k === "activo" ? celda(r.activo ? "Sí" : "No") : celda(r[k]))).join(",")
  );
  // BOM para que Excel abra bien los acentos.
  return "﻿" + [header, ...lines].join("\r\n");
}

/** Enlace de baja que va en cada aviso (la página pide confirmar con un botón). */
export function enlaceBaja(base: string, email: string): string {
  return `${base.replace(/\/$/, "")}/lista-de-difusion/baja?${new URLSearchParams({ e: email })}`;
}
