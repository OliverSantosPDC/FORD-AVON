import { apiFetch } from './apiClient';

/** Contratos alineados con backend/src/services/UsuariosService.ts */
export interface RoleRef {
  clave: string;
  nombre: string;
}

export interface UsuarioListItem {
  id: string;
  nombre: string;
  apellido: string | null;
  email: string;
  activo: boolean;
  roleId: string | null;
  role: RoleRef | null;
}

export interface UsuarioDetalle extends UsuarioListItem {
  nombreCartera: string | null;
  gestorIds: string[];
  zonaIds: string[];
}

export interface Catalogos {
  roles: Array<{ id: string; clave: string; nombre: string }>;
  zonas: Array<{ id: string; nombre: string; codigo: string | null }>;
  gestores: Array<{ id: string; nombreCartera: string | null; usuarioId: string | null }>;
  carteraGestores: string[];
}

export interface UsuarioPayload {
  email?: string;
  nombre?: string;
  apellido?: string | null;
  roleId?: string;
  activo?: boolean;
  nombreCartera?: string | null;
  gestorIds?: string[];
  zonaIds?: string[];
}

/** Traducción de errores reutilizando el patrón de mensajes de la app. */
const parseError = async (res: Response, fallback: string): Promise<string> => {
  if (res.status === 401) return 'Tu sesión ha expirado. Inicia sesión nuevamente.';
  if (res.status === 403) return 'No tienes permisos para acceder a esta información.';
  const body = await res.json().catch(() => null);
  return (body && (body as { error?: string }).error) || fallback;
};

export const listUsuarios = async (): Promise<UsuarioListItem[]> => {
  const res = await apiFetch('/api/usuarios', { cache: 'no-store' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudieron cargar los usuarios.'));
  return res.json();
};

export const getCatalogos = async (): Promise<Catalogos> => {
  const res = await apiFetch('/api/usuarios/catalogos', { cache: 'no-store' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudieron cargar los catálogos.'));
  return res.json();
};

export const getUsuario = async (id: string): Promise<UsuarioDetalle> => {
  const res = await apiFetch(`/api/usuarios/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo cargar el usuario.'));
  return res.json();
};

export const createUsuario = async (payload: UsuarioPayload): Promise<{ id: string }> => {
  const res = await apiFetch('/api/usuarios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo crear el usuario.'));
  return res.json();
};

export const updateUsuario = async (id: string, payload: UsuarioPayload): Promise<void> => {
  const res = await apiFetch(`/api/usuarios/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo actualizar el usuario.'));
};

/* ===== Carga masiva de usuarios (módulo Repositorio) ===== */

export interface PreviewItem {
  fila: number;
  accion: string;
  email: string;
  rol: string;
  estado: 'VALIDO' | 'ERROR';
  mensaje: string;
}

export interface ResumenImport {
  total: number;
  validas: number;
  errores: number;
  creaciones: number;
  actualizaciones: number;
  activaciones: number;
  desactivaciones: number;
}

export interface ResultadoAplicarItem {
  fila: number;
  accion: string;
  email: string;
  resultado: 'OK' | 'ERROR';
  mensaje: string;
}

/** Descarga la plantilla oficial .xlsx desde el backend. */
export const descargarPlantilla = async (): Promise<Blob> => {
  const res = await apiFetch('/api/usuarios/plantilla');
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo descargar la plantilla.'));
  return res.blob();
};

/** Etapa 1: valida el archivo sin modificar la base de datos. */
export const validarImportacion = async (file: File): Promise<{ items: PreviewItem[]; resumen: ResumenImport }> => {
  const form = new FormData();
  form.append('file', file);
  const res = await apiFetch('/api/usuarios/importar/validar', { method: 'POST', body: form });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo validar el archivo.'));
  return res.json();
};

/** Etapa 2: aplica las filas (soloValidas por defecto). */
export const aplicarImportacion = async (
  file: File,
  soloValidas: boolean
): Promise<{ resultados: ResultadoAplicarItem[]; resumen: ResumenImport }> => {
  const form = new FormData();
  form.append('file', file);
  form.append('soloValidas', String(soloValidas));
  const res = await apiFetch('/api/usuarios/importar/aplicar', { method: 'POST', body: form });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo procesar el archivo.'));
  return res.json();
};
