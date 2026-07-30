import { apiFetch } from './apiClient';
import type { DashboardResponse, DashboardFilterParams, CarteraRecord } from '../types/cartera';
import type { AggNode } from './gestionService';

const qs = (f?: DashboardFilterParams): string => {
  if (!f) return '';
  const p = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => {
    if (Array.isArray(v)) { const n = v.map((x) => x.trim()).filter(Boolean); if (n.length) p.set(k, n.join(',')); }
    else if (typeof v === 'string' && v.trim()) p.set(k, v.trim());
  });
  return p.toString() ? `?${p.toString()}` : '';
};
const err = async (r: Response, f: string) => {
  if (r.status === 401) return 'Tu sesión ha expirado. Inicia sesión nuevamente.';
  if (r.status === 403) return 'No tienes permisos para acceder a esta información.';
  const b = await r.json().catch(() => null);
  return (b && (b as { error?: string }).error) || f;
};

export interface Contadores { gestores: number; gerentes: number; zonas: number; }
export interface ControlDashboard extends DashboardResponse { contadores: Contadores; }
export interface Indicadores {
  gestiones: number; llamadas: number; sms: number; whatsapp: number; correos: number; contactabilidad: number;
  promesas: number; cumplimientoPromesas: number; cartasEmitidas: number; cartasAprobadas: number; acuerdos: number; adjuntos: number;
}
export interface Pendientes { promesas: Array<Record<string, unknown>>; cartas: Array<Record<string, unknown>>; }

export const getControlDashboard = async (f?: DashboardFilterParams): Promise<ControlDashboard> => { const r = await apiFetch(`/api/control/dashboard${qs(f)}`, { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const getControlGestores = async (f?: DashboardFilterParams): Promise<AggNode[]> => { const r = await apiFetch(`/api/control/gestores${qs(f)}`, { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const getControlZonas = async (f?: DashboardFilterParams): Promise<AggNode[]> => { const r = await apiFetch(`/api/control/zonas${qs(f)}`, { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const getControlPdCampanas = async (f?: DashboardFilterParams): Promise<AggNode[]> => { const r = await apiFetch(`/api/control/pd-campanas${qs(f)}`, { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const getControlCuentas = async (f?: DashboardFilterParams): Promise<CarteraRecord[]> => { const r = await apiFetch(`/api/control/cuentas${qs(f)}`, { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const getIndicadores = async (): Promise<Indicadores> => { const r = await apiFetch('/api/control/indicadores', { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const getPendientes = async (): Promise<Pendientes> => { const r = await apiFetch('/api/control/pendientes', { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
