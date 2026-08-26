import { CarteraRepository } from '../repositories/CarteraRepository';
import {
  Cartera,
  DashboardResponse,
  Kpis,
  AggregationItem,
  DashboardFilterParams,
  InteligenciaResponse,
  InteligenciaAccount,
  RiesgoItem,
  RankingGestorItem,
  RankingPaisItem,
  ZonaSectorSummaryItem
} from '../models/Cartera';
import {
  aggregateTopGestores,
  aggregateTopZonas,
  aggregateResumenCampania,
  aggregateCountrySummary,
  buildFilterOptions,
  filterCarteraRows,
  DashboardMultiFilterParams,
  CarteraRow
} from '../utils/carteraAggregations';
import { applyScope } from './ScopeFilter';
import type { ScopeContext } from './ScopeService';
import { getSupabaseClient } from '../config/supabaseClient';

export class CarteraService {
  private readonly repository: CarteraRepository;

  constructor(repository: CarteraRepository) {
    this.repository = repository;
  }

  /**
   * GESTOR EFECTIVO (centralizado). Devuelve la asignación VIGENTE por cuenta:
   * la más reciente en `asignaciones` (AUTO o MANUAL) gana. Una sola consulta
   * (sin N+1). La cartera original NO se modifica: solo se usa para resolver
   * el gestor efectivo en memoria.
   */
  private async getAsignacionesVigentes(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const { data, error } = await getSupabaseClient()
      .from('asignaciones')
      .select('codigo, gestor_nuevo, created_at')
      .order('created_at', { ascending: false })
      .limit(200000);
    if (error || !data) return map;
    for (const row of data as Array<{ codigo: string | null; gestor_nuevo: string | null }>) {
      const codigo = row.codigo ?? '';
      const gestor = row.gestor_nuevo ?? '';
      // Como viene ordenado desc por fecha, la PRIMERA aparición de cada código es la vigente.
      if (codigo && gestor && !map.has(codigo)) map.set(codigo, gestor);
    }
    return map;
  }

  /**
   * Aplica el override de asignación SOBRE filas ya acotadas por scope.
   * Seguridad: primero el alcance (sobre el gestor ORIGINAL), luego el gestor
   * efectivo para visualización/agregación. No muta las filas cacheadas: clona
   * solo las filas con override y conserva `gestor_original`.
   */
  private async overlayEffectiveGestor(scoped: CarteraRow[]): Promise<CarteraRow[]> {
    if (scoped.length === 0) return scoped;
    const vigentes = await this.getAsignacionesVigentes();
    if (vigentes.size === 0) return scoped;
    return scoped.map((row) => {
      const codigo = String(row.codigo ?? row.code ?? row.id ?? '');
      const efectivo = codigo ? vigentes.get(codigo) : undefined;
      if (!efectivo || efectivo === row.gestor) return row;
      return { ...row, gestor: efectivo, gestor_original: row.gestor ?? null };
    });
  }

