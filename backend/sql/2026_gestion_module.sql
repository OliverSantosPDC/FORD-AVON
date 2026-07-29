-- FORD-AVON · Módulo Gestión (idempotente). No modifica tablas existentes.
-- Tablas nuevas con prefijo `gestion_` para no colisionar con `gestiones` existente.
-- La cuenta se referencia por `codigo` (texto) porque `cartera` se recarga completa.

create table if not exists public.gestion_log (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  tipificacion text not null,
  comentario text,
  estado text default 'REGISTRADA',
  gestor_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_gestion_log_codigo on public.gestion_log (codigo);

create table if not exists public.gestion_promesas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  fecha_promesa date not null,
  monto numeric,
  moneda text,
  comentario text,
  estado text default 'VIGENTE',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_gestion_promesas_codigo on public.gestion_promesas (codigo);

create table if not exists public.gestion_adjuntos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  tipo_documento text,
  nombre text not null,
  url text not null,
  subido_por uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_gestion_adjuntos_codigo on public.gestion_adjuntos (codigo);

create table if not exists public.gestion_cartas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  tipo text not null,
  estado text not null default 'PENDIENTE_APROBACION',
  comentario text,
  gestor_id uuid references public.profiles(id),
  aprobado_por uuid references public.profiles(id),
  comentario_aprobacion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_gestion_cartas_codigo on public.gestion_cartas (codigo);
create index if not exists idx_gestion_cartas_gestor on public.gestion_cartas (gestor_id);
create index if not exists idx_gestion_cartas_estado on public.gestion_cartas (estado);

-- Bucket de Storage para adjuntos (privado).
insert into storage.buckets (id, name, public)
values ('gestion-adjuntos', 'gestion-adjuntos', false)
on conflict (id) do nothing;

-- ==== Permisos ====
insert into public.permissions (clave, descripcion, activo) values
  ('modulo.gestion',          'Módulo Gestión',                 true),
  ('gestion.ver',             'Gestión: ver',                    true),
  ('gestion.gestionar',       'Gestión: tipificar/gestionar',    true),
  ('gestion.promesa.crear',   'Gestión: crear promesa',          true),
  ('gestion.promesa.editar',  'Gestión: editar promesa',         true),
  ('gestion.carta.crear',     'Gestión: crear carta',            true),
  ('gestion.carta.aprobar',   'Gestión: aprobar/rechazar carta', true),
  ('gestion.adjunto.subir',   'Gestión: subir adjuntos',         true)
on conflict (clave) do nothing;

-- Ver para todos los roles (el scope acota los datos).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r
cross join public.permissions p
where p.clave in ('modulo.gestion', 'gestion.ver')
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_id = p.id);

-- Gestionar / promesas / cartas / adjuntos para operativos (no gestor-solo-lectura queda cubierto).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r
join public.permissions p on p.clave in ('gestion.gestionar','gestion.promesa.crear','gestion.promesa.editar','gestion.carta.crear','gestion.adjunto.subir')
where r.clave in ('administrador','liderazgo','supervisor','gerente_zona','gestor')
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_id = p.id);

-- Aprobar cartas: administrador, liderazgo, supervisor.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r
join public.permissions p on p.clave = 'gestion.carta.aprobar'
where r.clave in ('administrador','liderazgo','supervisor')
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_id = p.id);
