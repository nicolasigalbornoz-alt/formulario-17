const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export interface Suscriptor {
  id: number;
  email: string;
  nombre: string | null;
  activo: number;
  creado_en: string;
}

export async function suscribir(db: D1Database, email: string, nombre: string | null): Promise<void> {
  await db
    .prepare(
      `INSERT INTO suscriptores (email, nombre, activo) VALUES (?, ?, 1)
       ON CONFLICT (email) DO UPDATE SET activo = 1, nombre = COALESCE(excluded.nombre, suscriptores.nombre)`
    )
    .bind(email.trim().toLowerCase(), nombre?.trim() || null)
    .run();
}

export async function desuscribir(db: D1Database, email: string): Promise<void> {
  await db.prepare("UPDATE suscriptores SET activo = 0 WHERE email = ?").bind(email.trim().toLowerCase()).run();
}

export async function listarSuscriptores(db: D1Database, soloActivos = true): Promise<Suscriptor[]> {
  const where = soloActivos ? "WHERE activo = 1" : "";
  const res = await db.prepare(`SELECT * FROM suscriptores ${where} ORDER BY creado_en DESC`).all<Suscriptor>();
  return res.results ?? [];
}

export function suscriptoresToCsv(rows: Suscriptor[]): string {
  const header = "email,nombre,activo,creado_en";
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [escape(r.email), escape(r.nombre ?? ""), r.activo, escape(r.creado_en)].join(","));
  return [header, ...lines].join("\n");
}
