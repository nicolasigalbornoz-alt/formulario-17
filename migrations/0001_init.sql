-- Esquema para Formulario 17 (ejecución presupuestaria).
-- Modelo reconstruido a partir de las planillas "registros f17" (hojas
-- basevig / añoant / vigente / datos) y sus fórmulas.
--
-- Una fila de `ejecucion` = una partida, dentro de una fuente, un programa
-- (y opcionalmente una categoría programática), una jurisdicción, un año y
-- un trimestre.
--   trim = 0  -> snapshot inicial del ejercicio (presupuesto aprobado/vigente
--                al sancionarse, compromiso en 0)
--   trim = 1..4 -> lo comprometido/devengado/pagado en ESE trimestre puntual
--                  (no acumulado) y el crédito vigente vigente en ese momento
--                  (puede cambiar por modificaciones presupuestarias)
--
-- "Crédito vigente al último día disponible" = vigente de la fila con el
-- mayor `trim` cargado para esa combinación jurisdicción+programa+
-- (categoría)+fuente+partida en el año en curso. "Compromiso" acumulado =
-- suma de compromiso agrupando por partida a través de todos los trimestres
-- cargados.

CREATE TABLE IF NOT EXISTS jurisdicciones (
  cod   TEXT PRIMARY KEY,
  denom TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fuentes (
  cod   TEXT PRIMARY KEY,
  denom TEXT NOT NULL
);

-- El código de programa está anidado dentro de la jurisdicción
-- (mismo número de programa se reutiliza en distintas jurisdicciones).
CREATE TABLE IF NOT EXISTS programas (
  jurisdiccion_cod TEXT NOT NULL,
  programa_cod     TEXT NOT NULL,
  denom            TEXT NOT NULL,
  PRIMARY KEY (jurisdiccion_cod, programa_cod)
);

CREATE TABLE IF NOT EXISTS partidas (
  cod   TEXT PRIMARY KEY,
  denom TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ejecucion (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  anio              INTEGER NOT NULL,
  trim              INTEGER NOT NULL,
  jurisdiccion_cod  TEXT NOT NULL,
  programa_cod      TEXT NOT NULL,
  -- categoría programática: un nivel más granular, anidado dentro de programa.
  catprog_cod       TEXT,
  catprog_denom     TEXT,
  fuente_cod        TEXT NOT NULL,
  partida_cod       TEXT NOT NULL,
  partida_denom     TEXT,
  aprobado          REAL,
  vigente           REAL,
  compromiso        REAL,
  devengado         REAL,
  pagado            REAL,
  cargado_en        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (anio, trim, jurisdiccion_cod, programa_cod, catprog_cod, fuente_cod, partida_cod)
);

CREATE INDEX IF NOT EXISTS idx_ejecucion_prog
  ON ejecucion (anio, jurisdiccion_cod, programa_cod, fuente_cod, partida_cod);

CREATE INDEX IF NOT EXISTS idx_ejecucion_catprog
  ON ejecucion (anio, jurisdiccion_cod, programa_cod, catprog_cod, fuente_cod, partida_cod);

CREATE INDEX IF NOT EXISTS idx_ejecucion_trim
  ON ejecucion (anio, trim);

-- Mailing.
CREATE TABLE IF NOT EXISTS suscriptores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE,
  nombre     TEXT,
  activo     INTEGER NOT NULL DEFAULT 1,
  creado_en  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS avisos_enviados (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  asunto         TEXT NOT NULL,
  cuerpo         TEXT NOT NULL,
  destinatarios  INTEGER NOT NULL DEFAULT 0,
  estado         TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | enviado | error
  detalle        TEXT,
  creado_en      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Log de importaciones de archivos xlsx (reemplaza el loop de AppScript).
CREATE TABLE IF NOT EXISTS importaciones (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  archivo       TEXT NOT NULL,
  anio          INTEGER NOT NULL,
  filas         INTEGER NOT NULL,
  creado_en     TEXT NOT NULL DEFAULT (datetime('now'))
);
