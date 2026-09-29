-- Calendario propio (reemplaza a los Google Calendar del Sites): las fechas
-- pueden ser un plazo (desde -> fecha) y tienen un tipo para el color.
ALTER TABLE vencimientos ADD COLUMN tipo TEXT NOT NULL DEFAULT 'otro' CHECK (tipo IN ('trimestral', 'anual', 'otro'));
ALTER TABLE vencimientos ADD COLUMN desde TEXT; -- AAAA-MM-DD, inicio del plazo (NULL = solo el día del vencimiento)

-- Fechas que estaban en los calendarios "Entrega de formularios trimestrales"
-- y "Formularios Presupuesto 2026" del Sites (todas ya pasadas).
INSERT INTO vencimientos (titulo, descripcion, desde, fecha, tipo, alerta_dias, alerta_mismo_dia, creado_por) VALUES
  ('Presentación Formularios Descriptivos y de Metas Físicas (1, 4 y 5)', NULL, '2025-09-15', '2025-09-26', 'anual', 3, 1, 'google-calendar'),
  ('Presentación de Formularios Financieros y de Obras (7, 8, 9 y 11)', NULL, '2025-09-29', '2025-10-13', 'anual', 3, 1, 'google-calendar'),
  ('Entrega de formularios de metas', 'Formularios de programación física (F13), ejecución física (F18) y desvíos en la ejecución de metas (F19).', '2025-10-01', '2025-10-10', 'trimestral', 3, 1, 'google-calendar'),
  ('Entrega de formularios financieros', 'Programación financiera del compromiso (F17).', '2025-10-13', '2025-10-22', 'trimestral', 3, 1, 'google-calendar'),
  ('Entrega de Formularios Trimestrales 2025 y 2026', 'Formularios N° 18 y 19 del 4.º trimestre 2025 y Formularios N° 13 y 17 del 1.er trimestre 2026.', '2026-01-05', '2026-01-09', 'trimestral', 3, 1, 'google-calendar');
