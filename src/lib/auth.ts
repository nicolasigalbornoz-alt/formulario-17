// Ingreso al sitio. Dos tipos de usuario:
//  - administrador: ve todas las jurisdicciones, el panel y el seguimiento.
//    El principal es "admin" con la contraseña del secret ADMIN_PASSWORD_HASH
//    (sha-256); se pueden sumar otros en la tabla usuarios con rol "admin".
//  - secretaría: solo ve y descarga el F17 de sus jurisdicciones.
//
// Sesión: cookie firmada con HMAC (secret SESSION_SECRET) que lleva el id del
// usuario y su "versión de sesión"; cambiar la contraseña la invalida.

export const SESSION_COOKIE = "f17_sesion";
export const SESSION_MAX_AGE_S = 12 * 60 * 60; // 12 hs
const ADMIN_ENV_ID = "admin";

export type Rol = "admin" | "secretaria";

export interface Usuario {
  /** "admin" para el administrador del secret; si no, el id de la tabla usuarios. */
  id: string;
  usuario: string;
  nombre: string;
  rol: Rol;
  /** Jurisdicciones que puede ver; null = todas (administrador). */
  jurisdicciones: string[] | null;
}

const enc = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const toB64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

export async function hmacHex(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
}

/** Comparación de strings sin cortocircuito (no filtra por tiempos cuántos caracteres coinciden). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Contraseñas de la tabla usuarios: PBKDF2-SHA256 con sal. Las iteraciones
// quedan guardadas en el hash para poder subirlas más adelante. 20.000 es un
// compromiso con el tope de CPU por pedido de Cloudflare Workers.

const ITERACIONES = 20_000;

async function pbkdf2(clave: string, sal: Uint8Array<ArrayBuffer>, iteraciones: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(clave), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: iteraciones }, key, 256);
}

export async function hashClave(clave: string): Promise<string> {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERACIONES}$${toB64(sal)}$${toB64(await pbkdf2(clave, sal, ITERACIONES))}`;
}

export async function verificarClave(clave: string, guardado: string): Promise<boolean> {
  const [tipo, iter, sal, hash] = guardado.split("$");
  if (tipo !== "pbkdf2" || !iter || !sal || !hash) return false;
  const calculado = toB64(await pbkdf2(clave, fromB64(sal), Number(iter)));
  return timingSafeEqual(calculado, hash);
}

/** Contraseña al azar legible (sin 0/O, 1/l/i): 12 caracteres en 3 grupos, ~59 bits. */
export function generarClave(): string {
  const alfabeto = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const c = [...bytes].map((b) => alfabeto[b % alfabeto.length]).join("");
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}

// ---------------------------------------------------------------------------
// Sesión

interface FilaUsuario {
  id: number;
  usuario: string;
  nombre: string;
  rol: Rol;
  clave_hash: string | null;
  activo: number;
  version_sesion: number;
}

function versionAdminEnv(env: Env): string {
  return (env.ADMIN_PASSWORD_HASH ?? "").trim().toLowerCase().slice(0, 12);
}

export async function crearSesion(id: string, version: string | number, secret: string): Promise<string> {
  const emitida = Date.now().toString(36);
  const cuerpo = `${id}.${version}.${emitida}`;
  return `${cuerpo}.${await hmacHex(`sesion:${cuerpo}`, secret)}`;
}

async function leerSesion(valor: string | undefined, secret: string): Promise<{ id: string; version: string } | null> {
  if (!valor) return null;
  const partes = valor.split(".");
  if (partes.length !== 4) return null;
  const [id, version, emitida, firma] = partes;
  const edad = Date.now() - parseInt(emitida, 36);
  if (!(edad >= 0 && edad <= SESSION_MAX_AGE_S * 1000)) return null;
  const esperada = await hmacHex(`sesion:${id}.${version}.${emitida}`, secret);
  return timingSafeEqual(esperada, firma) ? { id, version } : null;
}

async function jurisdiccionesDe(db: D1Database, id: number): Promise<string[]> {
  const res = await db
    .prepare("SELECT jurisdiccion_codigo FROM usuario_jurisdicciones WHERE usuario_id = ? ORDER BY jurisdiccion_codigo")
    .bind(id)
    .all<{ jurisdiccion_codigo: string }>();
  return (res.results ?? []).map((r) => r.jurisdiccion_codigo);
}