  /**
   * Devuelve registros de cartera. Acepta filtros y un límite opcional para
   * regresar ÚNICAMENTE los registros necesarios (evita descargar los 20k).
   * Sin parámetros, mantiene el comportamiento anterior (devuelve todo).
   */
  async listCartera(
    filters: DashboardFilterParams | undefined,
    limit: number | undefined,
    scopeContext: ScopeContext
  ): Promise<Record<string, unknown>[]> {
    // 1) Datos crudos/globales (caché global; nunca se cachea ya filtrado por usuario).
    const rows = (await this.repository.getCartera()) as CarteraRow[];

    // 2) FRONTERA DE SEGURIDAD: aplicar el alcance ANTES de los filtros del
    //    usuario y ANTES de paginar. Global ⇒ todas; no global ⇒ solo su scope;
    //    scope vacío ⇒ cero filas. El scope SIEMPRE proviene del backend.
    const scopedOriginal = applyScope(rows, scopeContext, {
      gestorField: 'gestor',
      zonaField: 'zona',
      paisField: 'pais'
    });

    // 2.b) GESTOR EFECTIVO: override de asignación vigente, DESPUÉS del scope
    //      (seguridad primero) y ANTES de los filtros del usuario (para que el
    //      filtro por gestor use el gestor efectivo).
    const scoped = await this.overlayEffectiveGestor(scopedOriginal);

    // 3) Filtros de búsqueda del usuario (solo pueden ESTRECHAR, nunca ampliar).
    const multi = toMultiFilters(filters);
    const hasFilters = Object.values(multi).some((list) => list.length > 0);
    const filtered = hasFilters ? filterCarteraRows(scoped, multi) : scoped;

    // 4) Límite/paginación, siempre al final.
    if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
      return filtered.slice(0, Math.floor(limit));
    }
    return filtered;
  }

  async getDashboard(
    filters: DashboardFilterParams | undefined,
    scopeContext: ScopeContext
  ): Promise<DashboardResponse> {
    // === INSTRUMENTACIÓN TEMPORAL (remover tras el diagnóstico) ===
    const tRead = Date.now();
    const rawRows = (await this.repository.getCartera()) as CarteraRow[];
    console.log(`[PERF] service: lectura de datos (repository.getCartera) = ${Date.now() - tRead} ms, filas=${rawRows.length}`);

    // FRONTERA DE SEGURIDAD: aplicar el alcance ANTES de cualquier agregación.
    // TODAS las métricas, rankings, resúmenes y opciones de filtro se derivan de
    // `rows` (ya acotado). Global ⇒ todas; no global ⇒ solo su scope;
    // scope vacío ⇒ cero filas (KPIs en cero, sin datos globales).
    const scopedOriginal = applyScope(rawRows, scopeContext, {
      gestorField: 'gestor',
      zonaField: 'zona',
      paisField: 'pais'
    });
    // Gestor efectivo (override de asignación) tras el scope; todas las agregaciones
    // y rankings se derivan de `rows`, por lo que reflejan el gestor efectivo.
    const rows = await this.overlayEffectiveGestor(scopedOriginal);

    const tAgg = Date.now();

    // === INSTRUMENTACIÓN DETALLADA TEMPORAL (remover tras el diagnóstico) ===
    const step = <T>(label: string, fn: () => T): T => {
      const t = Date.now();
      const result = fn();
      console.log(`[PERF_DETAIL] ${label} = ${Date.now() - t} ms`);
      return result;
    };

    const cartera = step('map (rows.map(mapToCartera))', () => rows.map(mapToCartera));
    const filtered = step('applyFilters', () => applyFilters(cartera, filters));

    const multi = toMultiFilters(filters);
    const rawFiltered = step('filterCarteraRows (rawFiltered)', () => filterCarteraRows(rows, multi));

    const kpis = step('calculateKpis', () => calculateKpis(filtered));
    const paises = step("aggregateBy('pais')", () => aggregateBy(filtered, 'pais'));
    const pds = step("aggregateBy('pd')", () => aggregateBy(filtered, 'pd'));
    const topGestores = step('calculateTopGestores', () => calculateTopGestores(filtered));
    const topZonas = step('calculateTopZonas', () => calculateTopZonas(filtered));
    const resumenPD = step('calculateResumenPD', () => calculateResumenPD(filtered));
    const topGestoresDetalle = step('aggregateTopGestores (detalle, sin filtros)', () => aggregateTopGestores(rows, 20));
    const topZonasDetalle = step('aggregateTopZonas (detalle, sin filtros)', () => aggregateTopZonas(rows, 20));
    const resumenCampania = step('aggregateResumenCampania', () => aggregateResumenCampania(rawFiltered));
    const countrySummary = step('aggregateCountrySummary', () => aggregateCountrySummary(rawFiltered));
    const zonaSectorSummary = step('aggregateZonaSector', () => aggregateZonaSector(filtered));
    const filterOptions = step('buildFilterOptions', () => buildFilterOptions(rows, multi));
    const cuentas = step('cuentas (rawFiltered.slice 100)', () => rawFiltered.slice(0, 100));

    const response: DashboardResponse = {
      kpis,
      paises,
      pds,
      topGestores,
      topZonas,
      resumenPD,
      topGestoresDetalle,
      topZonasDetalle,
      resumenCampania,
      countrySummary,
      zonaSectorSummary,
      filterOptions,
      cuentas
    };
    console.log(`[PERF] service: procesamiento/agregaciones = ${Date.now() - tAgg} ms`);
    // === FIN INSTRUMENTACIÓN TEMPORAL ===

    return response;
  }

  async getInteligencia(scopeContext: ScopeContext): Promise<InteligenciaResponse> {
    // 1) Datos crudos/globales (caché global). 2) FRONTERA DE SEGURIDAD: aplicar
    //    el alcance ANTES de mapear y de cualquier cálculo/ranking/top N.
    //    Global ⇒ todas; no global ⇒ solo su scope; scope vacío ⇒ cero filas.
    const rawRows = (await this.repository.getCartera()) as CarteraRow[];
    const scopedOriginal = applyScope(rawRows, scopeContext, {
      gestorField: 'gestor',
      zonaField: 'zona',
      paisField: 'pais'
    });
    const rows = await this.overlayEffectiveGestor(scopedOriginal);
    const cartera = rows.map(mapToCartera);

    return {
      topCuentas: calculateTopCuentas(cartera),
      riesgos: calculateRiesgos(cartera),
      rankingGestores: calculateRankingGestores(cartera),
      rankingPaises: calculateRankingPaises(cartera)
    };
  }
}

