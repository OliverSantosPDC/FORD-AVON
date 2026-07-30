-- FORD-AVON · Configuración v2 (idempotente). No borra datos.
alter table public.config_variables add column if not exists tipo text default 'texto';
alter table public.config_plantillas add column if not exists version int default 1;

insert into public.config_general (clave, valor) values
  ('build', ''), ('ultimo_despliegue', '')
on conflict (clave) do nothing;
