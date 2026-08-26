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
  /** Contraseña inicial (solo al crear). */
  password?: string;
  // Se conservan por compatibilidad de firma; Usuarios ya no los define (asignación semimanual).
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

export const createUsuario = async (payload: UsuarioPayload): Promise<{ id: string; password: string }> => {
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

export const deleteUsuario = async (id: string): Promise<void> => {
  const res = await apiFetch(`/api/usuarios/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo eliminar el usuario.'));
};

/** Restablece la contraseña de un usuario (admin). No devuelve la contraseña. */
export const resetPasswordUsuario = async (id: string, password: string): Promise<void> => {
  const res = await apiFetch(`/api/usuarios/${id}/password`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo restablecer la contraseña.'));
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
  nombre: string;
  apellido: string;
  rol: string;
  resultado: 'OK' | 'ERROR';
  password: string;
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

// ===== Solicitudes de cambio de contraseña =====
export interface PasswordRequest {
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

/** Público (Login, sin sesión): registra una solicitud de cambio de contraseña. */
export const requestPasswordChange = async (email: string, motivo?: string): Promise<void> => {
  const res = await apiFetch('/api/auth/password-change-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, motivo })
  });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo enviar la solicitud.'));
};

/** Admin: lista solicitudes de cambio de contraseña. */
export const getPasswordRequests = async (): Promise<PasswordRequest[]> => {
  const res = await apiFetch('/api/usuarios/password-requests', { cache: 'no-store' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudieron cargar las solicitudes.'));
  return res.json();
};

/** Admin: aprueba o rechaza una solicitud. Al aprobar devuelve la contraseña temporal. */
export const resolvePasswordRequest = async (
  id: string,
  accion: 'aprobar' | 'rechazar',
  observaciones?: string
): Promise<{ estado: string; passwordTemporal?: string }> => {
  const res = await apiFetch(`/api/usuarios/password-requests/${id}/resolver`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion, observaciones })
  });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo resolver la solicitud.'));
  return res.json();
};
