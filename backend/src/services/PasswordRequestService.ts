import { getSupabaseClient } from '../config/supabaseClient';
import { registrarAuditoria } from './AuditoriaService';
import { generarPasswordTemporal } from '../utils/password';
import { describirErrorAuth } from '../utils/authErrors';

/**
 * Solicitudes de cambio de contraseña (FASE 1 + 7).
 * - El usuario (sin sesión) crea una solicitud desde el Login.
 * - El administrador la aprueba/rechaza desde Usuarios.
 * - Al aprobar se restablece la contraseña vía Supabase Auth admin y se entrega
 *   una contraseña temporal UNA sola vez al administrador. NUNCA se persiste en texto plano.
 * Reutiliza profiles/auditoría. No modifica auth/scope/permE existentes.
 */
export class PasswordRequestError extends Error {
  constructor(m: string) { super(m); this.name = 'PasswordRequestError'; }
}
const c = () => getSupabaseClient();

export interface SolicitudCambio {
  id: string;
  email: string;
  usuario_id: string | null;
  estado: string;
  motivo: string | null;
  observaciones: string | null;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

/** Crea una solicitud pendiente (endpoint público del Login). Respuesta genérica por seguridad. */
export const crearSolicitud = async (emailRaw: string, motivo?: string): Promise<void> => {
  const email = (emailRaw ?? '').trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new PasswordRequestError('Correo inválido.');
  }
  const cl = c();
  // Vincula al perfil si existe (sin revelar si existe o no).
  const { data: perfil } = await cl.from('profiles').select('id').eq('email', email).maybeSingle();
  const usuarioId = (perfil as { id: string } | null)?.id ?? null;
  // Evita duplicar solicitudes pendientes del mismo correo.
  const { data: pend } = await cl
    .from('password_change_requests')
    .select('id')
    .eq('email', email)
    .eq('estado', 'PENDIENTE')
    .maybeSingle();
  if (pend) return;
  const { error } = await cl.from('password_change_requests').insert({
    email,
    usuario_id: usuarioId,
    estado: 'PENDIENTE',
    motivo: motivo?.trim() || null
  });
  if (error) throw new PasswordRequestError('No se pudo registrar la solicitud.');
  await registrarAuditoria(usuarioId, 'password_request.crear', 'password_change_requests', null, { email });
};

/** Lista solicitudes (admin). Orden por fecha desc. */
export const listarSolicitudes = async (): Promise<SolicitudCambio[]> => {
  const { data, error } = await c()
    .from('password_change_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new PasswordRequestError('No se pudieron cargar las solicitudes.');
  return (data ?? []) as SolicitudCambio[];
};

/**
 * Resuelve una solicitud. accion: 'aprobar' | 'rechazar'.
 * Al aprobar restablece la contraseña y devuelve la temporal (mostrar una sola vez).
 */
export const resolverSolicitud = async (
  id: string,
  accion: 'aprobar' | 'rechazar',
  observaciones: string | null,
  actorId: string | null
): Promise<{ estado: string; passwordTemporal?: string }> => {
  const cl = c();
  const { data: sol, error: e1 } = await cl
    .from('password_change_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (e1 || !sol) throw new PasswordRequestError('Solicitud no encontrada.');
  const solicitud = sol as SolicitudCambio;
  if (solicitud.estado !== 'PENDIENTE') {
    throw new PasswordRequestError('La solicitud ya fue resuelta.');
  }

  if (accion === 'rechazar') {
    const { error } = await cl
      .from('password_change_requests')
      .update({ estado: 'RECHAZADA', observaciones: observaciones ?? null, resolved_by: actorId, resolved_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new PasswordRequestError('No se pudo rechazar la solicitud.');
    await registrarAuditoria(actorId, 'password_request.rechazar', 'password_change_requests', id, { email: solicitud.email });
    return { estado: 'RECHAZADA' };
  }

  // Aprobar: requiere que el correo corresponda a un usuario existente.
  if (!solicitud.usuario_id) {
    throw new PasswordRequestError('No existe un usuario con ese correo; no se puede restablecer.');
  }
  const passwordTemporal = generarPasswordTemporal();
  const { error: authErr } = await cl.auth.admin.updateUserById(solicitud.usuario_id, { password: passwordTemporal });
  if (authErr) throw new PasswordRequestError(describirErrorAuth(authErr, 'No se pudo restablecer la contraseña.'));

  const { error } = await cl
    .from('password_change_requests')
    .update({ estado: 'COMPLETADA', observaciones: observaciones ?? null, resolved_by: actorId, resolved_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new PasswordRequestError('Contraseña restablecida pero no se pudo actualizar la solicitud.');
  await registrarAuditoria(actorId, 'password_request.aprobar', 'password_change_requests', id, { email: solicitud.email });
  return { estado: 'COMPLETADA', passwordTemporal };
};

/** Estados que representan HISTORIAL (resueltas). Nunca se borra una solicitud PENDIENTE. */
const ESTADOS_HISTORIAL = ['COMPLETADA', 'RECHAZADA'];

/**
 * Elimina registros del HISTORIAL de solicitudes de cambio de contraseña
 * (Sección 3-4). Solo borra los ids cuyo estado sea COMPLETADA o RECHAZADA;
 * cualquier id de una solicitud PENDIENTE se omite silenciosamente (nunca se
 * elimina una solicitud activa). No afecta contraseñas, perfiles, roles,
 * niveles, relaciones ni alcance: `password_change_requests` es una bitácora
 * de solicitudes, independiente de esos datos.
 */
export const eliminarSolicitudesHistorial = async (
  ids: string[],
  actorId: string | null
): Promise<{ eliminadas: number; omitidas: number }> => {
  const idsUnicos = Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.trim())));
  if (idsUnicos.length === 0) throw new PasswordRequestError('Debes indicar al menos un registro a eliminar.');

  const cl = c();
  const { data, error } = await cl
    .from('password_change_requests')
    .select('id, email, estado')
    .in('id', idsUnicos);
  if (error) throw new PasswordRequestError('No se pudo verificar el historial a eliminar.');

  const filas = (data ?? []) as Array<{ id: string; email: string; estado: string }>;
  // "omitidas" cubre tanto ids inexistentes como ids de solicitudes PENDIENTE (activas): nunca se eliminan.
  const elegibles = filas.filter((f) => ESTADOS_HISTORIAL.includes(f.estado));

  if (elegibles.length === 0) {
    return { eliminadas: 0, omitidas: idsUnicos.length };
  }

  const idsElegibles = elegibles.map((f) => f.id);
  const { error: delErr } = await cl.from('password_change_requests').delete().in('id', idsElegibles);
  if (delErr) throw new PasswordRequestError('No se pudo eliminar el historial.');

  await registrarAuditoria(actorId, 'password_request.eliminar_historial', 'password_change_requests', null, {
    cantidad: idsElegibles.length,
    omitidas: idsUnicos.length - idsElegibles.length,
    emails: elegibles.map((f) => f.email)
  });

  return { eliminadas: idsElegibles.length, omitidas: idsUnicos.length - idsElegibles.length };
};
