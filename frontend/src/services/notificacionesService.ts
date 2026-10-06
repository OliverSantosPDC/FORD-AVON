import { apiFetch } from './apiClient';

/** Notificaciones (campana del Header) — cada endpoint devuelve ÚNICAMENTE
 *  las notificaciones del usuario autenticado (resuelto en el backend desde
 *  el token, nunca desde un parámetro de esta API). */

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

const parseError = async (res: Response, fallback: string): Promise<string> => {
  if (res.status === 401) return 'Tu sesión ha expirado. Inicia sesión nuevamente.';
  if (res.status === 404) return 'Notificación no encontrada.';
  const body = await res.json().catch(() => null);
  return (body && (body as { error?: string }).error) || fallback;
};

export const getContadorNoLeidas = async (): Promise<number> => {
  const res = await apiFetch('/api/notificaciones/contador', { cache: 'no-store' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo cargar el contador de notificaciones.'));
  const body = (await res.json()) as { noLeidas: number };
  return body.noLeidas;
};

export const getNotificaciones = async (opts: { limit?: number; soloNoLeidas?: boolean } = {}): Promise<Notificacion[]> => {
  const p = new URLSearchParams();
  if (opts.limit) p.set('limit', String(opts.limit));
  if (opts.soloNoLeidas) p.set('soloNoLeidas', 'true');
  const qs = p.toString() ? `?${p.toString()}` : '';
  const res = await apiFetch(`/api/notificaciones${qs}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudieron cargar las notificaciones.'));
  return res.json();
};

export const marcarNotificacionLeida = async (id: string): Promise<void> => {
  const res = await apiFetch(`/api/notificaciones/${encodeURIComponent(id)}/leida`, { method: 'PATCH' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo marcar la notificación.'));
};

export const marcarTodasNotificacionesLeidas = async (): Promise<number> => {
  const res = await apiFetch('/api/notificaciones/leidas', { method: 'PATCH' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudieron marcar las notificaciones.'));
  const body = (await res.json()) as { cantidad: number };
  return body.cantidad;
};

/** Ruta de la app a la que debe navegar cada tipo de notificación — nunca
 *  texto/IDs hardcodeados en el componente visual, una sola fuente aquí. */
export const rutaDeNotificacion = (n: Notificacion): string | null => {
  if (n.referenciaTipo === 'gestion_cartas') {
    if (n.tipo === 'CARTA_ESCALADA') return '/control-operativo';
    if (n.tipo === 'CARTA_AUTORIZADA' || n.tipo === 'CARTA_RECHAZADA') return '/gestion?tab=cartas';
  }
  return null; // Seguridad/contraseña: no hay una página de destino específica.
};
