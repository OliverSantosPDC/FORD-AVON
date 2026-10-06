import { getSupabaseClient } from '../config/supabaseClient';
import { supervisoresPorGestorId } from './ScopeService';

/**
 * Notificaciones por usuario (campana del Header). Única fuente de verdad:
 * tabla `notificaciones` (ver sql/2026_notificaciones_module.sql) — no
 * existía NINGUNA implementación previa (ni tabla ni servicio), solo un
 * icono decorativo en el frontend.
 *
 * Reglas de seguridad (igual que el resto del sistema, fail-closed):
 *  - TODA lectura/escritura queda SIEMPRE acotada por
 *    `usuario_destinatario_id` en el propio WHERE de la consulta — nunca
 *    solo filtrada después en memoria ni confiada al frontend. Un usuario
 *    jamás puede leer ni marcar como leída una notificación de otro
 *    usuario, ni manipulando el id.
 *  - Los eventos que generan notificaciones son SIEMPRE best-effort desde
 *    el punto de vista de quien los dispara: una notificación que falla
 *    NUNCA debe revertir ni bloquear la operación de negocio real (crear
 *    carta, aprobar carta, cambiar contraseña) — los callers (controllers)
 *    envuelven estas llamadas en try/catch y solo registran el error.
 *  - Deduplicación: `crearNotificacion` es idempotente para eventos con
 *    referencia estable (ver índice único parcial
 *    `uq_notificaciones_evento` sobre usuario_destinatario_id+tipo+
 *    referencia_tipo+referencia_id) — procesar el mismo evento dos veces
 *    (reintento de red, doble clic) nunca duplica la notificación.
 */

export class NotificacionesError extends Error {
  constructor(message: string) { super(message); this.name = 'NotificacionesError'; }
}

const client = () => getSupabaseClient();

export type TipoNotificacion =
  | 'CARTA_ESCALADA'
  | 'CARTA_AUTORIZADA'
  | 'CARTA_RECHAZADA'
  | 'PASSWORD_CAMBIADA'
  | 'PASSWORD_SOLICITUD_RECHAZADA';

export interface Notificacion {
  id: string;
  actorId: string | null;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  leida: boolean;
  fechaCreacion: string;
  fechaLectura: string | null;
  referenciaTipo: string | null;
  referenciaId: string | null;
}

type NotificacionRow = {
  id: string; actor_id: string | null; tipo: string; titulo: string; mensaje: string;
  leida: boolean; fecha_creacion: string; fecha_lectura: string | null;
  referencia_tipo: string | null; referencia_id: string | null;
};

const mapRow = (r: NotificacionRow): Notificacion => ({
  id: r.id,
  actorId: r.actor_id,
  tipo: r.tipo as TipoNotificacion,
  titulo: r.titulo,
  mensaje: r.mensaje,
  leida: r.leida,
  fechaCreacion: r.fecha_creacion,
  fechaLectura: r.fecha_lectura,
  referenciaTipo: r.referencia_tipo,
  referenciaId: r.referencia_id
});

const SELECT_COLS = 'id, actor_id, tipo, titulo, mensaje, leida, fecha_creacion, fecha_lectura, referencia_tipo, referencia_id';

/**
 * Crea UNA notificación para UN destinatario real (nunca "todos los
 * Supervisores" ni ningún otro destinatario genérico). Idempotente: si el
 * mismo evento (usuario_destinatario_id + tipo + referencia_tipo +
 * referencia_id) ya generó esta notificación, el código de violación de
 * unicidad de Postgres (23505) se trata como éxito silencioso — nunca una
 * segunda fila, nunca un error hacia el caller.
 */
export const crearNotificacion = async (input: {
  usuarioDestinatarioId: string;
  actorId?: string | null;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  referenciaTipo?: string | null;
  referenciaId?: string | null;
}): Promise<void> => {
  const { error } = await client().from('notificaciones').insert({
    usuario_destinatario_id: input.usuarioDestinatarioId,
    actor_id: input.actorId ?? null,
    tipo: input.tipo,
    titulo: input.titulo,
    mensaje: input.mensaje,
    referencia_tipo: input.referenciaTipo ?? null,
    referencia_id: input.referenciaId ?? null
  });
  if (error) {
    if ((error as { code?: string }).code === '23505') return; // ya existía (evento duplicado) — idempotente, no es un error real
    throw new NotificacionesError(`No se pudo crear la notificación: ${error.message}`);
  }
};

/** Cuenta rápida de no leídas — la única consulta que necesita la campana
 *  para pintar el contador (count exacto, sin traer filas). */
export const contarNoLeidas = async (usuarioId: string): Promise<number> => {
  const { count, error } = await client().from('notificaciones')
    .select('id', { count: 'exact', head: true })
    .eq('usuario_destinatario_id', usuarioId)
    .eq('leida', false);
  if (error) throw new NotificacionesError(`No se pudo contar las notificaciones: ${error.message}`);
  return count ?? 0;
};

