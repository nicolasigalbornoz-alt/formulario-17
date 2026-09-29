-- Avisos y fechas que carga el administrador (Panel -> Avisos y fechas).
--
-- avisos: se muestran en el inicio y en la página del F17 mientras estén
-- vigentes; opcionalmente se mandan por mail a la lista de difusión en el
-- momento de publicarlos.
--
-- vencimientos: fechas de entrega (ej. "F17 del IV trimestre"). Se muestran en
-- el inicio y en el F17, y mandan alertas automáticas por mail a la lista de
-- difusión: unos días antes y el mismo día (tarea programada diaria del
-- Worker, ver worker/index.mjs). vencimientos_alertas evita repetirlas.

CREATE TABLE IF NOT EXISTS avisos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo        TEXT NOT NULL,
  texto         TEXT NOT NULL,
  desde         TEXT NOT NULL,     -- AAAA-MM-DD: se muestra a partir de este día
  hasta         TEXT,              -- AAAA-MM-DD: último día que se muestra (NULL = sin fin)
  importante    INTEGER NOT NULL DEFAULT 0,
  creado_por    TEXT,
  creado_en     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vencimientos (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo           TEXT NOT NULL,
  descripcion      TEXT,
  fecha            TEXT NOT NULL,             -- AAAA-MM-DD
  alerta_dias      INTEGER NOT NULL DEFAULT 3, -- alerta anticipada: días antes (0 = no)
  alerta_mismo_dia INTEGER NOT NULL DEFAULT 1,
  creado_por       TEXT,
  creado_en        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vencimientos_fecha ON vencimientos (fecha);

CREATE TABLE IF NOT EXISTS vencimientos_alertas (
  vencimiento_id INTEGER NOT NULL REFERENCES vencimientos (id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL CHECK (tipo IN ('anticipada', 'mismo_dia')),
  destinatarios  INTEGER NOT NULL DEFAULT 0,
  enviados       INTEGER NOT NULL DEFAULT 0,
  detalle        TEXT,
  enviado_en     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (vencimiento_id, tipo)
);
