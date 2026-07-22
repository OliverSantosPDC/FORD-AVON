import { CarteraRecord, DashboardResponse, DashboardFilterParams, InteligenciaResponse } from '../types/cartera';

const API_BASE = '';

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

export const fetchDashboard = async (filters?: DashboardFilterParams): Promise<DashboardResponse> => {
  const queryString = buildQueryString(filters);
  const response = await fetch(`/api/dashboard${queryString}`);
  if (!response.ok) {
    throw new Error('No se pudo obtener la información del dashboard.');
  }
  return response.json();
};

export const fetchInteligencia = async (): Promise<InteligenciaResponse> => {
  const response = await fetch(`/api/inteligencia`);
  if (!response.ok) {
    throw new Error('No se pudo obtener la información del centro de inteligencia.');
  }
  return response.json();
};

export const fetchCartera = async (): Promise<CarteraRecord[]> => {
  const response = await fetch(`/api/cartera`);
  if (!response.ok) {
    throw new Error('No se pudo obtener la información de cartera.');
  }
  return response.json();
};
