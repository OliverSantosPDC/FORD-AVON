-- FORD-AVON · Control Operativo (idempotente). Reutiliza tablas/permisos/auditoría.
insert into public.permissions (clave, descripcion, activo) values
  ('modulo.control_operativo',   'Módulo Control Operativo', true),
  ('control_operativo.ver',      'Control Operativo: ver',   true),
  ('control_operativo.editar',   'Control Operativo: editar', true)
on conflict (clave) do nothing;

-- Acceso: administrador, liderazgo, supervisor, gerente_zona (NO gestor).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r
join public.permissions p on p.clave in ('modulo.control_operativo','control_operativo.ver','control_operativo.editar')
where r.clave in ('administrador','liderazgo','supervisor','gerente_zona')
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_id = p.id);
