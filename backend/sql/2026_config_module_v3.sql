-- FORD-AVON · Configuración v3 (idempotente). Historial de versiones de plantillas.
create table if not exists public.config_plantillas_versiones (
  id uuid primary key default gen_random_uuid(),
  clave text not null,
  url text not null,
  version int not null,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_config_plantillas_versiones_clave on public.config_plantillas_versiones (clave);
