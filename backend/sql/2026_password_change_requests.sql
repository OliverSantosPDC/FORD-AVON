-- FORD-AVON · Solicitudes de cambio de contraseña (idempotente, no destructivo).
-- Reutiliza profiles/auditoría/permiso usuarios.administrar_global. No almacena contraseñas.
create table if not exists public.password_change_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  usuario_id uuid references public.profiles(id) on delete set null,
  estado text not null default 'PENDIENTE',            -- PENDIENTE | APROBADA | RECHAZADA | COMPLETADA
  motivo text,
  observaciones text,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists idx_pcr_estado on public.password_change_requests (estado);
create index if not exists idx_pcr_created_at on public.password_change_requests (created_at desc);
create index if not exists idx_pcr_usuario on public.password_change_requests (usuario_id);
