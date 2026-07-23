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

export interface GroupSummaryItem {
  key: string;
  pais: string;
  paisAbbr: string;
  cuentas: number;
  saldoAsignadoUsd: number;
  saldoActualUsd: number;
  saldoAsignadoLocal: number;
  saldoActualLocal: number;
  recuperadoUsd: number;
  recuperadoLocal: number;
  porcentajeRecuperacion: number;
}

export interface CountrySummaryItem {
  pais: string;
  abbr: string;
  flag: string;
  cuentas: number;
  saldoAsignadoUsd: number;
  saldoActualUsd: number;
  recuperadoUsd: number;
  porcentajeRecuperacion: number;
}

export interface CampaniaSummaryItem {
  campania: string;
  cuentas: number;
  saldoAsignadoUsd: number;
  saldoActualUsd: number;
  saldoAsignadoLocal: number;
  saldoActualLocal: number;
  recuperadoUsd: number;
  porcentajeRecuperacion: number;
  promesas: number;
  pagos: number;
}

export interface DashboardFilterOptions {
  pais: string[];
  gestor: string[];
  gerente: string[];
  zona: string[];
  pd: string[];
  campania: string[];
}

export interface DashboardResponse {
  kpis: Kpis;
  paises: AggregationItem[];
  pds: AggregationItem[];
  topGestores: TopGestorItem[];
  topZonas: TopZonaItem[];
  resumenPD: ResumenPdItem[];
  // Datos agregados adicionales para que el frontend no descargue la cartera completa.
  topGestoresDetalle: GroupSummaryItem[];
  topZonasDetalle: GroupSummaryItem[];
  resumenCampania: CampaniaSummaryItem[];
  countrySummary: CountrySummaryItem[];
  filterOptions: DashboardFilterOptions;
  cuentas: Record<string, unknown>[];
}

export interface InteligenciaResponse {
  topCuentas: InteligenciaAccount[];
  riesgos: RiesgoItem[];
  rankingGestores: RankingGestorItem[];
  rankingPaises: RankingPaisItem[];
}
