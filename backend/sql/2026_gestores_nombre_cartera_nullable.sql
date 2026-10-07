-- gestores.nombre_cartera deja de ser NOT NULL.
--
-- Un usuario/Gestor creado MANUALMENTE en Usuarios (sin pasar por la carga
-- masiva/importación) nunca tuvo nombre_cartera que ofrecer: el formulario de
-- Usuarios ya no lo pide. La identidad real de un Gestor es
-- `gestores.usuario_id` (-> profiles.id), nunca el nombre; `nombre_cartera`
-- es solo el puente de TEXTO opcional hacia `cartera.gestor` (compatibilidad
-- con la cartera existente, dato operativo). Bloquear la creación del
-- registro de gestores -y por lo tanto la asignación de País/Zona vía
-- gestor_pais_zona- hasta que exista un nombre_cartera era un requisito de
-- negocio incorrecto, ya corregido en UsuariosService.sincronizarRelaciones.
--
-- Todo el código que YA lee nombre_cartera lo trata como nullable de forma
-- defensiva (`if (g.nombre_cartera && g.usuario_id)` en ScopeService,
-- CarteraService, ControlService, AsignacionService, GestionService) desde
-- antes de esta migración, así que este cambio de esquema no requiere tocar
-- ninguna consulta existente.
alter table public.gestores alter column nombre_cartera drop not null;

comment on column public.gestores.nombre_cartera is 'Puente de TEXTO opcional hacia cartera.gestor (compatibilidad con cartera existente). NULL para un Gestor creado manualmente sin cartera asociada: su alcance real se define exclusivamente vía gestor_pais_zona (gestores.id), nunca por este nombre.';
