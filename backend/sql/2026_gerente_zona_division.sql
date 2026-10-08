-- FORD-AVON · Añade la dimensión DIVISIÓN a las asignaciones de Gerente de
-- Zona (gerente_zona_zona), tal como aparece en la hoja "Comercial" de la
-- plantilla oficial de usuarios (columnas PAIS/DIVISION/ZONA).
--
-- `division` es METADATA de la asignación (identifica/organiza el territorio
-- y resuelve el marcador especial ZONA="GV" al importar: "todas las zonas de
-- esta división"), NUNCA una dimensión de autorización: ScopeService sigue
-- resolviendo el alcance real exclusivamente por (pais, zona_id) vía
-- `paisZonaGrant`, sin leer esta columna. No se agrega a gestor_pais_zona
-- (el modelo no pide división para Gestor, solo país/zona).
--
-- Nullable y sin backfill: las filas existentes (creadas antes de este
-- cambio) simplemente quedan con division = NULL, sin perder su alcance real
-- (pais/zona), que no se toca. Idempotente: seguro de reaplicar.
alter table public.gerente_zona_zona
  add column if not exists division text;

comment on column public.gerente_zona_zona.division is
  'División organizacional de la asignación (p. ej. "CONACASTE", "CEIBA"), tal como llega de la plantilla de usuarios. Metadata de asignación/import — no participa en el cálculo de alcance de ScopeService.';
