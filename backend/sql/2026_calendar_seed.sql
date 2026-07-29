-- FORD-AVON · Carga inicial de eventos de calendario 2026 (idempotente).
-- Países incluidos: El Salvador, Nicaragua, República Dominicana (fechas verificadas).
-- Guatemala, Honduras y Panamá: PENDIENTES de verificación oficial (no se cargan aquí).
-- Identificación única: (pais, titulo, fecha_inicio, fecha_fin, tipo_evento_id).
-- Re-ejecutable sin duplicar. No modifica permisos, scope ni auth.

insert into public.calendar_events
  (titulo, descripcion, tipo_evento_id, fecha_inicio, fecha_fin, pais, zona_id, usuario_id, todo_el_dia, activo, creado_por)
select v.titulo, v.descripcion, et.id, v.fi::date, v.ff::date, v.pais, null, null, true, true, null
from (values
  -- ===== EL SALVADOR (Fuente: Ministerio de Hacienda de El Salvador, calendario de asuetos 2026) =====
  ('Semana Santa', 'Periodo de asueto. Fuente: Ministerio de Hacienda de El Salvador (calendario 2026). Revisar distinción sector público/privado.', 'FERIADO_ASUETO', '2026-03-30', '2026-04-06', 'El Salvador'),
  ('Día del Trabajo', 'Fuente: Ministerio de Hacienda de El Salvador.', 'FERIADO_ASUETO', '2026-05-01', '2026-05-01', 'El Salvador'),
  ('Día del Padre', 'Asueto del sector público. Fuente: Ministerio de Hacienda de El Salvador.', 'FERIADO_ASUETO', '2026-06-17', '2026-06-17', 'El Salvador'),
  ('Fiestas Patronales del Salvador del Mundo', 'Festividades de San Salvador. Fuente: Ministerio de Hacienda de El Salvador.', 'FERIADO_ASUETO', '2026-08-03', '2026-08-06', 'El Salvador'),
  ('Día de la Independencia', 'Fuente: Ministerio de Hacienda de El Salvador.', 'FERIADO_ASUETO', '2026-09-15', '2026-09-15', 'El Salvador'),
  ('Día de los Difuntos', 'Fuente: Ministerio de Hacienda de El Salvador.', 'FERIADO_ASUETO', '2026-11-02', '2026-11-02', 'El Salvador'),
  ('Fiestas Navideñas y Año Nuevo', 'Periodo navideño y de fin de año. Fuente: Ministerio de Hacienda de El Salvador.', 'VACACIONES', '2026-12-24', '2027-01-03', 'El Salvador'),

  -- ===== NICARAGUA (Fuente: legislación laboral vigente; Ley 1272 para fechas nacionales) =====
  ('Año Nuevo', 'Feriado nacional.', 'FERIADO_ASUETO', '2026-01-01', '2026-01-01', 'Nicaragua'),
  ('Nacimiento de Rubén Darío', 'Feriado nacional (Ley 1272).', 'FERIADO_ASUETO', '2026-01-18', '2026-01-18', 'Nicaragua'),
  ('Día Nacional de la Reconciliación y la Paz', 'Feriado nacional (Ley 1272).', 'FERIADO_ASUETO', '2026-02-02', '2026-02-02', 'Nicaragua'),
  ('Augusto C. Sandino', 'Feriado nacional (Ley 1272).', 'FERIADO_ASUETO', '2026-02-21', '2026-02-21', 'Nicaragua'),
  ('Jueves Santo', 'Feriado nacional.', 'FERIADO_ASUETO', '2026-04-02', '2026-04-02', 'Nicaragua'),
  ('Viernes Santo', 'Feriado nacional.', 'FERIADO_ASUETO', '2026-04-03', '2026-04-03', 'Nicaragua'),
  ('Día del Trabajo', 'Feriado nacional.', 'FERIADO_ASUETO', '2026-05-01', '2026-05-01', 'Nicaragua'),
  ('Día de la Madre', 'Feriado nacional.', 'FERIADO_ASUETO', '2026-05-30', '2026-05-30', 'Nicaragua'),
  ('Día de la Revolución', 'Feriado nacional.', 'FERIADO_ASUETO', '2026-07-19', '2026-07-19', 'Nicaragua'),
  ('Traída de Santo Domingo de Guzmán', 'Feriado LOCAL de Managua (no nacional).', 'FERIADO_LOCAL', '2026-08-01', '2026-08-01', 'Nicaragua'),
  ('Dejada de Santo Domingo de Guzmán', 'Feriado LOCAL de Managua (no nacional).', 'FERIADO_LOCAL', '2026-08-10', '2026-08-10', 'Nicaragua'),
  ('Batalla de San Jacinto', 'Feriado nacional.', 'FERIADO_ASUETO', '2026-09-14', '2026-09-14', 'Nicaragua'),
  ('Independencia de Centroamérica', 'Feriado nacional.', 'FERIADO_ASUETO', '2026-09-15', '2026-09-15', 'Nicaragua'),
  ('Día del comandante Carlos Fonseca', 'Feriado nacional (Ley 1272).', 'FERIADO_ASUETO', '2026-11-08', '2026-11-08', 'Nicaragua'),
  ('Inmaculada Concepción', 'Feriado nacional.', 'FERIADO_ASUETO', '2026-12-08', '2026-12-08', 'Nicaragua'),
  ('Navidad', 'Feriado nacional.', 'FERIADO_ASUETO', '2026-12-25', '2026-12-25', 'Nicaragua'),

  -- ===== REPÚBLICA DOMINICANA (Fuente: Ministerio de Trabajo; Ley 139-97 de traslado de feriados) =====
  ('Año Nuevo', 'Fuente: Ministerio de Trabajo RD.', 'FERIADO_ASUETO', '2026-01-01', '2026-01-01', 'República Dominicana'),
  ('Traslado de Santos Reyes', 'Trasladado; fecha original 06/01. Ley 139-97.', 'FERIADO_ASUETO', '2026-01-05', '2026-01-05', 'República Dominicana'),
  ('Nuestra Señora de la Altagracia', 'Fecha fija. Ministerio de Trabajo RD.', 'FERIADO_ASUETO', '2026-01-21', '2026-01-21', 'República Dominicana'),
  ('Natalicio de Juan Pablo Duarte', 'Ministerio de Trabajo RD (Ley 139-97).', 'FERIADO_ASUETO', '2026-01-26', '2026-01-26', 'República Dominicana'),
  ('Independencia Nacional', 'Fecha fija. Ministerio de Trabajo RD.', 'FERIADO_ASUETO', '2026-02-27', '2026-02-27', 'República Dominicana'),
  ('Viernes Santo', 'Fecha fija. Ministerio de Trabajo RD.', 'FERIADO_ASUETO', '2026-04-03', '2026-04-03', 'República Dominicana'),
  ('Traslado del Día del Trabajo', 'Trasladado al lunes; fecha original 01/05. Ley 139-97.', 'FERIADO_ASUETO', '2026-05-04', '2026-05-04', 'República Dominicana'),
  ('Corpus Christi', 'Fecha fija. Ministerio de Trabajo RD.', 'FERIADO_ASUETO', '2026-06-04', '2026-06-04', 'República Dominicana'),
  ('Restauración de la República', 'Ministerio de Trabajo RD.', 'FERIADO_ASUETO', '2026-08-16', '2026-08-16', 'República Dominicana'),
  ('Nuestra Señora de las Mercedes', 'Fecha fija. Ministerio de Trabajo RD.', 'FERIADO_ASUETO', '2026-09-24', '2026-09-24', 'República Dominicana'),
  ('Traslado del Día de la Constitución', 'Trasladado al lunes; fecha original 06/11. Ley 139-97.', 'FERIADO_ASUETO', '2026-11-09', '2026-11-09', 'República Dominicana'),
  ('Navidad', 'Fecha fija. Ministerio de Trabajo RD.', 'FERIADO_ASUETO', '2026-12-25', '2026-12-25', 'República Dominicana')
) as v(titulo, descripcion, tipo, fi, ff, pais)
join public.event_types et on et.codigo = v.tipo
where not exists (
  select 1 from public.calendar_events ce
  where ce.pais is not distinct from v.pais
    and ce.titulo = v.titulo
    and ce.fecha_inicio = v.fi::date
    and ce.fecha_fin = v.ff::date
    and ce.tipo_evento_id = et.id
);
