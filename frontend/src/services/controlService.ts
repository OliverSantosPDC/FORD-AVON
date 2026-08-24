import { apiFetch } from './apiClient';
import type { DashboardResponse, DashboardFilterParams } from '../types/cartera';
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

export interface ControlNode extends AggNode { gestor?: string; gestores?: ControlNode[]; }
export interface Contadores { gestores: number; gerentes: number; zonas: number; }
export interface ControlDashboard extends DashboardResponse { contadores: Contadores; }
export interface Indicadores {
  gestiones: number; llamadas: number; sms: number; whatsapp: number; correos: number; contactabilidad: number;
  promesas: number; cumplimientoPromesas: number; cartasEmitidas: number; cartasAprobadas: number; acuerdos: number; adjuntos: number;
}
export interface Pendientes { promesas: Array<Record<string, unknown>>; cartas: Array<Record<string, unknown>>; }

export const getControlDashboard = async (f?: DashboardFilterParams): Promise<ControlDashboard> => { const r = await apiFetch(`/api/control/dashboard${qs(f)}`, { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const getControlGestores = async (f?: DashboardFilterParams): Promise<ControlNode[]> => { const r = await apiFetch(`/api/control/gestores${qs(f)}`, { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const getControlZonas = async (f?: DashboardFilterParams): Promise<ControlNode[]> => { const r = await apiFetch(`/api/control/zonas${qs(f)}`, { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const getControlPdCampanas = async (f?: DashboardFilterParams): Promise<ControlNode[]> => { const r = await apiFetch(`/api/control/pd-campanas${qs(f)}`, { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const getControlCuentas = async (f?: DashboardFilterParams): Promise<Array<Record<string, unknown>>> => { const r = await apiFetch(`/api/control/cuentas${qs(f)}`, { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const getIndicadores = async (): Promise<Indicadores> => { const r = await apiFetch('/api/control/indicadores', { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const getPendientes = async (): Promise<Pendientes> => { const r = await apiFetch('/api/control/pendientes', { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };

// ===== Calidad de Gestión =====
export interface CalidadEvaluacion {
  id: string; gestor_nombre: string; pais: string | null; zona: string | null; cuenta: string | null;
  tipificacion: string | null; nota: number; observaciones: string | null; created_at: string;
}
export interface CalidadGrupo { clave: string; nota: number; evaluaciones: number; }
export interface CalidadResumen {
  notaGlobal: number; evaluaciones: number;
  porGestor: CalidadGrupo[]; porPais: CalidadGrupo[]; porZona: CalidadGrupo[];
  penalizaciones: Array<{ clave: string; total: number }>;
}
export interface CalidadGestor { usuarioId: string | null; nombre: string; }
export interface CalidadPayload {
  gestorId?: string | null; gestorNombre: string; pais?: string | null; zona?: string | null; cuenta?: string | null;
  tipificacion?: string | null; criterios: Record<string, number>; penalizaciones: Record<string, number>; observaciones?: string | null;
}

export const getCalidadGestores = async (): Promise<CalidadGestor[]> => { const r = await apiFetch('/api/control/calidad/gestores', { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const getCalidadResumen = async (f?: DashboardFilterParams): Promise<CalidadResumen> => { const r = await apiFetch(`/api/control/calidad/resumen${qs(f)}`, { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const getCalidadEvaluaciones = async (f?: DashboardFilterParams): Promise<CalidadEvaluacion[]> => { const r = await apiFetch(`/api/control/calidad${qs(f)}`, { cache: 'no-store' }); if (!r.ok) throw new Error(await err(r, 'No se pudo cargar.')); return r.json(); };
export const crearEvaluacionCalidad = async (payload: CalidadPayload): Promise<{ id: string; nota: number }> => {
  const r = await apiFetch('/api/control/calidad', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(await err(r, 'No se pudo guardar la evaluación.'));
  return r.json();
};

/** Rúbrica de calidad de gestión (criterios y penalizaciones), reutilizable por el frontend. */
export const CALIDAD_RUBRICA: Array<{ seccion: string; items: string[] }> = [
  { seccion: 'Apertura', items: ['Saludos', 'Identificación', 'Confirmación de remitente'] },
  { seccion: 'Motivo de la llamada', items: ['Condiciones y motivo de la llamada', 'Información de la cuenta'] },
  { seccion: 'Gestión y negociación', items: ['Solicitud de pago', 'Indagación sobre la situación', 'Manejo de objeciones', 'Resolución y/o negociación'] },
  { seccion: 'Cierre', items: ['Confirmación y resumen de resolución', 'Beneficios y consecuencias', 'Despedida'] }
];
export const CALIDAD_PENALIZACIONES: Array<{ clave: string; puntos: number }> = [
  { clave: 'Mala tipificación', puntos: 10 },
  { clave: 'Errores de registro', puntos: 10 },
  { clave: 'Tiempos: exceso o premura', puntos: 5 },
  { clave: 'Lenguaje no permitido', puntos: 20 }
];