/** Listado paginado (nunca "todas las notificaciones de siempre" de una
 *  sola vez): no leídas primero, luego por fecha más reciente. */
export const listarNotificaciones = async (
  usuarioId: string,
  opts: { limit?: number; offset?: number; soloNoLeidas?: boolean } = {}
): Promise<Notificacion[]> => {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  let q = client().from('notificaciones').select(SELECT_COLS).eq('usuario_destinatario_id', usuarioId);
  if (opts.soloNoLeidas) q = q.eq('leida', false);
  q = q.order('leida', { ascending: true }).order('fecha_creacion', { ascending: false }).range(offset, offset + limit - 1);
  const { data, error } = await q;
  if (error) throw new NotificacionesError(`No se pudieron cargar las notificaciones: ${error.message}`);
  return ((data ?? []) as NotificacionRow[]).map(mapRow);
};

/**
 * Marca UNA notificación como leída — el WHERE exige SIEMPRE
 * usuario_destinatario_id = usuarioId (el usuario autenticado), nunca solo
 * el id: así un id de otro usuario nunca se puede marcar, ni manipulando la
 * petición directamente. Devuelve `false` si no existe o no es del usuario
 * (ambos casos indistinguibles desde afuera, por seguridad — el controller
 * responde 404 en ambos). Marcar una notificación YA leída es un no-op
 * exitoso (nunca pisa `fecha_lectura` con un segundo clic).
 */
export const marcarLeida = async (id: string, usuarioId: string): Promise<boolean> => {
  const { data, error } = await client().from('notificaciones')
    .select('id, leida')
    .eq('id', id)
    .eq('usuario_destinatario_id', usuarioId)
    .limit(1);
  if (error) throw new NotificacionesError(`No se pudo leer la notificación: ${error.message}`);
  const fila = ((data ?? []) as Array<{ id: string; leida: boolean }>)[0];
  if (!fila) return false;
  if (!fila.leida) {
    const { error: updErr } = await client().from('notificaciones')
      .update({ leida: true, fecha_lectura: new Date().toISOString() })
      .eq('id', id);
    if (updErr) throw new NotificacionesError(`No se pudo marcar la notificación: ${updErr.message}`);
  }
  return true;
};

/** Marca TODAS las no leídas del usuario autenticado como leídas. Devuelve
 *  cuántas se marcaron (0 es una respuesta válida, no un error). */
export const marcarTodasLeidas = async (usuarioId: string): Promise<number> => {
  const { data, error } = await client().from('notificaciones')
    .update({ leida: true, fecha_lectura: new Date().toISOString() })
    .eq('usuario_destinatario_id', usuarioId)
    .eq('leida', false)
    .select('id');
  if (error) throw new NotificacionesError(`No se pudieron marcar las notificaciones: ${error.message}`);
  return ((data ?? []) as unknown[]).length;
};

/** Resuelve el/los Supervisor(es) VIGENTES de un gestor identificado por su
 *  `profiles.id` (el id real del usuario autenticado que creó la carta) —
 *  vía `gestores.usuario_id -> gestores.id -> supervisor_gestor`,
 *  reutilizando el mismo helper que ya usa el resto del alcance
 *  (ScopeService.supervisoresPorGestorId), nunca una consulta nueva
 *  duplicada. Devuelve `[]` si el gestor no tiene fila en `gestores` o no
 *  tiene Supervisor vigente — en ese caso el caller NO genera ninguna
 *  notificación incorrecta (ver `notificarCartaEscalada`). */
const supervisoresDeGestorPorUsuarioId = async (gestorUsuarioId: string): Promise<string[]> => {
  const { data, error } = await client().from('gestores').select('id').eq('usuario_id', gestorUsuarioId).limit(1);
  if (error) throw new NotificacionesError(`No se pudo resolver el gestor: ${error.message}`);
  const gestorRow = ((data ?? []) as Array<{ id: string }>)[0];
  if (!gestorRow) return [];
  const mapa = await supervisoresPorGestorId([gestorRow.id]);
  return mapa.get(gestorRow.id) ?? [];
};

/**
 * EVENTO REAL: un Gestor escaló/creó una carta pendiente de autorización.
 * Notifica a cada Supervisor VIGENTE de ese gestor (nunca a todos los
 * Supervisores) — si no se puede resolver un Supervisor inequívoco, NO se
 * genera ninguna notificación (se deja constancia en el log del servidor
 * para poder auditar la situación, nunca se inventa un destinatario).
 */
