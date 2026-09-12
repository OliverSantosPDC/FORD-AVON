-- FORD-AVON · Metas (configuración global), mismo patrón que config_tasas_conversion.
-- Reutiliza la tabla `metas` ya existente (vacía en producción): se agregan
-- columnas para soportar una ÚNICA configuración global (% o monto, mutuamente
-- excluyentes) en lugar de metas manuales por país/gestor/PD.
-- Idempotente, no destructivo: no se elimina ni renombra ninguna columna existente.

alter table public.metas
  add column if not exists tipo text not null default 'MONTO' check (tipo in ('PORCENTAJE', 'MONTO')),
  add column if not exists porcentaje_meta numeric(12, 8),
  add column if not exists activo boolean not null default true,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

comment on column public.metas.tipo is 'Fuente activa de la configuración: PORCENTAJE o MONTO (mutuamente excluyentes).';
comment on column public.metas.porcentaje_meta is 'Meta % configurada (fracción, ej. 0.9371) cuando tipo=PORCENTAJE. Se recalcula dinámicamente cuando tipo=MONTO.';
comment on column public.metas.monto_meta is 'Meta MONTO USD configurada cuando tipo=MONTO. Se recalcula dinámicamente cuando tipo=PORCENTAJE.';

-- Misma protección que config_tasas_conversion: RLS habilitado, sin políticas
-- (el acceso real ocurre siempre vía el backend con la Service Role Key).
alter table public.metas enable row level security;

-- La configuración global vigente se guarda como la única fila con
-- ambito='GLOBAL', clave=null, periodo='GLOBAL' (sentinela fijo, no calendario),
-- aprovechando el índice único ya existente uq_metas_ambito_clave_periodo para
-- garantizar que solo pueda existir una.
