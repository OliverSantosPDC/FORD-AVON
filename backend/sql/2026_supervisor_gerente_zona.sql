-- FORD-AVON · Supervisor -> Gerente de zona (Nivel 3 -> Nivel 5, rama paralela a
-- Supervisor -> Gestor). Requerida por la jerarquía oficial de Grupos y Niveles:
-- "NIVEL 3 Supervisor -> Gestores -> Gerentes de zona". No existía ninguna
-- relación explícita entre Supervisor y Gerente de zona hasta ahora. Mismo
-- patrón que supervisor_gestor/liderazgo_supervisor.
create table if not exists public.supervisor_gerente_zona (
  id uuid primary key default gen_random_uuid(),
  supervisor_id uuid not null references public.profiles(id) on delete cascade,
  gerente_zona_id uuid not null references public.profiles(id) on delete cascade,
  fecha_inicio date not null default current_date,
  fecha_fin date,
  activo boolean not null default true
);
create index if not exists idx_supervisor_gerente_zona_supervisor on public.supervisor_gerente_zona (supervisor_id);
create index if not exists idx_supervisor_gerente_zona_gerente on public.supervisor_gerente_zona (gerente_zona_id);
alter table public.supervisor_gerente_zona enable row level security;

comment on table public.supervisor_gerente_zona is 'Nivel 3 (Supervisor) -> Nivel 5 (Gerente de zona). Rama paralela a supervisor_gestor.';
