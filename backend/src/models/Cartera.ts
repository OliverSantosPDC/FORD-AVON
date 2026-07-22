export interface Cartera {
  pais: string;
  pd: string;
  saldoAsignado: number;
  saldoActual: number;
  saldoInicialLocal: number;
  saldoActualLocal: number;
  fecha?: string;
  gestor?: string;
  gerente?: string;
  zona?: string;
  cliente?: string;
  campania?: string;
  codigo?: string;
  nombre?: string;
  original?: Record<string, unknown>;
}

export interface Kpis {
  saldoAsignado: number;
  saldoActual: number;
  recuperado: number;
  porcentajeRecuperacion: number;
  totalCuentas: number;
}

export interface AggregationItem {
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

export interface DashboardFilterParams {
  pais?: string[];
  gestor?: string[];
  gerente?: string[];
  zona?: string[];
  pd?: string[];
  campania?: string[];
  fecha?: string[];
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

export interface DashboardResponse {
  kpis: Kpis;
  paises: AggregationItem[];
  pds: AggregationItem[];
  topGestores: TopGestorItem[];
  topZonas: TopZonaItem[];
  resumenPD: ResumenPdItem[];
}

export interface InteligenciaResponse {
  topCuentas: InteligenciaAccount[];
  riesgos: RiesgoItem[];
  rankingGestores: RankingGestorItem[];
  rankingPaises: RankingPaisItem[];
}
