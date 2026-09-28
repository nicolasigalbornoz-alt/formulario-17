-- Fuente de datos del Formulario 17: la ejecución de gastos de RAFAM, con la
-- misma forma que la tabla "Gastos" de la base mensual de RAFAMOR (un
-- reporte "Estado de Ejecución del Presupuesto de Gastos" por mes), más la
-- categoría programática separada del programa.
--
-- Por cada (anio, mes) se guarda UNA sola foto: la del último reporte
-- cargado de ese mes. Un reporte del mes en curso ("Del 01/09 al 24/09")
-- se reemplaza entero cuando llega uno más nuevo, así el compromiso del mes
-- nunca se cuenta dos veces.
--
--   vigente     -> saldo del crédito vigente a la fecha `hasta` del reporte
--   compromiso  -> lo comprometido dentro del mes (movimiento, no acumulado)
--
-- El F17 (src/lib/f17.ts) toma el crédito vigente de la foto más reciente
-- del año ("al último día disponible de información") y suma el compromiso
-- por trimestre, partida, fuente y programa/categoría.
--
-- Las tablas del modelo anterior (ejecucion, programas, partidas,
-- jurisdicciones, fuentes, importaciones), que se cargaban desde las
-- planillas "registros f17", quedan sin uso.

CREATE TABLE IF NOT EXISTS rafam_gastos (
  anio                INTEGER NOT NULL,
  mes                 INTEGER NOT NULL,
  jurisdiccion_codigo TEXT NOT NULL,
  jurisdiccion        TEXT,
  programa_codigo     TEXT NOT NULL,  -- "01"
  programa            TEXT,
  catprog_codigo      TEXT NOT NULL,  -- "01.18.00" (o "17.00.00" si el programa no tiene actividades)
  catprog             TEXT,
  fuente_codigo       TEXT NOT NULL,
  fuente              TEXT,
  inciso              TEXT,
  partida_codigo      TEXT NOT NULL,
  partida             TEXT,
  aprobado            REAL NOT NULL DEFAULT 0,
  modificaciones      REAL NOT NULL DEFAULT 0,
  vigente             REAL NOT NULL DEFAULT 0,
  preventivo          REAL NOT NULL DEFAULT 0,
  compromiso          REAL NOT NULL DEFAULT 0,
  devengado           REAL NOT NULL DEFAULT 0,
  pagado              REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (anio, mes, jurisdiccion_codigo, catprog_codigo, fuente_codigo, partida_codigo)
);

CREATE INDEX IF NOT EXISTS idx_rafam_gastos_programa
  ON rafam_gastos (anio, jurisdiccion_codigo, programa_codigo, catprog_codigo, fuente_codigo);

-- Qué reporte quedó cargado para cada mes (la "foto" vigente de ese mes).
CREATE TABLE IF NOT EXISTS rafam_cortes (
  anio          INTEGER NOT NULL,
  mes           INTEGER NOT NULL,
  desde         TEXT NOT NULL,
  hasta         TEXT NOT NULL,
  mes_completo  INTEGER NOT NULL,
  filas         INTEGER NOT NULL,
  archivo       TEXT,
  origen        TEXT NOT NULL DEFAULT 'sync',  -- sync (RAFAMOR) | panel
  cargado_en    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (anio, mes)
);

-- Lista de difusión: mismos datos que pedía el formulario de inscripción de
-- Google que usaba el Sites.
ALTER TABLE suscriptores ADD COLUMN secretaria TEXT;
ALTER TABLE suscriptores ADD COLUMN cargo TEXT;
ALTER TABLE suscriptores ADD COLUMN programas TEXT;
ALTER TABLE suscriptores ADD COLUMN telefono TEXT;
ALTER TABLE suscriptores ADD COLUMN email_alternativo TEXT;
ALTER TABLE suscriptores ADD COLUMN actualizado_en TEXT;

ALTER TABLE avisos_enviados ADD COLUMN enviados INTEGER NOT NULL DEFAULT 0;
