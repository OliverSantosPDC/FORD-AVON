-- FORD-AVON · Información corporativa + extensión de tipos de evento (idempotente).

-- ==== Tipos de evento adicionales (no duplica los existentes) ====
insert into public.event_types (codigo, nombre, color) values
  ('FERIADO_ASUETO',  'Feriado / Asueto', '#EF4444'),
  ('FERIADO_LOCAL',   'Feriado local',    '#F97316'),
  ('CUMPLEANOS',      'Cumpleaños',       '#EC4899'),
  ('REUNION',         'Reunión',          '#0EA5E9'),
  ('CAPACITACION',    'Capacitación',     '#14B8A6'),
  ('EVENTO_CORP',     'Evento corporativo','#22C55E'),
  ('CIERRE_OPERATIVO','Cierre operativo', '#64748B'),
  ('INICIO_CAMPANA',  'Inicio de campaña','#84CC16'),
  ('FIN_CAMPANA',     'Fin de campaña',   '#A855F7'),
  ('OTRO',            'Otro',             '#94A3B8')
on conflict (codigo) do nothing;

-- ==== Contenido corporativo (clave/valor, flexible) ====
create table if not exists public.info_content (
  clave text primary key,
  valor text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

insert into public.info_content (clave, valor) values
  ('empresa_nombre', ''), ('empresa_descripcion', ''),
  ('empresa_mision', ''), ('empresa_vision', ''),
  ('empresa_valores', ''), ('empresa_politicas', ''),
  ('cvd_titulo', 'Cobros Venta Directa'), ('cvd_filosofia', ''),
  ('cvd_descripcion', ''), ('cvd_principios', ''), ('cvd_objetivos', '')
on conflict (clave) do nothing;

-- ==== Enlaces corporativos ====
create table if not exists public.corporate_links (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text,
  url text not null,
  orden int not null default 0,
  activo boolean not null default true
);

insert into public.corporate_links (nombre, descripcion, url, orden)
select v.nombre, v.descripcion, v.url, v.orden from (values
  ('Beauty Connect', 'Sitio de consulta de saldos, datos de las representantes y gestión de la cartera.', 'http://mixmsapps10/Sac_Web/default.aspx?sessionTimeOut=1&msg=2', 1),
  ('HUB-AVON', 'Portal de capacitaciones e información sobre el modelo de negocio.', 'https://grupopdc460.github.io/hub-avon/index.html', 2),
  ('Issabel', 'Sistema utilizado por los gestores para realizar llamadas.', 'https://172.16.90.203/index.php', 3),
  ('MiniGame', 'Sitio donde actualmente se presenta la vigencia de cartera y saldos vencidos.', 'https://app.powerbi.com/view?r=eyJrIjoiNWU2YzViNjktZjM0OS00ZjcwLTk2YzMtMTBmZDFjZmM4ODc1IiwidCI6IjFiMzUyZDFmLTdiNDMtNDdlMi05MmQxLWIxYjZiNTYzYzAwNSIsImMiOjR9', 4)
) as v(nombre, descripcion, url, orden)
where not exists (select 1 from public.corporate_links cl where cl.url = v.url);

-- ==== Permisos de Información ====
insert into public.permissions (clave, descripcion, activo) values
  ('informacion.ver',    'Información: ver',    true),
  ('informacion.editar', 'Información: editar', true)
on conflict (clave) do nothing;

-- Ver para todos los roles.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r
cross join public.permissions p
where p.clave = 'informacion.ver'
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_id = p.id);

-- Editar para administrador y liderazgo.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r
join public.permissions p on p.clave = 'informacion.editar'
where r.clave in ('administrador', 'liderazgo')
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_id = p.id);
