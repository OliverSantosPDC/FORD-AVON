import { apiFetch } from './apiClient';
import type { DashboardResponse, DashboardFilterParams, CarteraRecord } from '../types/cartera';

const qs = (filters?: DashboardFilterParams): string => {
  if (!filters) return '';
  const p = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (Array.isArray(v)) { const n = v.map((x) => x.trim()).filter(Boolean); if (n.length) p.set(k, n.join(',')); }
    else if (typeof v === 'string' && v.trim()) p.set(k, v.trim());
  });
  return p.toString() ? `?${p.toString()}` : '';
};

const parseError = async (res: Response, fallback: string): Promise<string> => {
  if (res.status === 401) return 'Tu sesión ha expirado. Inicia sesión nuevamente.';
  if (res.status === 403) return 'No tienes permisos para acceder a esta información.';
  const body = await res.json().catch(() => null);
  return (body && (body as { error?: string }).error) || fallback;
};

export interface CartaGestion {
  id: string; codigo: string; tipo: string; estado: string; comentario: string | null;
  gestor_id: string | null; aprobado_por: string | null; comentario_aprobacion: string | null; created_at: string;
}
export interface DetalleCuenta {
  historial: Array<Record<string, unknown>>;
  promesas: Array<Record<string, unknown>>;
  adjuntos: Array<Record<string, unknown>>;
  cartas: CartaGestion[];
}

export const getGestionDashboard = async (filters?: DashboardFilterParams): Promise<DashboardResponse> => {
  const res = await apiFetch(`/api/gestion/dashboard${qs(filters)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo cargar la gestión.'));
  return res.json();
};

export interface AggNode {
  key: string; cuentas: number; saldoLocal: number; saldoUsd: number; asignadoUsd: number; recuperadoUsd: number; pctRecuperacion: number;
  zona?: string; pais?: string; pd?: string; campania?: string;
  pds?: AggNode[]; campanas?: AggNode[];
}
export interface EstadoCuenta { ultimaTipificacion: string | null; ultimaFecha: string | null; promesaVigente: string | null; }

export const getZonasPd = async (filters?: DashboardFilterParams): Promise<AggNode[]> => {
  const res = await apiFetch(`/api/gestion/zonas-pd${qs(filters)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudieron cargar las zonas.'));
  return res.json();
};
export const getPdCampanas = async (filters?: DashboardFilterParams): Promise<AggNode[]> => {
  const res = await apiFetch(`/api/gestion/pd-campanas${qs(filters)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudieron cargar los PD/campañas.'));
  return res.json();
};
export const getEstadoCuentas = async (codigos: string[]): Promise<Record<string, EstadoCuenta>> => {
  const res = await apiFetch('/api/gestion/estado', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigos }) });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo cargar el estado.'));
  return res.json();
};

export const getGestionCuentas = async (filters?: DashboardFilterParams): Promise<CarteraRecord[]> => {
  const res = await apiFetch(`/api/gestion/cuentas${qs(filters)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudieron cargar las cuentas.'));
  return res.json();
};

export const getDetalleCuenta = async (codigo: string): Promise<DetalleCuenta> => {
  const res = await apiFetch(`/api/gestion/cuentas/${encodeURIComponent(codigo)}/detalle`, { cache: 'no-store' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo cargar el detalle.'));
  return res.json();
};

export const getInfoCuenta = async (codigo: string): Promise<Record<string, unknown>> => {
  const res = await apiFetch(`/api/gestion/cuentas/${encodeURIComponent(codigo)}/info`, { cache: 'no-store' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo cargar la información.'));
  return res.json();
};

export const tipificarCuenta = async (codigo: string, body: { tipificacion: string; comentario?: string; tipoContacto?: string; canal?: string }) => {
  const res = await apiFetch(`/api/gestion/cuentas/${encodeURIComponent(codigo)}/tipificacion`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo tipificar.'));
};

export const crearPromesa = async (codigo: string, body: { fechaPromesa: string; monto?: number; moneda?: string; comentario?: string }) => {
  const res = await apiFetch(`/api/gestion/cuentas/${encodeURIComponent(codigo)}/promesa`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo crear la promesa.'));
};

export const subirAdjunto = async (codigo: string, tipo: string, file: File) => {
  const form = new FormData();
  form.append('file', file);
  form.append('tipo', tipo);
  const res = await apiFetch(`/api/gestion/cuentas/${encodeURIComponent(codigo)}/adjuntos`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo subir el adjunto.'));
};

export const crearCarta = async (codigo: string, tipo: string, comentario: string) => {
  const res = await apiFetch(`/api/gestion/cuentas/${encodeURIComponent(codigo)}/cartas`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo, comentario })
  });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo crear la carta.'));
};

export const getCartas = async (estado?: string): Promise<CartaGestion[]> => {
  const res = await apiFetch(`/api/gestion/cartas${estado ? `?estado=${encodeURIComponent(estado)}` : ''}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudieron cargar las cartas.'));
  return res.json();
};

export const aprobarCarta = async (id: string, comentario: string) => {
  const res = await apiFetch(`/api/gestion/cartas/${id}/aprobar`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comentario }) });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo aprobar.'));
};

export const rechazarCarta = async (id: string, comentario: string) => {
  const res = await apiFetch(`/api/gestion/cartas/${id}/rechazar`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comentario }) });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo rechazar.'));
};

export const MONEDA_POR_PAIS: Record<string, string> = {
  'EL SALVADOR': 'USD', 'GUATEMALA': 'GTQ', 'HONDURAS': 'HNL',
  'NICARAGUA': 'NIO', 'PANAMÁ': 'USD', 'PANAMA': 'USD', 'REPÚBLICA DOMINICANA': 'DOP', 'REPUBLICA DOMINICANA': 'DOP'
};
export const SIGLAS_PAIS: Record<string, string> = {
  'EL SALVADOR': 'SV', 'GUATEMALA': 'GT', 'HONDURAS': 'HN',
  'NICARAGUA': 'NI', 'PANAMÁ': 'PA', 'PANAMA': 'PA', 'REPÚBLICA DOMINICANA': 'DO', 'REPUBLICA DOMINICANA': 'DO'
};
export const siglaPais = (p: string): string => SIGLAS_PAIS[(p ?? '').toUpperCase()] ?? (p ?? '').slice(0, 2).toUpperCase();
export const TIPO_CONTACTO = ['Representante', 'Gerente de Zona', 'Tercero'];
export const CANALES = ['Llamada', 'SMS', 'WhatsApp', 'Correo'];
export const TIPIFICACIONES = [
  'PROMESA DE PAGO', 'PAGO POR REFLEJAR', 'SEGUIMIENTO A PROMESA', 'RECADO', 'NEGATIVA DE PAGO',
  'ABANDONO DE LLAMADA', 'NO RECONOCE LA DEUDA', 'ENTREGO DINERO A LA EMPRESARIA', 'AMENAZA DE DEMANDA', 'Sin Resultado'
];
