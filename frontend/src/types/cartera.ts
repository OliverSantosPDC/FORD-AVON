export type CarteraRecord = Record<string, unknown>;

export interface DashboardFilterParams {
  pais?: string | string[];
  gestor?: string | string[];
  gerente?: string | string[];
  zona?: string | string[];
  pd?: string | string[];
  campania?: string | string[];
}

export interface DashboardMultiFilterParams {
  pais: string[];
  gestor: string[];
  gerente: string[];
  zona: string[];
  pd: string[];
  campania: string[];
}

export interface DashboardKpi {
  saldoAsignado: number;
  saldoActual: number;
  recuperado: number;
  porcentajeRecuperacion: number;
  totalCuentas: number;
}

export interface DashboardItem {
  nombre: string;
  totalUsd: number;
  totalLocal: number;
}

export interface TopGestorItem {
  nombre: string;
  recuperadoUsd: number;
  recuperadoLocal: number;
  cuentas: number;
}

export interface TopZonaItem {
  zona: string;
  saldoActualUsd: number;
  saldoActualLocal: number;
  cuentas: number;
}

export interface ResumenPdItem {
  pd: string;
  cuentas: number;
  saldoActualUsd: number;
  saldoAsignadoUsd: number;
  recuperadoUsd: number;
  porcentajeRecuperacionUsd: number;
  saldoActualLocal: number;
  saldoAsignadoLocal: number;
  recuperadoLocal: number;
  porcentajeRecuperacionLocal: number;
}

export interface DashboardResponse {
  kpis: DashboardKpi;
  paises: DashboardItem[];
  pds: DashboardItem[];
  topGestores: TopGestorItem[];
  topZonas: TopZonaItem[];
  resumenPD: ResumenPdItem[];
}

export interface InteligenciaAccount {
  codigo: string;
  nombre: string;
  pais: string;
  gestor: string;
  pd: string;
  saldoActual: number;
}

export interface RiesgoItem {
  pd: string;
  cuentas: number;
  saldoActual: number;
}

export interface RankingGestorItem {
  nombre: string;
  cuentas: number;
  saldoAsignado: number;
  saldoActual: number;
  recuperado: number;
  porcentajeRecuperacion: number;
}

export interface RankingPaisItem {
  pais: string;
  cuentas: number;
  saldoActual: number;
  recuperado: number;
  porcentajeRecuperacion: number;
}

export interface InteligenciaResponse {
  topCuentas: InteligenciaAccount[];
  riesgos: RiesgoItem[];
  rankingGestores: RankingGestorItem[];
  rankingPaises: RankingPaisItem[];
}

export interface CarteraState {
  data: CarteraRecord[];
  loading: boolean;
  error: string | null;
}
