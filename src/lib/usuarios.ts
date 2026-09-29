// Alta y mantenimiento de usuarios (panel → Usuarios).

import { generarClave, hashClave, type Rol } from "./auth";

export interface UsuarioFila {
  id: number;
  usuario: string;
  nombre: string;
  rol: Rol;
  activo: number;
  tiene_clave: number;
  ultimo_ingreso: string | null;
  creado_en: string;
  jurisdicciones: string | null; // "03,04"
}

export async function listarUsuarios(db: D1Database): Promise<UsuarioFila[]> {
  const res = await db
    .prepare(
      `SELECT u.id, u.usuario, u.nombre, u.rol, u.activo, u.clave_hash IS NOT NULL AS tiene_clave, u.ultimo_ingreso, u.creado_en,
              (SELECT group_concat(jurisdiccion_codigo, ',') FROM
                 (SELECT jurisdiccion_codigo FROM usuario_jurisdicciones j WHERE j.usuario_id = u.id ORDER BY jurisdiccion_codigo)) AS jurisdicciones
       FROM usuarios u ORDER BY u.rol, u.nombre`
    )
    .all<UsuarioFila>();
  return res.results ?? [];
}

const USUARIO_RE = /^[a-z0-9][a-z0-9._-]{1,39}$/;

export function validarUsuario(usuario: string): string | null {
  if (!USUARIO_RE.test(usuario)) return "El usuario va en minúsculas, sin espacios ni acentos (letras, números, punto, guion), de 2 a 40 caracteres.";
  if (usuario === "admin") return "«admin» está reservado para el administrador principal.";
  return null;
}

export async function crearUsuario(
  db: D1Database,
  d: { usuario: string; nombre: string; rol: Rol; jurisdicciones: string[]; clave: string | null }
): Promise<{ clave: string }> {
  const clave = d.clave || generarClave();
  const res = await db
    .prepare("INSERT INTO usuarios (usuario, nombre, rol, clave_hash) VALUES (?, ?, ?, ?) RETURNING id")
    .bind(d.usuario, d.nombre, d.rol, await hashClave(clave))
    .first<{ id: number }>();
  await guardarJurisdicciones(db, res!.id, d.rol === "admin" ? [] : d.jurisdicciones);
  return { clave };
}

export async function actualizarUsuario(
  db: D1Database,
  id: number,
  d: { nombre: string; rol: Rol; jurisdicciones: string[] }
): Promise<void> {
  await db.prepare("UPDATE usuarios SET nombre = ?, rol = ? WHERE id = ?").bind(d.nombre, d.rol, id).run();
  await guardarJurisdicciones(db, id, d.rol === "admin" ? [] : d.jurisdicciones);
}

async function guardarJurisdicciones(db: D1Database, id: number, jurisdicciones: string[]) {
  await db.batch([
    db.prepare("DELETE FROM usuario_jurisdicciones WHERE usuario_id = ?").bind(id),
    ...jurisdicciones.map((j) =>
      db.prepare("INSERT INTO usuario_jurisdicciones (usuario_id, jurisdiccion_codigo) VALUES (?, ?)").bind(id, j)
    ),
  ]);
}

/** Pone una contraseña nueva (la indicada o una al azar) y cierra las sesiones abiertas de ese usuario. */
export async function nuevaClave(db: D1Database, id: number, clave?: string | null): Promise<string> {
  const nueva = clave || generarClave();
  await db
    .prepare("UPDATE usuarios SET clave_hash = ?, version_sesion = version_sesion + 1 WHERE id = ?")
    .bind(await hashClave(nueva), id)
    .run();
  return nueva;
}

export async function activarUsuario(db: D1Database, id: number, activo: boolean): Promise<void> {
  await db
    .prepare("UPDATE usuarios SET activo = ?, version_sesion = version_sesion + 1 WHERE id = ?")
    .bind(activo ? 1 : 0, id)
    .run();
}

export async function borrarUsuario(db: D1Database, id: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM usuario_jurisdicciones WHERE usuario_id = ?").bind(id),
    db.prepare("DELETE FROM usuarios WHERE id = ?").bind(id),
  ]);
}
