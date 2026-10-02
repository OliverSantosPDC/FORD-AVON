import { apiFetch } from './apiClient';

const err = async (r: Response, f: string) => {
  if (r.status === 401) return 'Tu sesión ha expirado. Inicia sesión nuevamente.';
  if (r.status === 403) return 'No tienes permisos para acceder a esta información.';
  const b = await r.json().catch(() => null);
  return (b && (b as { error?: string }).error) || f;
};

export interface Catalogo { id: string; catalogo: string; codigo: string | null; nombre: string; activo: boolean; orden: number; }
export interface TasaConversion { id: string; codigo: string; nombre: string; tasa: number; updated_at: string | null; updated_by: string | null; }
export interface MetaGlobal {
  definida: boolean;
  tipo: 'PORCENTAJE' | 'MONTO' | null;
  porcentaje: number | null;
  montoUsdGlobal: number | null;
  totalSaldoInicialUsd: number;
  updatedAt: string | null;
  updatedBy: string | null;
}
export interface Plantilla { id: string; clave: string; nombre: string; url: string | null; version: number | null; updated_at: string | null; updated_by: string | null; }
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

export const getTasasConversion = async (): Promise<TasaConversion[]> => { const r = await apiFetch('/api/configuracion/tasas-conversion', { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const actualizarTasaConversion = async (id: string, tasa: number) => { const r = await apiFetch(`/api/configuracion/tasas-conversion/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tasa }) }); if (!r.ok) throw new Error(await err(r, 'No se pudo actualizar.')); };

export const getMetaGlobal = async (): Promise<MetaGlobal> => { const r = await apiFetch('/api/configuracion/metas', { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const guardarMetaGlobal = async (b: { tipo: 'PORCENTAJE' | 'MONTO'; porcentaje?: number; montoUsd?: number }) => { const r = await apiFetch('/api/configuracion/metas', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); if (!r.ok) throw new Error(await err(r, 'No se pudo guardar.')); };

/** Tasas de conversión oficiales, consumo transversal (sin permiso de Configuración) para el Dashboard. */
export const getTasasConversionActivas = async (): Promise<Array<{ codigo: string; nombre: string; tasa: number }>> => {
  const r = await apiFetch('/api/catalogos/tasas-conversion', { cache: 'no-store' });
  if (!r.ok) return [];
  return r.json();
};

export const getRoles = async (): Promise<RolesData> => { const r = await apiFetch('/api/configuracion/roles', { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const putRolPermisos = async (roleId: string, permissionIds: string[]) => { const r = await apiFetch(`/api/configuracion/roles/${roleId}/permisos`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ permissionIds }) }); if (!r.ok) throw new Error(await err(r, 'No se pudo guardar.')); };

export const getPlantillas = async (): Promise<Plantilla[]> => { const r = await apiFetch('/api/configuracion/plantillas', { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const subirPlantilla = async (clave: string, file: File) => { const f = new FormData(); f.append('file', file); const r = await apiFetch(`/api/configuracion/plantillas/${clave}`, { method: 'POST', body: f }); if (!r.ok) throw new Error(await err(r, 'No se pudo subir.')); };
export const descargarPlantilla = async (clave: string): Promise<string> => { const r = await apiFetch(`/api/configuracion/plantillas/${clave}/descargar`, { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo descargar.')); return (await r.json()).url as string; };
export const subirAsset = async (clave: string, file: File) => { const f = new FormData(); f.append('file', file); const r = await apiFetch(`/api/configuracion/assets/${clave}`, { method: 'POST', body: f }); if (!r.ok) throw new Error(await err(r, 'No se pudo subir.')); };
/** URL firmada temporal para previsualizar un asset (logo/fondo). `null` si la clave no tiene archivo configurado. */
export const obtenerUrlAsset = async (clave: string): Promise<string | null> => { const r = await apiFetch(`/api/configuracion/assets/${clave}/url`, { cache: 'no-store' }); if (!r.ok) return null; return (await r.json()).url as string | null; };

/** Plantillas de carta de cobro por PD (PD1-PD3 comparten una; PD0 no tiene carta). */
export interface PlantillaCarta {
  clave: string; nombre: string; bandas: string[]; tono: string;
  contenido: string | null; asunto: string | null; activo: boolean;
  version: number | null; updatedAt: string | null; updatedBy: string | null;
}
export interface VariableCarta { variable: string; descripcion: string; soloPd7?: boolean; }
export interface CartaPreviewAdmin { pd: string | null; disponible: boolean; plantillaClave: string | null; contenido: string | null; variablesFaltantes: string[]; }

export const getPlantillasCarta = async (): Promise<{ items: PlantillaCarta[]; variables: VariableCarta[] }> => {
  const r = await apiFetch('/api/configuracion/plantillas-carta', { cache: 'no-store' });
  if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.'));
  return r.json();
};
export const actualizarPlantillaCarta = async (clave: string, patch: { contenido: string; asunto: string; activo: boolean }): Promise<{ version: number }> => {
  const r = await apiFetch(`/api/configuracion/plantillas-carta/${clave}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  if (!r.ok) throw new Error(await err(r, 'No se pudo guardar.'));
  return r.json();
};
/** Previsualiza con una cuenta real (`codigo`) o, si se omite, con una cuenta de prueba de la banda de PD indicada. */
export const previsualizarPlantillaCarta = async (clave: string, params: { codigo?: string; pd?: string } = {}): Promise<CartaPreviewAdmin> => {
  const qs = new URLSearchParams();
  if (params.codigo) qs.set('codigo', params.codigo);
  if (params.pd) qs.set('pd', params.pd);
  const q = qs.toString();
  const r = await apiFetch(`/api/configuracion/plantillas-carta/${clave}/preview${q ? `?${q}` : ''}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(await err(r, 'No se pudo previsualizar.'));
  return r.json();
};
