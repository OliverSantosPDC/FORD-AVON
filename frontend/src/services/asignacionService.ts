import { apiFetch } from './apiClient';
import type { DashboardFilterParams } from '../types/cartera';

export interface ReglaAsignacion {
  ambito?: 'GLOBAL' | 'PAIS' | 'ZONA';
  grupoPrioritarioPct: number;
  criterio: 'saldo' | 'cuentas';
  gestoresPrioritario: string[];
  gestoresResto: string[];
}
export interface DistNode { clave: string; cuentas: number; saldoUsd: number; }
export interface SimGestor {
  gestor: string;
  cuentasActuales: number; cuentasPropuestas: number;
  saldoActualUsd: number; saldoPropuestoUsd: number;
  distPD: DistNode[]; distRiesgo: DistNode[]; distPais: DistNode[];
}
export interface SimulacionResponse { gestores: SimGestor[]; totalCuentas: number; }
export interface AsignacionGestor { usuarioId: string | null; nombre: string; }
export interface AsignacionHistorial {
  id: string; codigo: string; gestor_anterior: string | null; gestor_nuevo: string;
  tipo: string; motivo: string | null; pais: string | null; created_at: string; asignado_por_nombre?: string | null;
}
export interface HistorialFiltro { desde?: string; hasta?: string; pais?: string; gestorAnterior?: string; gestorNuevo?: string; tipo?: string; }

const err = async (r: Response, fallback: string): Promise<string> => {
  if (r.status === 401) return 'Tu sesión ha expirado. Inicia sesión nuevamente.';
  if (r.status === 403) return 'No tienes permisos para esta acción.';
  const b = await r.json().catch(() => null);
  return (b && (b as { error?: string }).error) || fallback;
};
const qs = (f: Record<string, string | undefined>): string => {
  const p = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v && v.trim()) p.set(k, v.trim()); });
  const s = p.toString(); return s ? `?${s}` : '';
};

export const getAsignacionGestores = async (): Promise<AsignacionGestor[]> => {
  const r = await apiFetch('/api/control/asignacion/gestores', { cache: 'no-store' });
  if (!r.ok) throw new Error(await err(r, 'No se pudieron cargar los gestores.'));
  return r.json();
};
export const simularAsignacion = async (regla: ReglaAsignacion, filtros?: DashboardFilterParams): Promise<SimulacionResponse> => {
  const r = await apiFetch('/api/control/asignacion/simular', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...regla, filtros }) });
  if (!r.ok) throw new Error(await err(r, 'No se pudo simular la asignación.'));
  return r.json();
};
export const aplicarAsignacion = async (regla: ReglaAsignacion, filtros?: DashboardFilterParams): Promise<{ afectadas: number }> => {
  const r = await apiFetch('/api/control/asignacion/aplicar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...regla, filtros }) });
  if (!r.ok) throw new Error(await err(r, 'No se pudo aplicar la asignación.'));
  return r.json();
};
export const reasignarCuenta = async (codigo: string, gestorNuevo: string, motivo: string): Promise<{ id: string }> => {
  const r = await apiFetch('/api/control/asignacion/reasignar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo, gestorNuevo, motivo }) });
  if (!r.ok) throw new Error(await err(r, 'No se pudo reasignar la cuenta.'));
  return r.json();
};
export const getAsignacionHistorial = async (f: HistorialFiltro = {}): Promise<AsignacionHistorial[]> => {
  const r = await apiFetch(`/api/control/asignacion/historial${qs(f as Record<string, string | undefined>)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(await err(r, 'No se pudo cargar el historial.'));
  return r.json();
};
