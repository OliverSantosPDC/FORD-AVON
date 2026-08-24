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
  gestor_nombre?: string | null;
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

export const setActivoEvento = async (id: string, activo: boolean): Promise<void> => {
  const res = await apiFetch(`/api/calendario/${id}/activo`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activo })
  });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo cambiar el estado del evento.'));
};

/* ===== Carga masiva de calendario ===== */
export interface CalPreviewItem { fila: number; accion: string; titulo: string; estado: 'VALIDO' | 'ERROR'; mensaje: string; }
export interface CalResumen { total: number; validas: number; errores: number; creaciones: number; actualizaciones: number; eliminaciones: number; activaciones: number; desactivaciones: number; }
export interface CalResultadoItem extends CalPreviewItem { resultado: 'OK' | 'ERROR'; }

export const descargarPlantillaCalendario = async (): Promise<Blob> => {
  const res = await apiFetch('/api/calendario/plantilla');
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo descargar la plantilla.'));
  return res.blob();
};

export const validarImportacionCalendario = async (file: File): Promise<{ items: CalPreviewItem[]; resumen: CalResumen }> => {
  const form = new FormData();
  form.append('file', file);
  const res = await apiFetch('/api/calendario/importar/validar', { method: 'POST', body: form });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo validar el archivo.'));
  return res.json();
};

export const aplicarImportacionCalendario = async (file: File, soloValidas: boolean): Promise<{ resultados: CalResultadoItem[]; resumen: CalResumen }> => {
  const form = new FormData();
  form.append('file', file);
  form.append('soloValidas', String(soloValidas));
  const res = await apiFetch('/api/calendario/importar/aplicar', { method: 'POST', body: form });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo procesar el archivo.'));
  return res.json();
};
