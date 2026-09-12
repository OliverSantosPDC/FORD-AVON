-- FORD-AVON · Grupos y Niveles (jerarquía formal de roles + alcance).
-- Idempotente, no destructivo: no se elimina ninguna tabla/columna existente.
-- Reutiliza roles/profiles/gestores/supervisor_gestor/gerente_zona_zona/zonas.

-- 1) Nivel numérico oficial de cada rol (1=Administrador ... 5=Gerente de zona).
--    "Zona" (nivel 6 en la jerarquía funcional) NO es un rol de usuario: es la
--    entidad terminal de cartera (pais+zona), por eso no se agrega como fila de `roles`.
alter table public.roles add column if not exists nivel int;
update public.roles set nivel = 1 where clave = 'administrador' and nivel is null;
update public.roles set nivel = 2 where clave = 'liderazgo' and nivel is null;
update public.roles set nivel = 3 where clave = 'supervisor' and nivel is null;
update public.roles set nivel = 4 where clave = 'gestor' and nivel is null;
update public.roles set nivel = 5 where clave = 'gerente_zona' and nivel is null;

-- 2) LIDERAZGO -> SUPERVISOR (no existía ninguna relación explícita: liderazgo
--    era un rol global sin dependencias). Mismo patrón que supervisor_gestor.
create table if not exists public.liderazgo_supervisor (
  id uuid primary key default gen_random_uuid(),
  liderazgo_id uuid not null references public.profiles(id) on delete cascade,
  supervisor_id uuid not null references public.profiles(id) on delete cascade,
  fecha_inicio date not null default current_date,
  fecha_fin date,
  activo boolean not null default true
);
create index if not exists idx_liderazgo_supervisor_liderazgo on public.liderazgo_supervisor (liderazgo_id);
create index if not exists idx_liderazgo_supervisor_supervisor on public.liderazgo_supervisor (supervisor_id);
alter table public.liderazgo_supervisor enable row level security;

-- 3) GESTOR -> PAÍS/ZONA explícitos (narrowing ADICIONAL sobre el matching por
--    nombre_cartera ya existente; opcional: si un gestor no tiene filas aquí, su
--    alcance sigue siendo exactamente el de hoy — ningún usuario existente pierde
--    acceso por esta migración). Se guarda también `pais` junto al `zona_id`
--    porque una misma zona (código) puede existir en más de un país en `cartera`
--    (verificado: zonas como "107"/"110"/"117" se repiten entre países), por lo
--    que `zona_id` por sí solo es ambiguo.
create table if not exists public.gestor_pais_zona (
  id uuid primary key default gen_random_uuid(),
  gestor_id uuid not null references public.gestores(id) on delete cascade,
  zona_id uuid not null references public.zonas(id) on delete cascade,
  pais text not null,
  fecha_inicio date not null default current_date,
  fecha_fin date,
  activo boolean not null default true
);
create index if not exists idx_gestor_pais_zona_gestor on public.gestor_pais_zona (gestor_id);
alter table public.gestor_pais_zona enable row level security;

-- 4) GERENTE DE ZONA -> se agrega `pais` a la relación ya existente
--    `gerente_zona_zona` (antes solo zona_id, ambiguo entre países). La tabla
--    está vacía en producción, por lo que agregar la columna es seguro y no
--    requiere backfill.
alter table public.gerente_zona_zona add column if not exists pais text;

comment on column public.gerente_zona_zona.pais is 'País de la zona asignada (una misma zona/código puede repetirse en más de un país en cartera; sin este campo la asignación es ambigua).';
comment on table public.liderazgo_supervisor is 'Nivel 2 (Liderazgo) -> Nivel 3 (Supervisor). Mismo patrón que supervisor_gestor.';
comment on table public.gestor_pais_zona is 'Nivel 4 (Gestor) -> País/Zona explícitos. Narrowing adicional sobre gestores.nombre_cartera; vacío = sin restricción adicional (comportamiento actual preservado).';
