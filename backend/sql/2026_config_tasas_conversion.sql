-- FORD-AVON · Tasas de Conversión (idempotente). No borra datos.
-- Fuente oficial de tasas de conversión de moneda para el Dashboard, administrada desde
-- Configuración > Tasas de Conversión (mismo patrón que config_catalogos/config_variables).

create table if not exists public.config_tasas_conversion (
  id uuid primary key default gen_random_uuid(),
  codigo text unique not null,
  nombre text not null,
  tasa numeric(18,6) not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
alter table public.config_tasas_conversion enable row level security;

-- Monedas administradas. Dólares y Balboas mantienen tasa fija de 1 (aplicado en backend).
insert into public.config_tasas_conversion (codigo, nombre, tasa) values
  ('USD', 'Dólares', 1),
  ('GTQ', 'Quetzales', 1),
  ('HNL', 'Lempiras', 1),
  ('NIO', 'Córdobas', 1),
  ('PAB', 'Balboas', 1),
  ('DOP', 'Pesos RD', 1)
on conflict (codigo) do nothing;
