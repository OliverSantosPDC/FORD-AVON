-- FORD-AVON · Módulo Configuración (idempotente). No borra datos.

create table if not exists public.config_general (
  clave text primary key,
  valor text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.config_general (clave, valor) values
  ('nombre_sistema', 'FORD-AVON'), ('descripcion_sistema', ''), ('nombre_empresa', ''),
  ('logo_principal', ''), ('logo_login', ''), ('logo_reducido', ''), ('favicon', ''),
  ('zona_horaria', 'America/El_Salvador'), ('idioma', 'es'),
  ('fecha_instalacion', ''), ('version', '1.0.0'), ('ultima_actualizacion', ''),
  ('tema', 'claro'), ('densidad_tabla', 'normal'), ('orden_modulos', ''),
  ('color_sidebar', '#0F172A'), ('color_encabezado', '#1E3A8A'), ('color_boton', '#1E3A8A'), ('color_kpi', '#E6007E')
on conflict (clave) do nothing;

create table if not exists public.config_catalogos (
  id uuid primary key default gen_random_uuid(),
  catalogo text not null,
  codigo text,
  nombre text not null,
  activo boolean not null default true,
  orden int not null default 0
);
create index if not exists idx_config_catalogos_cat on public.config_catalogos (catalogo);

create table if not exists public.config_variables (
  id uuid primary key default gen_random_uuid(),
  nombre text unique not null,
  valor text,
  descripcion text,
  activo boolean not null default true
);
insert into public.config_variables (nombre, valor, descripcion) values
  ('MAX_EXPORT_ROWS', '100000', 'Máximo de filas exportables'),
  ('DIAS_PROMESA', '7', 'Días por defecto para promesa'),
  ('MAX_ADJUNTOS', '10', 'Máximo de adjuntos por cuenta'),
  ('TAMANIO_MAXIMO_ARCHIVO', '10', 'Tamaño máximo de archivo (MB)'),
  ('EMAIL_SOPORTE', '', 'Correo de soporte'),
  ('COLOR_KPI_META', '#E6007E', 'Color de KPI de meta'),
  ('FORMATO_FECHA', 'YYYY-MM-DD', 'Formato de fecha'),
  ('FORMATO_MONEDA', 'es', 'Locale de moneda'),
  ('EDAD_MINIMA_PROMESA', '18', 'Edad mínima para promesa')
on conflict (nombre) do nothing;

create table if not exists public.config_plantillas (
  id uuid primary key default gen_random_uuid(),
  clave text unique not null,
  nombre text not null,
  url text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.config_plantillas (clave, nombre) values
  ('carta_pd0', 'Carta PD0'), ('carta_pd1', 'Carta PD1'), ('carta_pd2', 'Carta PD2'),
  ('carta_pd3', 'Carta PD3'), ('carta_pd4', 'Carta PD4+'),
  ('acuerdo_pago', 'Formato Acuerdo de Pago'),
  ('escal_supervisor', 'Escalamiento Supervisor'), ('escal_gerente', 'Escalamiento Gerente'), ('escal_juridico', 'Escalamiento Jurídico'),
  ('plantilla_calendario', 'Calendario Masivo'), ('plantilla_usuarios', 'Usuarios Masivos'),
  ('plantilla_cartera', 'Cartera'), ('plantilla_gestion', 'Gestión Masiva')
on conflict (clave) do nothing;

-- Catálogos iniciales
insert into public.config_catalogos (catalogo, nombre, orden)
select c.catalogo, c.nombre, c.orden from (values
  ('tipificaciones','PROMESA DE PAGO',1),('tipificaciones','PAGO POR REFLEJAR',2),('tipificaciones','SEGUIMIENTO A PROMESA',3),
  ('tipificaciones','RECADO',4),('tipificaciones','NEGATIVA DE PAGO',5),('tipificaciones','ABANDONO DE LLAMADA',6),
  ('tipificaciones','NO RECONOCE LA DEUDA',7),('tipificaciones','ENTREGO DINERO A LA EMPRESARIA',8),('tipificaciones','AMENAZA DE DEMANDA',9),('tipificaciones','Sin Resultado',10),
  ('tipos_contacto','Representante',1),('tipos_contacto','Gerente de Zona',2),('tipos_contacto','Tercero',3),
  ('canales','Llamada',1),('canales','SMS',2),('canales','WhatsApp',3),('canales','Correo',4),
  ('estados_promesa','PENDIENTE',1),('estados_promesa','CUMPLIDA',2),('estados_promesa','INCUMPLIDA',3),('estados_promesa','CANCELADA',4),
  ('estados_carta','BORRADOR',1),('estados_carta','PENDIENTE_APROBACION',2),('estados_carta','APROBADA',3),('estados_carta','RECHAZADA',4),
  ('tipos_adjunto','Carta recibida por la representante',1),('tipos_adjunto','Boleta de pago',2),('tipos_adjunto','Acuerdo de pago',3),('tipos_adjunto','Otro documento',4),
  ('tipos_evento','FERIADO_ASUETO',1),('tipos_evento','FERIADO_LOCAL',2),('tipos_evento','VACACIONES',3),('tipos_evento','AUSENCIA',4),('tipos_evento','EVENTO',5),('tipos_evento','ACTIVIDAD',6),('tipos_evento','OTRO',7)
) as c(catalogo, nombre, orden)
where not exists (select 1 from public.config_catalogos cc where cc.catalogo = c.catalogo and cc.nombre = c.nombre);

-- Bucket de assets de configuración (privado).
insert into storage.buckets (id, name, public) values ('config-assets', 'config-assets', false)
on conflict (id) do nothing;

-- Permisos
insert into public.permissions (clave, descripcion, activo) values
  ('configuracion.ver', 'Configuración: ver', true),
  ('configuracion.editar', 'Configuración: editar', true)
on conflict (clave) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r
join public.permissions p on p.clave in ('modulo.configuracion','configuracion.ver','configuracion.editar')
where r.clave in ('administrador','liderazgo')
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_id = p.id);
