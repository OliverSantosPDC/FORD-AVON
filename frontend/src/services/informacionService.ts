import { apiFetch } from './apiClient';

export interface CorporateLink {
  id?: string;
  nombre: string;
  descripcion?: string | null;
  url: string;
  orden?: number;
  activo?: boolean;
}

export interface InfoData {
  contenido: Record<string, string>;
  enlaces: CorporateLink[];
}

const parseError = async (res: Response, fallback: string): Promise<string> => {
  if (res.status === 401) return 'Tu sesión ha expirado. Inicia sesión nuevamente.';
  if (res.status === 403) return 'No tienes permisos para acceder a esta información.';
  const body = await res.json().catch(() => null);
  return (body && (body as { error?: string }).error) || fallback;
};

export const getInformacion = async (): Promise<InfoData> => {
  const res = await apiFetch('/api/informacion', { cache: 'no-store' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo cargar la información.'));
  return res.json();
};

export const guardarContenido = async (contenido: Record<string, string>): Promise<void> => {
  const res = await apiFetch('/api/informacion', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contenido })
  });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo guardar.'));
};

export const crearEnlace = async (link: CorporateLink): Promise<{ id: string }> => {
  const res = await apiFetch('/api/informacion/enlaces', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(link)
  });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo crear el enlace.'));
  return res.json();
};

export const actualizarEnlace = async (id: string, link: CorporateLink): Promise<void> => {
  const res = await apiFetch(`/api/informacion/enlaces/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(link)
  });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo actualizar el enlace.'));
};

export const eliminarEnlace = async (id: string): Promise<void> => {
  const res = await apiFetch(`/api/informacion/enlaces/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo eliminar el enlace.'));
};