export const notificarCartaEscalada = async (input: {
  cartaId: string; codigo: string; gestorUsuarioId: string | null; pd: string | null; nombreCuenta?: string | null;
}): Promise<void> => {
  if (!input.gestorUsuarioId) {
    console.warn(`[NOTIFICACIONES] Carta ${input.cartaId} (código ${input.codigo}) creada sin gestor_id resoluble — no se generó notificación de escalamiento.`);
    return;
  }
  const supervisorIds = await supervisoresDeGestorPorUsuarioId(input.gestorUsuarioId);
  if (supervisorIds.length === 0) {
    console.warn(`[NOTIFICACIONES] Carta ${input.cartaId} (código ${input.codigo}): el gestor ${input.gestorUsuarioId} no tiene Supervisor vigente resoluble — no se generó notificación de escalamiento.`);
    return;
  }
  const titulo = 'Se escaló una carta para autorización';
  const partes = [`Código: ${input.codigo}`];
  if (input.nombreCuenta) partes.push(`Nombre: ${input.nombreCuenta}`);
  if (input.pd) partes.push(`PD: ${input.pd}`);
  const mensaje = partes.join(' · ');
  await Promise.all(supervisorIds.map((supervisorId) => crearNotificacion({
    usuarioDestinatarioId: supervisorId,
    actorId: input.gestorUsuarioId,
    tipo: 'CARTA_ESCALADA',
    titulo,
    mensaje,
    referenciaTipo: 'gestion_cartas',
    referenciaId: input.cartaId
  })));
};

/**
 * EVENTO REAL: un Supervisor aprobó o rechazó una carta. Notifica
 * ÚNICAMENTE al Gestor dueño de esa carta (`gestion_cartas.gestor_id`, que
 * YA es el `profiles.id` real — sin saltos adicionales).
 */
export const notificarCartaResuelta = async (input: {
  cartaId: string; codigo: string; gestorUsuarioId: string | null; aprobar: boolean; aprobadoPor: string | null;
}): Promise<void> => {
  if (!input.gestorUsuarioId) {
    console.warn(`[NOTIFICACIONES] Carta ${input.cartaId} (código ${input.codigo}) resuelta sin gestor_id — no se generó notificación.`);
    return;
  }
  const titulo = input.aprobar ? 'Carta autorizada' : 'Carta rechazada';
  const mensaje = `Código: ${input.codigo}`;
  await crearNotificacion({
    usuarioDestinatarioId: input.gestorUsuarioId,
    actorId: input.aprobadoPor,
    tipo: input.aprobar ? 'CARTA_AUTORIZADA' : 'CARTA_RECHAZADA',
    titulo,
    mensaje,
    referenciaTipo: 'gestion_cartas',
    referenciaId: input.cartaId
  });
};

/**
 * EVENTO REAL: la contraseña de un usuario fue cambiada (restablecimiento
 * administrativo directo, o aprobación de una solicitud de cambio del
 * propio usuario). NUNCA incluye la contraseña en el mensaje.
 *
 * Nota sobre deduplicación: a diferencia de una carta (que transita de
 * PENDIENTE_APROBACION a APROBADA/RECHAZADA EXACTAMENTE UNA VEZ, un estado
 * real y estable para deduplicar), un restablecimiento de contraseña es una
 * acción que el sistema permite repetir legítimamente cualquier número de
 * veces — no existe un "evento" con identidad propia que deduplicar sin
 * inventar una clave artificial que terminaría bloqueando restablecimientos
 * reales y distintos. Por eso esta notificación no lleva referencia_id: la
 * prevención de doble-envío por doble clic es responsabilidad de la UI
 * (deshabilitar el botón mientras la petición está en curso), no de esta
 * capa. Cuando el cambio SÍ proviene de una solicitud con identidad propia
 * (`password_change_requests.id`), se usa esa referencia real — ver el
 * llamador en PasswordRequestController/UsuariosController.
 */
export const notificarPasswordCambiada = async (input: {
  usuarioId: string; actorId: string | null; referenciaId?: string | null;
}): Promise<void> => {
  await crearNotificacion({
    usuarioDestinatarioId: input.usuarioId,
    actorId: input.actorId,
    tipo: 'PASSWORD_CAMBIADA',
    titulo: 'Tu contraseña fue actualizada',
    mensaje: `Actualizada el ${new Date().toLocaleString('es-GT', { dateStyle: 'medium', timeStyle: 'short' })}`,
    referenciaTipo: input.referenciaId ? 'password_change_requests' : null,
    referenciaId: input.referenciaId ?? null
  });
};

/** EVENTO REAL: una solicitud de cambio de contraseña del propio usuario
 *  fue rechazada por un administrador. */
export const notificarSolicitudPasswordRechazada = async (input: {
  usuarioId: string; actorId: string | null; solicitudId: string;
}): Promise<void> => {
  await crearNotificacion({
    usuarioDestinatarioId: input.usuarioId,
    actorId: input.actorId,
    tipo: 'PASSWORD_SOLICITUD_RECHAZADA',
    titulo: 'Tu solicitud de cambio de contraseña fue rechazada',
    mensaje: `Resuelta el ${new Date().toLocaleString('es-GT', { dateStyle: 'medium', timeStyle: 'short' })}`,
    referenciaTipo: 'password_change_requests',
    referenciaId: input.solicitudId
  });
};
