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
  pd?: string | null; plantilla_clave?: string | null; contenido?: string | null;
}
/** Detalle completo de una carta: logo/firma SIEMPRE null si aún no está
 *  autorizada (lo decide el backend por `estado`, nunca el cliente). */
export interface CartaDetalle extends CartaGestion {
  logoUrl: string | null; firmaUrl: string | null; descargable: boolean;
}
/** Vista previa EN VIVO bloqueada al PD actual de la cuenta — nunca una plantilla elegida manualmente. */
export interface CartaPreview {
  pd: string | null; disponible: boolean; plantillaClave: string | null; contenido: string | null; variablesFaltantes: string[];
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

/** Gestión > Tipificaciones: cada cuenta dentro del alcance/filtros del
 *  usuario, clasificada por su ÚLTIMA gestión registrada y enriquecida con
 *  su promesa más reciente (si tiene alguna) — una sola llamada; el backend
 *  ya aplica el mismo alcance/filtros que el resto de Gestión. */
export interface CuentaTipificada {
  codigo: string; nombre: string; pais: string; zona: string; gestor: string;
  pdActual: string; campaniaAdeuda: string; saldoActual: number;
  tipificacion: string | null;
  fechaGestion: string | null;
  comentarioGestion: string | null;
  tipoContacto: string | null;
  canal: string | null;
  fechaPromesa: string | null;
  montoPromesa: number | null;
  monedaPromesa: string | null;
  estadoPromesa: string | null;
  telefono: string | null;
}
export const getTipificaciones = async (filters?: DashboardFilterParams): Promise<CuentaTipificada[]> => {
  const res = await apiFetch(`/api/gestion/tipificaciones${qs(filters)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudieron cargar las tipificaciones.'));
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

/** Vista previa EN VIVO (sin guardar nada) de la carta para el PD ACTUAL de
 *  la cuenta — el backend decide la plantilla; el cliente nunca elige una. */
export const getCartaPreview = async (codigo: string): Promise<CartaPreview> => {
  const res = await apiFetch(`/api/gestion/cuentas/${encodeURIComponent(codigo)}/carta-preview`, { cache: 'no-store' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo generar la vista previa.'));
  return res.json();
};

/** Genera y guarda la carta. Ya NO se envía `tipo`/plantilla: el backend la
 *  determina él mismo a partir del PD actual de la cuenta. */
export const crearCarta = async (codigo: string, comentario: string) => {
  const res = await apiFetch(`/api/gestion/cuentas/${encodeURIComponent(codigo)}/cartas`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comentario })
  });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo crear la carta.'));
};

/** Resultado de un lote de "Generar cartas" (Cuentas: selección múltiple).
 *  `noGeneradas` siempre trae el motivo REAL devuelto por el motor (el
 *  mismo que la generación individual) — nunca un motivo inventado. */
export interface ResultadoCartasMasivo {
  total: number; generadas: number; noGeneradas: number;
  detalle: {
    generadas: Array<{ codigo: string; id: string }>;
    noGeneradas: Array<{ codigo: string; motivo: string }>;
  };
}

/** Genera cartas para VARIAS cuentas en UN solo request (nunca una llamada
 *  por cuenta). El backend decide, por cuenta, la plantilla (por su PD
 *  actual) y el alcance (revalida cada código recibido) — igual que la
 *  generación individual, nunca duplicado aquí. */
export const crearCartasMasivo = async (codigos: string[], comentario: string): Promise<ResultadoCartasMasivo> => {
  const res = await apiFetch('/api/gestion/cartas/lote', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigos, comentario })
  });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudieron generar las cartas.'));
  return res.json();
};

export const getCartas = async (estado?: string): Promise<CartaGestion[]> => {
  const res = await apiFetch(`/api/gestion/cartas${estado ? `?estado=${encodeURIComponent(estado)}` : ''}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudieron cargar las cartas.'));
  return res.json();
};

/** Detalle de una carta puntual: logo/firma solo si ya está autorizada. */
export const getCartaDetalle = async (id: string): Promise<CartaDetalle> => {
  const res = await apiFetch(`/api/gestion/cartas/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo cargar la carta.'));
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

/** "Mi firma de autorización" (autoservicio): la firma predeterminada del
 *  usuario AUTENTICADO, usada automáticamente al autorizar cartas — nunca
 *  elegible manualmente, nunca de otro usuario. */
export interface FirmaAutorizacion { configurada: boolean; url: string | null; }
export const getFirmaAutorizacion = async (): Promise<FirmaAutorizacion> => {
  const res = await apiFetch('/api/gestion/firma-autorizacion', { cache: 'no-store' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo cargar tu firma de autorización.'));
  return res.json();
};
export const subirFirmaAutorizacion = async (file: File): Promise<{ path: string }> => {
  const f = new FormData(); f.append('file', file);
  const res = await apiFetch('/api/gestion/firma-autorizacion', { method: 'POST', body: f });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo subir tu firma.'));
  return res.json();
};

/** Autoriza en lote una selección de cartas pendientes — la firma SIEMPRE es
 *  la firma predeterminada del usuario autenticado (nunca elegida en esta
 *  llamada). El backend re-valida alcance/estado de CADA carta: `omitidas`
 *  informa cuáles no pudieron autorizarse y por qué. */
export interface AutorizarCartasMasivoResultado {
  autorizadas: string[];
  omitidas: Array<{ id: string; motivo: string }>;
}
export const autorizarCartasMasivo = async (ids: string[], comentario?: string): Promise<AutorizarCartasMasivoResultado> => {
  const res = await apiFetch('/api/gestion/cartas/autorizar-masivo', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, comentario: comentario ?? null })
  });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudieron autorizar las cartas.'));
  return res.json();
};

/**
 * Catálogo activo (fuente única: Configuración → config_catalogos).
 * Devuelve los nombres activos; si el catálogo está vacío, el caller usa su fallback.
 */
export const getCatalogo = async (catalogo: string): Promise<string[]> => {
  const res = await apiFetch(`/api/catalogos/${encodeURIComponent(catalogo)}`, { cache: 'no-store' });
  if (!res.ok) return [];
  const data = (await res.json()) as Array<{ nombre: string }>;
  return data.map((x) => x.nombre).filter(Boolean);
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
