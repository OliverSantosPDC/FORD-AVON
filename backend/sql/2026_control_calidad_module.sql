-- FORD-AVON · Control Operativo · Calidad de Gestión (idempotente, no destructivo).
-- Reutiliza profiles/auditoría/permisos. No modifica tablas existentes.
create table if not exists public.calidad_gestion_evaluaciones (
  id uuid primary key default gen_random_uuid(),
  gestor_id uuid references public.profiles(id) on delete set null,
  gestor_nombre text,
  pais text,
  zona text,
  cuenta text,
  tipificacion text,
  evaluador_id uuid references public.profiles(id) on delete set null,
  criterios jsonb not null default '{}'::jsonb,       -- { item: 0|1 }
  penalizaciones jsonb not null default '{}'::jsonb,  -- { item: puntos }
  nota numeric(5,2) not null default 0,               -- 0..100
  observaciones text,
  created_at timestamptz not null default now()
);
create index if not exists idx_calidad_gestor on public.calidad_gestion_evaluaciones (gestor_id);
create index if not exists idx_calidad_pais on public.calidad_gestion_evaluaciones (pais);
create index if not exists idx_calidad_zona on public.calidad_gestion_evaluaciones (zona);
create index if not exists idx_calidad_created_at on public.calidad_gestion_evaluaciones (created_at desc);

-- Permisos (patrón existente). control_operativo.calidad.ver / .editar
insert into public.permissions (clave, descripcion, activo) values
  ('control_operativo.calidad.ver',    'Control Operativo · Calidad: ver',    true),
  ('control_operativo.calidad.editar', 'Control Operativo · Calidad: editar', true)
on conflict (clave) do nothing;

-- Acceso: administrador, liderazgo, supervisor, gerente_zona (NO gestor).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r
join public.permissions p on p.clave in ('control_operativo.calidad.ver','control_operativo.calidad.editar')
where r.clave in ('administrador','liderazgo','supervisor','gerente_zona')
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_id = p.id);