/** Normaliza los filtros del dashboard a listas de strings (formato multi). */
const toList = (value?: string | string[]): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const toMultiFilters = (filters?: DashboardFilterParams): DashboardMultiFilterParams => ({
  pais: toList(filters?.pais),
  gestor: toList(filters?.gestor),
  gerente: toList(filters?.gerente),
  zona: toList(filters?.zona),
  pd: toList(filters?.pd),
  campania: toList(filters?.campania)
});

const parseNumber = (value: unknown): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, '').replace(/\./g, '').replace(/,/g, '.').replace(/[^0-9.-]/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
};

// Índice de claves en minúsculas cacheado POR FILA (se construye a lo sumo una
// vez por fila, y sólo si el acceso directo falla). Evita reconstruir un Map y
// hacer toLowerCase() de todas las claves en cada llamada a getField.
const lowerKeyIndexCache = new WeakMap<Record<string, unknown>, Record<string, unknown>>();

const getLowerKeyIndex = (row: Record<string, unknown>): Record<string, unknown> => {
  let index = lowerKeyIndexCache.get(row);
  if (!index) {
    index = {};
    for (const key of Object.keys(row)) {
      index[key.toLowerCase()] = row[key];
    }
    lowerKeyIndexCache.set(row, index);
  }
  return index;
};

