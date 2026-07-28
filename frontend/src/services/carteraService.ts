import {
  CarteraRecord,
  DashboardResponse,
  DashboardFilterParams,
  InteligenciaResponse,
} from '../types/cartera';
import { apiFetch } from './apiClient';

/**
 * Traduce el status HTTP a un mensaje amigable y unificado para la UI.
 * Fuente única de traducción de errores (no se duplica en las páginas).
 */
const SERVER_ERROR = 'No fue posible cargar la información. Intenta nuevamente.';
const messageForStatus = (status: number, _fallback?: string): string => {
  if (status === 401) return 'Tu sesión ha expirado. Inicia sesión nuevamente.';
  if (status === 403) return 'No tienes permisos para acceder a esta información.';
  return SERVER_ERROR;
};

const buildQueryString = (filters?: DashboardFilterParams) => {
  if (!filters) return '';

  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      const normalized = value.map((item) => item.trim()).filter(Boolean);

      if (normalized.length) {
        params.set(key, normalized.join(','));
      }
    } else if (typeof value === 'string' && value.trim() !== '') {
      params.set(key, value.trim());
    }
  });

  return params.toString() ? `?${params.toString()}` : '';
};

export const fetchDashboard = async (
  filters?: DashboardFilterParams
): Promise<DashboardResponse> => {
  const queryString = buildQueryString(filters);

  // apiFetch añade automáticamente Authorization: Bearer <access_token>.
  // no-store: tras una carga de cartera, la recarga debe leer datos nuevos
  // y nunca servir una respuesta cacheada por el navegador.
  const response = await apiFetch(`/api/dashboard${queryString}`, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(messageForStatus(response.status, 'No se pudo obtener la información del dashboard.'));
  }

  return response.json();
};

export const fetchInteligencia = async (): Promise<InteligenciaResponse> => {
  const response = await apiFetch(`/api/inteligencia`);

  if (!response.ok) {
    throw new Error(messageForStatus(response.status, 'No se pudo obtener la información del centro de inteligencia.'));
  }

  return response.json();
};

export const fetchCartera = async (): Promise<CarteraRecord[]> => {
  const response = await apiFetch(`/api/cartera`);

  if (!response.ok) {
    throw new Error(messageForStatus(response.status, 'No se pudo obtener la información de cartera.'));
  }

  return response.json();
};
