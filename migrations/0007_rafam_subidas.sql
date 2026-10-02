-- Lotes de una subida manual de un reporte de RAFAM desde el panel
-- (src/pages/api/admin/rafam.ts): el navegador manda las partidas de a 250 y
-- un último pedido las pasa juntas a rafam_gastos. Se borran al confirmar, y
-- las de una subida que quedó por la mitad, al día siguiente.
-- La misma subida la crea si no existe, así que funciona aunque esta
-- migración no se haya aplicado en la base de producción.
CREATE TABLE IF NOT EXISTS rafam_subidas (
  subida    TEXT NOT NULL,
  lote      INTEGER NOT NULL,
  filas     TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (subida, lote)
);
