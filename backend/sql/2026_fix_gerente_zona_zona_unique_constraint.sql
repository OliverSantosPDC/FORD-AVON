-- FORD-AVON · Corrige la unicidad de `gerente_zona_zona` (bug real encontrado
-- en producción, project vuazzailuqgbjnnbdtrg — ver auditoría Excel vs
-- Supabase de REPUBLICA DOMINICANA).
--
-- El índice `ux_gerente_zona_activo` existía en Supabase (creado fuera de
-- este repositorio, sin migración versionada) como:
--   CREATE UNIQUE INDEX ux_gerente_zona_activo
--     ON gerente_zona_zona (zona_id) WHERE (activo = true);
-- es decir, a lo sumo UN Gerente de zona activo por código de Zona en TODO
-- el sistema, ignorando el país. Como un mismo código de Zona se repite en
-- países distintos (ej. Zona "107" existe en GUATEMALA y en REPUBLICA
-- DOMINICANA — ver `idPaisZonaDe` en usuariosExcel.ts), esto bloqueaba
-- silenciosamente cualquier INSERT de un Gerente para una Zona de REPUBLICA
-- DOMINICANA cuyo código ya estuviera "tomado" por un Gerente activo de otro
-- país, sin generar ningún error visible en la carga masiva de usuarios (el
-- INSERT era rechazado por Postgres antes de llegar a la lógica de negocio
-- de `UsuariosService`). Resultado confirmado: 19 relaciones GERENTE_PAIS_ZONA
-- de REPUBLICA DOMINICANA presentes en la plantilla oficial de usuarios nunca
-- llegaron a existir en `gerente_zona_zona`, mientras que `gestor_pais_zona`
-- (sin esta restricción) sí las tenía completas.
--
-- Corrección: la unicidad debe ser por el PAR (zona_id, pais), igual que en
-- el resto del modelo (gerente_zona_zona.pais / gestor_pais_zona.pais).
-- Idempotente: seguro de reaplicar.
drop index if exists public.ux_gerente_zona_activo;
create unique index if not exists ux_gerente_zona_pais_activo
  on public.gerente_zona_zona (zona_id, pais)
  where (activo = true);
