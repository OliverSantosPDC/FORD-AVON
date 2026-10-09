-- FORD-AVON · Añade los campos de la plantilla de usuarios que faltaban en
-- `profiles`: CONTACTO, PAIS (identidad de la persona) y NOMBRE COMPLETO.
--
-- Hasta ahora, la importación masiva (backend/src/services/UsuariosService.ts,
-- aplicarImportacionUsuarios) LEÍA estas tres columnas del archivo .xlsx pero
-- nunca las persistía en ningún lado: PAIS solo se usaba para VALIDAR que
-- coincidiera con un país real de cartera, y CONTACTO/NOMBRE COMPLETO se
-- descartaban por completo tras parsear la fila. Tampoco existía ningún campo
-- en el formulario de edición manual (Configuración > Usuarios) para capturar
-- estos tres datos.
--
-- Son METADATA de identidad de la persona (como nombre/apellido/email),
-- NUNCA parte del cálculo de alcance de ScopeService — igual que `division`
-- en gerente_zona_zona (ver 2026_gerente_zona_division.sql), estas columnas
-- no se leen en ningún punto de ScopeService/ScopeFilter.
--
-- `pais` aquí es el país de IDENTIDAD de la persona (de dónde es), distinto
-- de los países de TERRITORIO/alcance (gestor_pais_zona.pais,
-- gerente_zona_zona.pais), que siguen siendo la única fuente de autorización.
--
-- Nullable, sin backfill: los perfiles existentes quedan con estos tres
-- campos en NULL hasta que se completen manualmente o se reimporte el
-- archivo. Idempotente: seguro de reaplicar.
alter table public.profiles
  add column if not exists contacto text,
  add column if not exists pais text,
  add column if not exists nombre_completo text;

comment on column public.profiles.contacto is
  'Teléfono/contacto de la persona (columna CONTACTO de la plantilla de usuarios). Identidad, nunca alcance.';
comment on column public.profiles.pais is
  'País de identidad de la persona (columna PAIS de la plantilla de usuarios) — distinto del país de territorio/alcance (gestor_pais_zona.pais, gerente_zona_zona.pais).';
comment on column public.profiles.nombre_completo is
  'Nombre completo (columna NOMBRE COMPLETO de la plantilla de usuarios). Se sincroniza automáticamente con nombre+apellido salvo que se edite manualmente.';
