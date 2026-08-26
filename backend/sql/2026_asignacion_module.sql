-- FORD-AVON · Control Operativo · Asignación de cartera (idempotente, no destructivo).
-- Registra asignaciones automáticas y reasignaciones manuales como historial auditable.
-- La cartera se recarga completa desde el ERP; por eso la asignación se persiste aquí
-- (fuente de verdad de la última asignación por cuenta + historial), sin mutar la cartera.

create table if not exists public.asignaciones (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,                       -- cuenta (código de cartera)
  gestor_anterior text,
  gestor_nuevo text not null,
  tipo text not null default 'AUTO',          -- AUTO | MANUAL
  motivo text,
  regla jsonb,                                -- configuración usada (para AUTO)
  pais text,
  asignado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_asignaciones_codigo on public.asignaciones (codigo);
create index if not exists idx_asignaciones_created_at on public.asignaciones (created_at desc);
create index if not exists idx_asignaciones_tipo on public.asignaciones (tipo);
create index if not exists idx_asignaciones_pais on public.asignaciones (pais);

-- Permisos (patrón existente): lectura/simulación/aplicación/reasignación/exportación separados.
insert into public.permissions (clave, descripcion, activo) values
  ('control_operativo.asignacion.ver',            'Control Operativo · Asignación: ver',            true),
  ('control_operativo.asignacion.simular',        'Control Operativo · Asignación: simular',        true),
  ('control_operativo.asignacion.aplicar',        'Control Operativo · Asignación: aplicar',        true),
  ('control_operativo.reasignacion',              'Control Operativo · Reasignación manual',        true),
  ('control_operativo.base_marcacion.exportar',   'Control Operativo · Base de marcación: exportar', true)
on conflict (clave) do nothing;

-- ver / simular / base de marcación: roles operativos.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r
join public.permissions p on p.clave in ('control_operativo.asignacion.ver','control_operativo.asignacion.simular','control_operativo.base_marcacion.exportar')
where r.clave in ('administrador','liderazgo','supervisor','gerente_zona')
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_id = p.id);

-- aplicar / reasignar: solo administración y liderazgo (operación sensible).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r
join public.permissions p on p.clave in ('control_operativo.asignacion.aplicar','control_operativo.reasignacion')
where r.clave in ('administrador','liderazgo')
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_id = p.id);
