-- Registro de las sincronizaciones con RAFAMOR SQL (src/lib/sync-rafamor-sql.ts).
-- La misma sincronización la crea si no existe, así que funciona aunque esta
-- migración no se haya aplicado en la base de producción.
--   estado: corriendo (si quedó así, la cortó Cloudflare) | ok | al_dia | tope | error
CREATE TABLE IF NOT EXISTS rafam_sync (
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
);
