import { apiFetch } from './apiClient';

export interface CentroFiltros {
  pais?: string[]; zona?: string[]; pd?: string[]; gestor?: string[]; sector?: string[]; riesgo?: string[];
}
export interface CentroGrupo { clave: string; saldoAsignadoUsd: number; saldoActualUsd: number; recuperadoUsd: number; cuentas: number; pctRecuperacion: number; }
export interface CentroMontoGrupo { clave: string; montoUsd: number; }
export interface CentroHallazgo {
  categoria: 'Gestión' | 'Cartera' | 'Calendario' | 'Operación';
  nivel: 'Crítico' | 'Atención' | 'Informativo' | 'Positivo';
  titulo: string; detalle: string; valor?: string;
}
export interface CentroHistorico {
  periodo: string; saldoAsignadoUsd: number; saldoActualUsd: number; recuperadoUsd: number; cuentas: number;
  pctRecuperacion: number; metaUsd: number | null; cumplimientoPct: number | null;
}
export interface CentroInteligencia {
  periodo: string;
  dias: { transcurridos: number; total: number; restantes: number };
  kpis: {
    saldoAsignadoUsd: number; saldoActualUsd: number; recuperadoUsd: number;
    saldoAsignadoLocal: number; saldoActualLocal: number; recuperadoLocal: number;
    cuentas: number; pctRecuperacion: number;
  };
  meta: { definida: boolean; montoUsd: number | null; ambito: string };
  metasPorPais: Array<{ pais: string; montoUsd: number }>;
  metasPorPD: Array<{ pd: string; montoUsd: number }>;
  cumplimiento: { pct: number | null };
  recuperacion: { porPais: CentroGrupo[]; porPD: CentroGrupo[]; porZona: CentroGrupo[]; porSector: CentroGrupo[]; porRiesgo: CentroGrupo[] };
  promesas: {
    totalUsd: number; vigentesUsd: number; vencidasUsd: number; cumplidasUsd: number;
    cantidad: number; cantidadVigentes: number; cantidadVencidas: number; cantidadCumplidas: number;
    porPais: CentroMontoGrupo[]; porPD: CentroMontoGrupo[];
  };
  proyeccion: {
    recuperacionActualUsd: number; ritmoDiarioUsd: number; recuperacionProyectadaUsd: number;
    diferenciaVsMetaUsd: number | null; cumplimientoProyectadoPct: number | null; estado: string;
  };
  hallazgos: CentroHallazgo[];
  historico: CentroHistorico[];
  calidad: { notaGlobal: number | null; evaluaciones: number; penalizaciones: Array<{ clave: string; total: number }> };
  filtros: CentroFiltros;
  filterOptions: { pais: string[]; zona: string[]; sector: string[]; pd: string[]; riesgo: string[]; gestor: string[] };
}

const qs = (f: CentroFiltros): string => {
  const p = new URLSearchParams();
  (Object.entries(f) as Array<[string, string[] | undefined]>).forEach(([k, v]) => {
    const list = (v ?? []).map((x) => x.trim()).filter(Boolean);
    if (list.length) p.set(k, list.join(','));
  });
  const str = p.toString();
  return str ? `?${str}` : '';
};

const parseError = async (res: Response, fallback: string): Promise<string> => {
  if (res.status === 401) return 'Tu sesión ha expirado. Inicia sesión nuevamente.';
  if (res.status === 403) return 'No tienes permisos para acceder a esta información.';
  const body = await res.json().catch(() => null);
  return (body && (body as { error?: string }).error) || fallback;
};

export const getCentroInteligencia = async (filtros: CentroFiltros = {}): Promise<CentroInteligencia> => {
  const res = await apiFetch(`/api/inteligencia/centro${qs(filtros)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(await parseError(res, 'No se pudo cargar el Centro de Inteligencia.'));
  return res.json();
};
