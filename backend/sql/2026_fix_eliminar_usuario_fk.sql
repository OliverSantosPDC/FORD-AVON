-- Corrige la eliminación de usuarios ("No se pudo eliminar el usuario de Auth: {}").
--
-- Causa real (auditada): `profiles.id` referencia `auth.users(id) ON DELETE
-- CASCADE`, pero 12 columnas de ATRIBUCIÓN ("quién hizo/aprobó/otorgó algo")
-- referenciaban `profiles(id)` SIN cláusula ON DELETE (=> NO ACTION/RESTRICT
-- por defecto en Postgres). Al eliminar un usuario con historial en
-- cualquiera de esas tablas (un Gestor con gestion_cartas/gestion_promesas/
-- gestion_adjuntos/gestion_log, o un Administrador que actualizó
-- config_general/config_plantillas/config_tasas_conversion/info_content, o
-- creó un calendar_events, u otorgó un acceso_global_temporal), el CASCADE
-- desde auth.users -> profiles queda bloqueado por esas FK y Postgres aborta
-- el DELETE. GoTrue (Supabase Auth) captura ese error genérico y, al no
-- encontrar los campos msg/message/error_description/error esperados en el
-- cuerpo de la respuesta, construye el mensaje como JSON.stringify(cuerpo) —
-- que para un cuerpo vacío produce exactamente la cadena "{}".
--
-- Se alinean estas 12 columnas con el patrón YA usado en el resto del
-- esquema para columnas de atribución (auditoria.actor_id,
-- password_change_requests.usuario_id/resolved_by, metas.created_by/
-- updated_by, asignaciones.asignado_por, calidad_gestion_evaluaciones.*,
-- gestores.usuario_id): ON DELETE SET NULL. El registro histórico se
-- conserva; solo se pierde la atribución al usuario eliminado.

ALTER TABLE calendar_events DROP CONSTRAINT calendar_events_creado_por_fkey;
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_creado_por_fkey
  FOREIGN KEY (creado_por) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE info_content DROP CONSTRAINT info_content_updated_by_fkey;
ALTER TABLE info_content ADD CONSTRAINT info_content_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE gestion_log DROP CONSTRAINT gestion_log_gestor_id_fkey;
ALTER TABLE gestion_log ADD CONSTRAINT gestion_log_gestor_id_fkey
  FOREIGN KEY (gestor_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE gestion_promesas DROP CONSTRAINT gestion_promesas_created_by_fkey;
ALTER TABLE gestion_promesas ADD CONSTRAINT gestion_promesas_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE gestion_adjuntos DROP CONSTRAINT gestion_adjuntos_subido_por_fkey;
ALTER TABLE gestion_adjuntos ADD CONSTRAINT gestion_adjuntos_subido_por_fkey
  FOREIGN KEY (subido_por) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE gestion_cartas DROP CONSTRAINT gestion_cartas_gestor_id_fkey;
ALTER TABLE gestion_cartas ADD CONSTRAINT gestion_cartas_gestor_id_fkey
  FOREIGN KEY (gestor_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE gestion_cartas DROP CONSTRAINT gestion_cartas_aprobado_por_fkey;
ALTER TABLE gestion_cartas ADD CONSTRAINT gestion_cartas_aprobado_por_fkey
  FOREIGN KEY (aprobado_por) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE config_general DROP CONSTRAINT config_general_updated_by_fkey;
ALTER TABLE config_general ADD CONSTRAINT config_general_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE config_plantillas DROP CONSTRAINT config_plantillas_updated_by_fkey;
ALTER TABLE config_plantillas ADD CONSTRAINT config_plantillas_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE config_plantillas_versiones DROP CONSTRAINT config_plantillas_versiones_updated_by_fkey;
ALTER TABLE config_plantillas_versiones ADD CONSTRAINT config_plantillas_versiones_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE config_tasas_conversion DROP CONSTRAINT config_tasas_conversion_updated_by_fkey;
ALTER TABLE config_tasas_conversion ADD CONSTRAINT config_tasas_conversion_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- acceso_global_temporal.concedido_por es NOT NULL (a diferencia de las demás):
-- se relaja a NULL primero (igual que el resto de columnas de atribución del
-- esquema) para poder aplicar el mismo ON DELETE SET NULL.
ALTER TABLE acceso_global_temporal ALTER COLUMN concedido_por DROP NOT NULL;
ALTER TABLE acceso_global_temporal DROP CONSTRAINT acceso_global_temporal_concedido_por_fkey;
ALTER TABLE acceso_global_temporal ADD CONSTRAINT acceso_global_temporal_concedido_por_fkey
  FOREIGN KEY (concedido_por) REFERENCES profiles(id) ON DELETE SET NULL;
