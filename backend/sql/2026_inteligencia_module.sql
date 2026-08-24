-- FORD-AVON · Centro de Inteligencia (idempotente, no destructivo).
-- Metas configurables y snapshot histórico mensual. Reutiliza profiles/permisos.

-- Metas: por ámbito GLOBAL / PAIS / PD, por período (YYYY-MM). Configurable a futuro.
create table if not exists public.metas (
  id uuid primary key default gen_random_uuid(),
  ambito text not null default 'GLOBAL',   -- GLOBAL | PAIS | PD
  clave text,                              -- país o PD según ámbito; null para GLOBAL
  periodo text not null,                   -- 'YYYY-MM'
  monto_meta numeric not null default 0,
  moneda text not null default 'USD',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_metas_ambito_clave_periodo on public.metas (ambito, coalesce(clave, ''), periodo);
create index if not exists idx_metas_periodo on public.metas (periodo);

-- Histórico mensual de asignación/recuperación (snapshot). Se puebla por proceso; puede estar vacío.
create table if not exists public.inteligencia_historico_mensual (
  id uuid primary key default gen_random_uuid(),
  periodo text not null,                   -- 'YYYY-MM'
  pais text,
  saldo_asignado_usd numeric not null default 0,
  saldo_actual_usd numeric not null default 0,
  recuperado_usd numeric not null default 0,
  cuentas int not null default 0,
  meta_usd numeric,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_hist_periodo_pais on public.inteligencia_historico_mensual (periodo, coalesce(pais, ''));
create index if not exists idx_hist_periodo on public.inteligencia_historico_mensual (periodo);
