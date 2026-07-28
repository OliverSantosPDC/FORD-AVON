import { authService } from './authService';

const API_BASE = import.meta.env.VITE_API_URL || '';

/**
 * fetch autenticado: agrega automáticamente el header Authorization con el
 * access_token vigente de Supabase. Evita repetir el token en cada servicio.
 */
export const apiFetch = async (path: string, options: RequestInit = {}): Promise<Response> => {
  const token = await authService.getAccessToken();
  const headers = new Headers(options.headers ?? {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...options, headers });
};
