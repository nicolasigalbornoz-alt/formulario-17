-- Usuarios del F17: un administrador (ve todo) y un usuario por secretaría
-- (solo ve y descarga los formularios de sus jurisdicciones).
--
-- El administrador principal sigue entrando con el usuario "admin" y la
-- contraseña del secret ADMIN_PASSWORD_HASH (no vive en esta tabla); acá se
-- pueden sumar otros administradores.
--
-- La página no guarda ningún dato del formulario: el F17 se completa en el
-- Excel descargado. Solo se registra quién descargó qué (f17_descargas) y,
-- si el área lo marca, que ya lo cargó en RAFAM (f17_cargas), para el
-- seguimiento del administrador.

CREATE TABLE IF NOT EXISTS usuarios (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nombre          TEXT NOT NULL,
  rol             TEXT NOT NULL DEFAULT 'secretaria' CHECK (rol IN ('admin', 'secretaria')),
  clave_hash      TEXT,            -- pbkdf2$iteraciones$sal$hash; NULL = todavía sin contraseña (no puede entrar)
  activo          INTEGER NOT NULL DEFAULT 1,
  version_sesion  INTEGER NOT NULL DEFAULT 1,  -- se incrementa al cambiar la contraseña: cierra las sesiones abiertas
  creado_en       TEXT NOT NULL DEFAULT (datetime('now')),
  ultimo_ingreso  TEXT
);

CREATE TABLE IF NOT EXISTS usuario_jurisdicciones (
  usuario_id          INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  jurisdiccion_codigo TEXT NOT NULL,
  PRIMARY KEY (usuario_id, jurisdiccion_codigo)
);

CREATE TABLE IF NOT EXISTS f17_descargas (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario             TEXT NOT NULL,
  anio                INTEGER NOT NULL,
  trimestre           INTEGER,     -- trimestre a programar al momento de descargar
  modo                TEXT NOT NULL CHECK (modo IN ('programa', 'categoria', 'completo')),
  jurisdiccion_codigo TEXT NOT NULL,
  programa_codigo     TEXT NOT NULL,
  catprog_codigo      TEXT,
  fuente_codigo       TEXT,
  creado_en           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_f17_descargas_programa
  ON f17_descargas (anio, trimestre, jurisdiccion_codigo, programa_codigo);

-- El F17 se carga en RAFAM por programa: una marca por programa y trimestre.
CREATE TABLE IF NOT EXISTS f17_cargas (
  anio                INTEGER NOT NULL,
  trimestre           INTEGER NOT NULL,
  jurisdiccion_codigo TEXT NOT NULL,
  programa_codigo     TEXT NOT NULL,
  usuario             TEXT NOT NULL,
  marcado_en          TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (anio, trimestre, jurisdiccion_codigo, programa_codigo)
);

-- Intentos de ingreso fallidos, para frenar la prueba de contraseñas.
CREATE TABLE IF NOT EXISTS ingresos_fallidos (
  usuario   TEXT NOT NULL COLLATE NOCASE,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ingresos_fallidos ON ingresos_fallidos (usuario, creado_en);

-- Un usuario por cada secretaría/jurisdicción con presupuesto 2026, sin
-- contraseña: el administrador se la genera desde el panel (Usuarios).
INSERT OR IGNORE INTO usuarios (usuario, nombre) VALUES
  ('hcd', 'H.C.D.'),
  ('economia', 'Economía y Finanzas'),
  ('salud', 'Salud'),
  ('obras', 'Obras y Servicios Públicos'),
  ('control-comunal', 'Control Comunal'),
  ('educacion', 'Educación y Desarrollo de la Comunidad'),
  ('deuda', 'Servicios de la Deuda'),
  ('legal-y-tecnica', 'Asistencia Legal y Técnica'),
  ('planificacion', 'Planificación Estratégica'),
  ('mujeres', 'Mujeres, Géneros, Diversidad y DDHH'),
  ('jefatura', 'Jefatura de Gabinete'),
  ('seguridad', 'Seguridad Ciudadana'),
  ('desarrollo-local', 'Desarrollo Local, Empleo y Economía Social'),
  ('desarrollo-productivo', 'Desarrollo Productivo'),
  ('transito', 'Tránsito y Transporte');

INSERT OR IGNORE INTO usuario_jurisdicciones (usuario_id, jurisdiccion_codigo)
SELECT id, CASE usuario
  WHEN 'hcd' THEN '00' WHEN 'economia' THEN '03' WHEN 'salud' THEN '04' WHEN 'obras' THEN '05'
  WHEN 'control-comunal' THEN '06' WHEN 'educacion' THEN '07' WHEN 'deuda' THEN '09'
  WHEN 'legal-y-tecnica' THEN '10' WHEN 'planificacion' THEN '11' WHEN 'mujeres' THEN '13'
  WHEN 'jefatura' THEN '16' WHEN 'seguridad' THEN '17' WHEN 'desarrollo-local' THEN '22'
  WHEN 'desarrollo-productivo' THEN '25' WHEN 'transito' THEN '27' END
FROM usuarios
WHERE usuario IN ('hcd', 'economia', 'salud', 'obras', 'control-comunal', 'educacion', 'deuda', 'legal-y-tecnica',
                  'planificacion', 'mujeres', 'jefatura', 'seguridad', 'desarrollo-local', 'desarrollo-productivo', 'transito');
