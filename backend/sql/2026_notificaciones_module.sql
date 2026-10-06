-- FORD-AVON · Notificaciones (campana del Header).
-- Idempotente, no destructivo: no se elimina ninguna tabla/columna existente.
-- Auditoría previa (sesión Claude, 2026-10-06): no existía NINGUNA tabla ni
-- implementación backend de notificaciones — solo un icono de campana
-- decorativo y hardcodeado en frontend/src/layouts/RootLayout.tsx
-- (badgeContent={3} fijo, sin onClick, sin fetch). Esta es la tabla nueva.

create table if not exists public.notificaciones (
  id uuid primary key default gen_random_uuid(),
  usuario_destinatario_id uuid not null references public.profiles(id) on delete cascade,
  -- Quien causó el evento (el Gestor que escaló, el Supervisor que
  -- autorizó, el administrador que cambió la contraseña) — nunca el mismo
  -- usuario que el destinatario salvo que el propio evento lo permita.
  actor_id uuid references public.profiles(id) on delete set null,
  tipo text not null,
  titulo text not null,
  mensaje text not null,
  leida boolean not null default false,
  fecha_creacion timestamptz not null default now(),
  fecha_lectura timestamptz,
  -- Para poder navegar al recurso real sin texto/IDs hardcodeados en el
  -- frontend (p. ej. referencia_tipo='gestion_cartas', referencia_id=<uuid
  -- de la carta>); ambos opcionales porque no todo evento tiene un recurso
  -- navegable (ej. cambio de contraseña).
  referencia_tipo text,
  referencia_id text
);

comment on table public.notificaciones is 'Notificaciones por usuario (campana del Header). Backend-only vía service role; sin RLS con policies (mismo patrón que el resto del esquema) porque ningún cliente consulta esta tabla directamente.';
comment on column public.notificaciones.referencia_id is 'Id del recurso referido (p. ej. gestion_cartas.id) como texto, para no acoplar el tipo de columna al recurso referido.';

-- Consulta más frecuente: "mis notificaciones, no leídas primero, más
-- recientes primero" — exactamente el orden que pide el listado.
create index if not exists idx_notificaciones_destinatario
  on public.notificaciones (usuario_destinatario_id, leida, fecha_creacion desc);

-- Deduplicación: el mismo evento (tipo + referencia) nunca genera dos
-- notificaciones para el mismo destinatario, aunque el endpoint que lo
-- dispara se llame dos veces (reintento de red, doble clic, etc.) — ver
-- NotificacionesService.crearNotificacion (ON CONFLICT DO NOTHING). Los
-- eventos sin referencia_id (ninguno de los implementados hoy) quedan
-- fuera de esta unicidad a propósito (índice parcial).
create unique index if not exists uq_notificaciones_evento
  on public.notificaciones (usuario_destinatario_id, tipo, referencia_tipo, referencia_id)
  where referencia_id is not null;

alter table public.notificaciones enable row level security;