const getField = (row: Record<string, unknown>, ...keys: string[]) => {
  // Ruta rápida: las claves de Supabase ya vienen en minúsculas -> acceso directo.
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  // Respaldo insensible a mayúsculas (raro): índice lowercased cacheado por fila.
  const index = getLowerKeyIndex(row);
  for (const key of keys) {
    const value = index[key.toLowerCase()];
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return undefined;
};

const mapToCartera = (row: Record<string, unknown>): Cartera => {
  const castString = (value: unknown, fallback: string) =>
    value === null || value === undefined ? fallback : String(value);

  // Una sola llamada a getField por campo (antes se llamaba dos veces en los
  // opcionales). Valores idénticos a la versión anterior.
  const paisRaw = getField(row, 'pais');
  const pdRaw = getField(row, 'pd_actual', 'pd');
  const fechaRaw = getField(row, 'fecha_de_nacimiento');
  const gestorRaw = getField(row, 'gestor');
  const gerenteRaw = getField(row, 'gerente_zona');
  const zonaRaw = getField(row, 'zona');
  const clienteNombreRaw = getField(row, 'nombre', 'cliente', 'deudor');
  const campaniaRaw = getField(row, 'campania_adeuda', 'campania', 'campaña', 'campaign');
  const codigoRaw = getField(row, 'codigo', 'code', 'id');

  return {
    pais: castString(paisRaw, 'Sin país'),
    pd: castString(pdRaw, 'Sin PD'),
    fecha: fechaRaw ? String(fechaRaw) : undefined,
    saldoInicialLocal: parseNumber(getField(row, 'saldo_inicial') ?? 0),
    saldoActualLocal: parseNumber(getField(row, 'saldo_actual') ?? 0),
    saldoAsignado: parseNumber(getField(row, 'saldo_inicial_usd', 'saldo_inicial') ?? 0),
    saldoActual: parseNumber(getField(row, 'saldo_actual_usd', 'saldo_actual') ?? 0),
    gestor: gestorRaw ? String(gestorRaw) : undefined,
    gerente: gerenteRaw ? String(gerenteRaw) : undefined,
    zona: zonaRaw ? String(zonaRaw) : undefined,
    cliente: clienteNombreRaw ? String(clienteNombreRaw) : undefined,
    campania: campaniaRaw ? String(campaniaRaw) : undefined,
    codigo: codigoRaw ? String(codigoRaw) : undefined,
    nombre: clienteNombreRaw ? String(clienteNombreRaw) : undefined,
    original: row
  };
};

const normalize = (value?: string) => value?.trim().toLocaleLowerCase();
const normalizeList = (values?: string[]) =>
  values?.map((value) => value.trim().toLocaleLowerCase()).filter(Boolean);

const applyFilters = (items: Cartera[], filters?: DashboardFilterParams): Cartera[] => {
  if (!filters) {
    return items;
  }

  const normalized = {
    pais: normalizeList(filters.pais),
    gestor: normalizeList(filters.gestor),
    gerente: normalizeList(filters.gerente),
    zona: normalizeList(filters.zona),
    pd: normalizeList(filters.pd),
    campania: normalizeList(filters.campania),
    fecha: normalizeList(filters.fecha)
  };

  return items.filter((item) => {
    if (normalized.pais && normalized.pais.length && !normalized.pais.includes(item.pais.toLocaleLowerCase())) {
      return false;
    }
    if (normalized.gestor && normalized.gestor.length && !normalized.gestor.includes(item.gestor?.toLocaleLowerCase() ?? '')) {
      return false;
    }
    if (normalized.gerente && normalized.gerente.length && !normalized.gerente.includes(item.gerente?.toLocaleLowerCase() ?? '')) {
      return false;
    }
    if (normalized.zona && normalized.zona.length && !normalized.zona.includes(item.zona?.toLocaleLowerCase() ?? '')) {
      return false;
    }
    if (normalized.pd && normalized.pd.length && !normalized.pd.includes(item.pd.toLocaleLowerCase())) {
      return false;
    }
    if (normalized.campania && normalized.campania.length && !normalized.campania.includes(item.campania?.toLocaleLowerCase() ?? '')) {
      return false;
    }
    if (normalized.fecha && normalized.fecha.length && !normalized.fecha.includes(item.fecha?.toLocaleLowerCase() ?? '')) {
      return false;
    }
    return true;
  });
};

const calculateKpis = (items: Cartera[]): Kpis => {
  const saldoAsignado = items.reduce((sum, item) => sum + item.saldoAsignado, 0);
  const saldoActual = items.reduce((sum, item) => sum + item.saldoActual, 0);
  const recuperado = saldoAsignado - saldoActual;
  const porcentajeRecuperacion = saldoAsignado === 0 ? 0 : Number(((recuperado / saldoAsignado) * 100).toFixed(2));
  const totalCuentas = items.length;

  return {
    saldoAsignado,
    saldoActual,
    recuperado,
    porcentajeRecuperacion,
    totalCuentas
  };
};

const aggregateBy = (items: Cartera[], field: 'pais' | 'pd'): AggregationItem[] => {
  const totals = new Map<string, { totalUsd: number; totalLocal: number }>();

  items.forEach((item) => {
    const key = item[field] || (field === 'pais' ? 'Sin país' : 'Sin PD');
    const existing = totals.get(key) ?? { totalUsd: 0, totalLocal: 0 };
    totals.set(key, {
      totalUsd: existing.totalUsd + item.saldoAsignado,
      totalLocal: existing.totalLocal + item.saldoInicialLocal
    });
  });

  return Array.from(totals.entries())
    .map(([nombre, totals]) => ({ nombre, totalUsd: totals.totalUsd, totalLocal: totals.totalLocal }))
    .sort((a, b) => b.totalUsd - a.totalUsd);
};

const calculateTopGestores = (items: Cartera[]) => {
  const totals = new Map<string, { recuperadoUsd: number; recuperadoLocal: number; cuentas: number }>();

  items.forEach((item) => {
    const gestor = item.gestor || 'Sin gestor';
    const existing = totals.get(gestor) ?? { recuperadoUsd: 0, recuperadoLocal: 0, cuentas: 0 };
    totals.set(gestor, {
      recuperadoUsd: existing.recuperadoUsd + (item.saldoAsignado - item.saldoActual),
      recuperadoLocal: existing.recuperadoLocal + (item.saldoInicialLocal - item.saldoActualLocal),
      cuentas: existing.cuentas + 1
    });
  });

  return Array.from(totals.entries())
    .map(([nombre, values]) => ({
      nombre,
      recuperadoUsd: values.recuperadoUsd,
      recuperadoLocal: values.recuperadoLocal,
      cuentas: values.cuentas
    }))
    .sort((a, b) => b.recuperadoUsd - a.recuperadoUsd)
    .slice(0, 10);
};

const calculateTopZonas = (items: Cartera[]) => {
  const totals = new Map<string, { saldoActualUsd: number; saldoActualLocal: number; cuentas: number }>();

  items.forEach((item) => {
    const zona = item.zona || 'Sin zona';
    const existing = totals.get(zona) ?? { saldoActualUsd: 0, saldoActualLocal: 0, cuentas: 0 };
    totals.set(zona, {
      saldoActualUsd: existing.saldoActualUsd + item.saldoActual,
      saldoActualLocal: existing.saldoActualLocal + item.saldoActualLocal,
      cuentas: existing.cuentas + 1
    });
  });

  return Array.from(totals.entries())
    .map(([zona, values]) => ({ zona, saldoActualUsd: values.saldoActualUsd, saldoActualLocal: values.saldoActualLocal, cuentas: values.cuentas }))
    .sort((a, b) => b.saldoActualUsd - a.saldoActualUsd)
    .slice(0, 10);
};

// Saldos agrupados por Zona y, dentro de cada zona, por Sector. Respeta el mismo
// conjunto `filtered` (ya con scope + filtros del dashboard aplicados).
const aggregateZonaSector = (items: Cartera[]): ZonaSectorSummaryItem[] => {
  const zonas = new Map<string, { usd: number; local: number; cuentas: number; sectores: Map<string, { usd: number; local: number; cuentas: number }> }>();
  items.forEach((item) => {
    const zona = item.zona || 'Sin zona';
    const sectorRaw = getField(item.original ?? {}, 'sector');
    const sector = sectorRaw ? String(sectorRaw) : 'Sin sector';
    const z = zonas.get(zona) ?? { usd: 0, local: 0, cuentas: 0, sectores: new Map() };
    z.usd += item.saldoActual;
    z.local += item.saldoActualLocal;
    z.cuentas += 1;
    const s = z.sectores.get(sector) ?? { usd: 0, local: 0, cuentas: 0 };
    s.usd += item.saldoActual;
    s.local += item.saldoActualLocal;
    s.cuentas += 1;
    z.sectores.set(sector, s);
    zonas.set(zona, z);
  });
  return Array.from(zonas.entries())
    .map(([zona, z]) => ({
      zona,
      saldoActualUsd: z.usd,
      saldoActualLocal: z.local,
      cuentas: z.cuentas,
      sectores: Array.from(z.sectores.entries())
        .map(([sector, s]) => ({ sector, saldoActualUsd: s.usd, saldoActualLocal: s.local, cuentas: s.cuentas }))
        .sort((a, b) => b.saldoActualUsd - a.saldoActualUsd)
    }))
    .sort((a, b) => b.saldoActualUsd - a.saldoActualUsd)
    .slice(0, 20);
};

const calculateResumenPD = (items: Cartera[]) => {
  const totals = new Map<string, {
    saldoActualUsd: number;
    saldoAsignadoUsd: number;
    saldoActualLocal: number;
    saldoInicialLocal: number;
    cuentas: number;
  }>();

  items.forEach((item) => {
    const pd = item.pd || 'Sin PD';
    const existing = totals.get(pd) ?? {
      saldoActualUsd: 0,
      saldoAsignadoUsd: 0,
      saldoActualLocal: 0,
      saldoInicialLocal: 0,
      cuentas: 0
    };
    totals.set(pd, {
      saldoActualUsd: existing.saldoActualUsd + item.saldoActual,
      saldoAsignadoUsd: existing.saldoAsignadoUsd + item.saldoAsignado,
      saldoActualLocal: existing.saldoActualLocal + item.saldoActualLocal,
      saldoInicialLocal: existing.saldoInicialLocal + item.saldoInicialLocal,
      cuentas: existing.cuentas + 1
    });
  });

  return Array.from(totals.entries())
    .map(([pd, values]) => {
      const recuperadoUsd = values.saldoAsignadoUsd - values.saldoActualUsd;
      const porcentajeRecuperacionUsd = values.saldoAsignadoUsd === 0 ? 0 : Number(((recuperadoUsd / values.saldoAsignadoUsd) * 100).toFixed(2));
      const recuperadoLocal = values.saldoInicialLocal - values.saldoActualLocal;
      const porcentajeRecuperacionLocal = values.saldoInicialLocal === 0 ? 0 : Number(((recuperadoLocal / values.saldoInicialLocal) * 100).toFixed(2));
      return {
        pd,
        cuentas: values.cuentas,
        saldoActualUsd: values.saldoActualUsd,
        saldoAsignadoUsd: values.saldoAsignadoUsd,
        recuperadoUsd,
        porcentajeRecuperacionUsd,
        saldoActualLocal: values.saldoActualLocal,
        saldoAsignadoLocal: values.saldoInicialLocal,
        recuperadoLocal,
        porcentajeRecuperacionLocal
      };
    })
    .sort((a, b) => b.saldoAsignadoUsd - a.saldoAsignadoUsd);
};

const calculateTopCuentas = (items: Cartera[]) => {
  return [...items]
    .sort((a, b) => b.saldoActual - a.saldoActual)
    .slice(0, 20)
    .map((item) => ({
      codigo: item.codigo ?? String(item.original?.['codigo'] ?? item.original?.['code'] ?? item.original?.['id'] ?? 'N/A'),
      nombre: item.nombre ?? item.cliente ?? String(item.original?.['nombre'] ?? item.original?.['cliente'] ?? item.original?.['deudor'] ?? 'N/A'),
      pais: item.pais,
      gestor: item.gestor ?? 'Sin gestor',
      pd: item.pd,
      saldoActual: item.saldoActual
    }));
};

const calculateRiesgos = (items: Cartera[]) => {
  const buckets = new Map<string, { cuentas: number; saldoActual: number }>();
  const pdKeys = ['PD0', 'PD1', 'PD2', 'PD3', 'PD4', 'PD5', 'PD6', 'PD7'];

  pdKeys.forEach((pd) => buckets.set(pd, { cuentas: 0, saldoActual: 0 }));

  items.forEach((item) => {
    const pdKey = item.pd.toUpperCase();
    if (buckets.has(pdKey)) {
      const current = buckets.get(pdKey)!;
      current.cuentas += 1;
      current.saldoActual += item.saldoActual;
    }
  });

  return Array.from(buckets.entries()).map(([pd, values]) => ({ pd, cuentas: values.cuentas, saldoActual: values.saldoActual }));
};

const calculateRankingGestores = (items: Cartera[]) => {
  const totals = new Map<string, { cuentas: number; saldoActual: number; saldoAsignado: number }>();

  items.forEach((item) => {
    const nombre = item.gestor ?? 'Sin gestor';
    const current = totals.get(nombre) ?? { cuentas: 0, saldoActual: 0, saldoAsignado: 0 };
    totals.set(nombre, {
      cuentas: current.cuentas + 1,
      saldoActual: current.saldoActual + item.saldoActual,
      saldoAsignado: current.saldoAsignado + item.saldoAsignado
    });
  });

  return Array.from(totals.entries())
    .map(([nombre, values]) => {
      const recuperado = values.saldoAsignado - values.saldoActual;
      const porcentajeRecuperacion = values.saldoAsignado === 0 ? 0 : Number(((recuperado / values.saldoAsignado) * 100).toFixed(2));
      return { nombre, cuentas: values.cuentas, saldoAsignado: values.saldoAsignado, saldoActual: values.saldoActual, recuperado, porcentajeRecuperacion };
    })
    .sort((a, b) => b.saldoActual - a.saldoActual);
};

const calculateRankingPaises = (items: Cartera[]) => {
  const totals = new Map<string, { cuentas: number; saldoActual: number; saldoAsignado: number }>();

  items.forEach((item) => {
    const pais = item.pais || 'Sin país';
    const current = totals.get(pais) ?? { cuentas: 0, saldoActual: 0, saldoAsignado: 0 };
    totals.set(pais, {
      cuentas: current.cuentas + 1,
      saldoActual: current.saldoActual + item.saldoActual,
      saldoAsignado: current.saldoAsignado + item.saldoAsignado
    });
  });

  return Array.from(totals.entries())
    .map(([pais, values]) => {
      const recuperado = values.saldoAsignado - values.saldoActual;
      const porcentajeRecuperacion = values.saldoAsignado === 0 ? 0 : Number(((recuperado / values.saldoAsignado) * 100).toFixed(2));
      return { pais, cuentas: values.cuentas, saldoActual: values.saldoActual, recuperado, porcentajeRecuperacion, saldoAsignado: values.saldoAsignado };
    })
    .sort((a, b) => b.saldoActual - a.saldoActual);
};