async function aUsuario(db: D1Database, f: FilaUsuario): Promise<Usuario> {
  return {
    id: String(f.id),
    usuario: f.usuario,
    nombre: f.nombre,
    rol: f.rol,
    jurisdicciones: f.rol === "admin" ? null : await jurisdiccionesDe(db, f.id),
  };
}

const ADMIN_ENV: Omit<Usuario, "id"> = { usuario: "admin", nombre: "Administración", rol: "admin", jurisdicciones: null };

/** Usuario de la cookie, o null si no hay sesión válida. */
export async function usuarioDeSesion(db: D1Database, env: Env, cookie: string | undefined): Promise<Usuario | null> {
  if (!env.SESSION_SECRET) return null;
  const s = await leerSesion(cookie, env.SESSION_SECRET);
  if (!s) return null;
  if (s.id === ADMIN_ENV_ID) {
    return env.ADMIN_PASSWORD_HASH && s.version === versionAdminEnv(env) ? { id: ADMIN_ENV_ID, ...ADMIN_ENV } : null;
  }
  const f = await db
    .prepare("SELECT id, usuario, nombre, rol, clave_hash, activo, version_sesion FROM usuarios WHERE id = ?")
    .bind(Number(s.id))
    .first<FilaUsuario>();
  if (!f || !f.activo || !f.clave_hash || String(f.version_sesion) !== s.version) return null;
  return aUsuario(db, f);
}

const MAX_FALLIDOS = 8; // por usuario, en 15 minutos

export type ResultadoIngreso =
  | { ok: true; usuario: Usuario; cookie: string }
  | { ok: false; motivo: "config" | "bloqueado" | "invalido" };

export async function ingresar(db: D1Database, env: Env, usuario: string, clave: string): Promise<ResultadoIngreso> {
  if (!env.SESSION_SECRET) return { ok: false, motivo: "config" };
  const nombre = usuario.trim().toLowerCase().slice(0, 80);

  const fallidos = await db
    .prepare("SELECT COUNT(*) AS n FROM ingresos_fallidos WHERE usuario = ? AND creado_en > datetime('now', '-15 minutes')")
    .bind(nombre)
    .first<{ n: number }>();
  if ((fallidos?.n ?? 0) >= MAX_FALLIDOS) return { ok: false, motivo: "bloqueado" };

  const fallar = async (): Promise<ResultadoIngreso> => {
    await db.batch([
      db.prepare("INSERT INTO ingresos_fallidos (usuario) VALUES (?)").bind(nombre),
      db.prepare("DELETE FROM ingresos_fallidos WHERE creado_en < datetime('now', '-1 day')"),
    ]);
    return { ok: false, motivo: "invalido" };
  };

  if (nombre === ADMIN_ENV.usuario) {
    if (!env.ADMIN_PASSWORD_HASH) return { ok: false, motivo: "config" };
    if (!timingSafeEqual(await sha256Hex(clave), env.ADMIN_PASSWORD_HASH.trim().toLowerCase())) return fallar();
    return {
      ok: true,
      usuario: { id: ADMIN_ENV_ID, ...ADMIN_ENV },
      cookie: await crearSesion(ADMIN_ENV_ID, versionAdminEnv(env), env.SESSION_SECRET),
    };
  }

  const f = await db
    .prepare("SELECT id, usuario, nombre, rol, clave_hash, activo, version_sesion FROM usuarios WHERE usuario = ?")
    .bind(nombre)
    .first<FilaUsuario>();
  if (!f || !f.activo || !f.clave_hash || !(await verificarClave(clave, f.clave_hash))) return fallar();

  await db.prepare("UPDATE usuarios SET ultimo_ingreso = datetime('now') WHERE id = ?").bind(f.id).run();
  return { ok: true, usuario: await aUsuario(db, f), cookie: await crearSesion(String(f.id), f.version_sesion, env.SESSION_SECRET) };
}

/** ¿Puede este usuario ver esa jurisdicción? */
export function puedeVer(u: Usuario, jurisdiccion: string): boolean {
  return u.jurisdicciones === null || u.jurisdicciones.includes(jurisdiccion);
}

/**
 * Página a la que entra cada uno después de ingresar: el administrador, al
 * inicio (solo para administradores); las secretarías, directo a su F17.
 */
export function inicioDe(u: Usuario): string {
  return u.rol === "admin" ? "/inicio" : "/formulario-17";
}
