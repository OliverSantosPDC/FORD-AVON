import { getSupabaseClient } from '../config/supabaseClient';
import { registrarAuditoria } from './AuditoriaService';
import { generarPasswordTemporal } from '../utils/password';

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
  if (authErr) throw new PasswordRequestError(`No se pudo restablecer la contraseña: ${authErr.message}`);

  const { error } = await cl
    .from('password_change_requests')
    .update({ estado: 'COMPLETADA', observaciones: observaciones ?? null, resolved_by: actorId, resolved_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new PasswordRequestError('Contraseña restablecida pero no se pudo actualizar la solicitud.');
  await registrarAuditoria(actorId, 'password_request.aprobar', 'password_change_requests', id, { email: solicitud.email });
  return { estado: 'COMPLETADA', passwordTemporal };
};
