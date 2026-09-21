-- FORD-AVON · Política de contraseña temporal administrativa (Avon2026, 15 días).
-- Aplicada a producción vía mcp__Supabase__apply_migration (migración
-- "password_temporal_policy" en el historial de migraciones de Supabase).
-- Este archivo documenta exactamente qué se agregó, siguiendo la convención
-- del resto de backend/sql/*.sql (idempotente, no destructivo).
--
-- Reutiliza `public.profiles` como fuente única del estado (mismo patrón que
-- `activo`/`role_id`): NINGÚN valor de contraseña se guarda aquí, solo
-- METADATOS de vigencia. La contraseña en sí vive exclusivamente en
-- Supabase Auth (auth.users), gestionada vía `auth.admin.updateUserById`.
alter table public.profiles
  add column if not exists is_temporary_password boolean not null default false,
  add column if not exists must_change_password boolean not null default false,
  add column if not exists temporary_password_created_at timestamptz,
  add column if not exists temporary_password_expires_at timestamptz;

comment on column public.profiles.is_temporary_password is 'true si la contraseña vigente fue asignada por un administrador vía la política de contraseña temporal (Avon2026, 15 días). Nunca almacena la contraseña en sí.';
comment on column public.profiles.must_change_password is 'true mientras el usuario deba cambiar su contraseña temporal (vigente o vencida). Se limpia a false al cambiarla exitosamente.';
comment on column public.profiles.temporary_password_created_at is 'Fecha/hora (UTC) en que un administrador restableció la contraseña temporal.';
comment on column public.profiles.temporary_password_expires_at is 'Fecha/hora (UTC) de vencimiento de la contraseña temporal (created_at + 15 días).';

create index if not exists idx_profiles_must_change_password
  on public.profiles (must_change_password)
  where must_change_password = true;
