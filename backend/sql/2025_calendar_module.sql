-- FORD-AVON · Módulo Calendario — migración idempotente para Supabase/PostgreSQL.
-- Crea catálogos, tablas de eventos, permisos y su asignación a roles existentes.
-- No crea roles nuevos ni duplica catálogos existentes (zonas/profiles se reutilizan).

-- ==== Tipos de evento ====
create table if not exists public.event_types (
  id uuid primary key default gen_random_uuid(),
  codigo text unique not null,
  nombre text not null,
  descripcion text,
  color text,
  activo boolean not null default true
);

insert into public.event_types (codigo, nombre, color)
values
  ('FERIADO',    'Feriado',    '#EF4444'),
  ('VACACIONES', 'Vacaciones', '#3B82F6'),
  ('AUSENCIA',   'Ausencia',   '#F59E0B'),
  ('EVENTO',     'Evento',     '#22C55E'),
  ('ACTIVIDAD',  'Actividad',  '#7C3AED')
on conflict (codigo) do nothing;

-- ==== Eventos de calendario ====
create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descripcion text,
  tipo_evento_id uuid references public.event_types(id),
  fecha_inicio date not null,
  fecha_fin date not null,
  hora_inicio time,
  hora_fin time,
  pais text,
  zona_id uuid references public.zonas(id),
  usuario_id uuid references public.profiles(id) on delete cascade,
  todo_el_dia boolean not null default true,
  activo boolean not null default true,
  creado_por uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_calendar_events_fechas on public.calendar_events (fecha_inicio, fecha_fin);
create index if not exists idx_calendar_events_zona on public.calendar_events (zona_id);
create index if not exists idx_calendar_events_usuario on public.calendar_events (usuario_id);

-- ==== Permisos (reutiliza el sistema existente) ====
insert into public.permissions (clave, nombre)
values
  ('modulo.calendario',   'Módulo Calendario'),
  ('calendario.ver',      'Calendario: ver'),
  ('calendario.crear',    'Calendario: crear'),
  ('calendario.editar',   'Calendario: editar'),
  ('calendario.eliminar', 'Calendario: eliminar')
on conflict (clave) do nothing;

-- Ver + módulo para TODOS los roles.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where p.clave in ('modulo.calendario', 'calendario.ver')
  and not exists (
    select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_id = p.id
  );

-- Crear/editar/eliminar para roles administradores/gestión.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.clave in ('calendario.crear', 'calendario.editar', 'calendario.eliminar')
where r.clave in ('administrador', 'liderazgo', 'supervisor', 'gerente_zona')
  and not exists (
    select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_id = p.id
  );
