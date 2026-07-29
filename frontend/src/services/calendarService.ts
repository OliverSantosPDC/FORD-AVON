import { apiFetch } from './apiClient';

export interface EventType {
  id: string;
  codigo: string;
  nombre: string;
  color: string | null;
}

export interface CalendarEvent {
  id: string;
  titulo: string;
  descripcion: string | null;
  tipo_evento_id: string | null;
  fecha_inicio: string;
  fecha_fin: string;
  hora_inicio: string | null;
  hora_fin: string | null;
  pais: string | null;
  zona_id: string | null;
  usuario_id: string | null;
  todo_el_dia: boolean;
  event_types?: { codigo: string; nombre: string; color: string | null } | null;
}

export interface CalendarEventInput {
  titulo: string;
  descripcion?: string | null;
  tipoEventoId: string;
  fechaInicio: string;
  fechaFin: string;
  horaInicio?: string | null;
  horaFin?: string | null;
  pais?: string | null;
  zonaId?: string | null;
  usuarioId?: string | null;
  todoElDia?: boolean;
}

const parseError = async (res: Response, fallback: string): Promise<string> => {
  if (res.status === 401) return 'Tu sesión ha expirado. Inicia sesión nuevamente.';
  if (res.status === 403) return 'No tienes permisos para acceder a esta información.';
  const body = await res.json().catch(() => null);
  return (body && (body as { error?: string }).error) || fallback;
};

export const getTiposEvento = async (): Promise<EventType[]> => {
  const res = await apiFetch('/api/calendario/tipos', { cache: 'no-store' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudieron cargar los tipos de evento.'));
  return res.json();
};

export const getEventos = async (params: Record<string, string> = {}): Promise<CalendarEvent[]> => {
  const qs = new URLSearchParams(params).toString();
  const res = await apiFetch(`/api/calendario${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudieron cargar los eventos.'));
  return res.json();
};

export const crearEvento = async (payload: CalendarEventInput): Promise<{ id: string }> => {
  const res = await apiFetch('/api/calendario', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo crear el evento.'));
  return res.json();
};

export const actualizarEvento = async (id: string, payload: CalendarEventInput): Promise<void> => {
  const res = await apiFetch(`/api/calendario/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo actualizar el evento.'));
};

export const eliminarEvento = async (id: string): Promise<void> => {
  const res = await apiFetch(`/api/calendario/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo eliminar el evento.'));
};
