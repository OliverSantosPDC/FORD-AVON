import { apiFetch } from './apiClient';

const err = async (r: Response, f: string) => {
  if (r.status === 401) return 'Tu sesión ha expirado. Inicia sesión nuevamente.';
  if (r.status === 403) return 'No tienes permisos para acceder a esta información.';
  const b = await r.json().catch(() => null);
  return (b && (b as { error?: string }).error) || f;
};

export interface Catalogo { id: string; catalogo: string; codigo: string | null; nombre: string; activo: boolean; orden: number; }
export interface Variable { id: string; nombre: string; valor: string | null; tipo: string | null; descripcion: string | null; activo: boolean; }
export interface Plantilla { id: string; clave: string; nombre: string; url: string | null; version: number | null; updated_at: string | null; updated_by: string | null; }
export interface AuditoriaRow { id: string; actor_id: string | null; accion: string; entidad: string; entidad_id: string | null; detalle: unknown; created_at: string; }
export interface RolesData {
  roles: Array<{ id: string; clave: string; nombre: string }>;
  permisos: Array<{ id: string; clave: string; descripcion: string | null }>;
  asignaciones: Array<{ role_id: string; permission_id: string }>;
}

export const getGeneral = async (): Promise<Record<string, string>> => { const r = await apiFetch('/api/configuracion/general', { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const putGeneral = async (general: Record<string, string>) => { const r = await apiFetch('/api/configuracion/general', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ general }) }); if (!r.ok) throw new Error(await err(r, 'No se pudo guardar.')); };

export const getCatalogos = async (): Promise<Catalogo[]> => { const r = await apiFetch('/api/configuracion/catalogos', { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const crearCatalogo = async (b: Partial<Catalogo>) => { const r = await apiFetch('/api/configuracion/catalogos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); if (!r.ok) throw new Error(await err(r, 'No se pudo crear.')); };
export const actualizarCatalogo = async (id: string, b: Partial<Catalogo>) => { const r = await apiFetch(`/api/configuracion/catalogos/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); if (!r.ok) throw new Error(await err(r, 'No se pudo actualizar.')); };
export const eliminarCatalogo = async (id: string) => { const r = await apiFetch(`/api/configuracion/catalogos/${id}`, { method: 'DELETE' }); if (!r.ok) throw new Error(await err(r, 'No se pudo eliminar.')); };

export const getVariables = async (): Promise<Variable[]> => { const r = await apiFetch('/api/configuracion/variables', { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const crearVariable = async (b: Partial<Variable>) => { const r = await apiFetch('/api/configuracion/variables', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); if (!r.ok) throw new Error(await err(r, 'No se pudo crear.')); };
export const actualizarVariable = async (id: string, b: Partial<Variable>) => { const r = await apiFetch(`/api/configuracion/variables/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); if (!r.ok) throw new Error(await err(r, 'No se pudo actualizar.')); };

export const getRoles = async (): Promise<RolesData> => { const r = await apiFetch('/api/configuracion/roles', { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const putRolPermisos = async (roleId: string, permissionIds: string[]) => { const r = await apiFetch(`/api/configuracion/roles/${roleId}/permisos`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ permissionIds }) }); if (!r.ok) throw new Error(await err(r, 'No se pudo guardar.')); };

export const getPlantillas = async (): Promise<Plantilla[]> => { const r = await apiFetch('/api/configuracion/plantillas', { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const subirPlantilla = async (clave: string, file: File) => { const f = new FormData(); f.append('file', file); const r = await apiFetch(`/api/configuracion/plantillas/${clave}`, { method: 'POST', body: f }); if (!r.ok) throw new Error(await err(r, 'No se pudo subir.')); };
export const descargarPlantilla = async (clave: string): Promise<string> => { const r = await apiFetch(`/api/configuracion/plantillas/${clave}/descargar`, { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo descargar.')); return (await r.json()).url as string; };
export const subirAsset = async (clave: string, file: File) => { const f = new FormData(); f.append('file', file); const r = await apiFetch(`/api/configuracion/assets/${clave}`, { method: 'POST', body: f }); if (!r.ok) throw new Error(await err(r, 'No se pudo subir.')); };

export const getAuditoria = async (params: Record<string, string>): Promise<{ items: AuditoriaRow[]; total: number }> => {
  const qs = new URLSearchParams(params).toString();
  const r = await apiFetch(`/api/configuracion/auditoria${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(await err(r, 'No se pudo cargar la auditoría.'));
  return r.json();
};
