/**
 * Agregaciones de cartera calculadas en el backend.
 * Replica EXACTAMENTE la misma lógica de negocio que antes vivía en el frontend
 * (frontend/src/utils/carteraAggregations.ts), para que el dashboard reciba los
 * datos ya agregados y no tenga que descargar los ~20 MB de cartera completa.
 */

export type CarteraRow = Record<string, unknown>;

export interface CountryInfo {
  name: string;
  abbr: string;
  flag: string;
  matches: string[];
}

export const ALLOWED_COUNTRIES: CountryInfo[] = [
  { name: 'El Salvador', abbr: 'SV', flag: '🇸🇻', matches: ['el salvador', 'salvador', 'sv', 'es'] },
  { name: 'Guatemala', abbr: 'GT', flag: '🇬🇹', matches: ['guatemala', 'gt'] },
  { name: 'Honduras', abbr: 'HN', flag: '🇭🇳', matches: ['honduras', 'hn'] },
  { name: 'Nicaragua', abbr: 'NI', flag: '🇳🇮', matches: ['nicaragua', 'ni'] },
  { name: 'Panamá', abbr: 'PA', flag: '🇵🇦', matches: ['panama', 'panamá', 'pa'] },
  { name: 'República Dominicana', abbr: 'RD', flag: '🇩🇴', matches: ['republica dominicana', 'república dominicana', 'dominicana', 'rd', 'do'] }
];

export const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

// Memoización por valor de entrada: hay muy pocos países distintos, así que se
// evita recomputar normalizeText (NFD + regex) para cada una de las ~20.792
// filas en cada agregación. Resultado idéntico (ALLOWED_COUNTRIES es constante).
const countryResolveCache = new Map<string, CountryInfo | null>();

export const resolveCountry = (rawValue: unknown): CountryInfo | null => {
  const raw = String(rawValue ?? '');
  const cached = countryResolveCache.get(raw);
  if (cached !== undefined) return cached;

  const normalized = normalizeText(raw);
  const result = normalized ? ALLOWED_COUNTRIES.find((country) => country.matches.includes(normalized)) ?? null : null;
  countryResolveCache.set(raw, result);
  return result;
};

// Índice de claves en minúsculas cacheado POR FILA (se construye a lo sumo una
// vez por fila, y sólo si el acceso directo falla). Todas las lecturas de esa
// misma fila reutilizan el índice, evitando reconstruir un Map y hacer
// toLowerCase() de todas las claves en cada llamada a getField.
const lowerKeyIndexCache = new WeakMap<CarteraRow, Record<string, unknown>>();

const getLowerKeyIndex = (row: CarteraRow): Record<string, unknown> => {
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

export const getField = (row: CarteraRow, keys: string[]): unknown => {
  // Ruta rápida: las claves de Supabase ya vienen en minúsculas -> acceso directo.
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }

  // Respaldo insensible a mayúsculas (raro): índice lowercased cacheado por fila.
  const index = getLowerKeyIndex(row);
  for (const key of keys) {
    const value = index[key.toLowerCase()];
    if (value !== undefined && value !== null && value !== '') return value;
  }

  return undefined;
};

export const parseNumber = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, '').replace(/\./g, '').replace(/,/g, '.').replace(/[^0-9.-]/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

export const FIELD_KEYS = {
  pais: ['pais'],
  gestor: ['gestor'],
  gerente: ['gerente_zona', 'gerente'],
  zona: ['zona'],
  pd: ['pd_actual', 'pd'],
  campania: ['campania_adeuda', 'campania', 'campaña', 'campaign'],
  codigo: ['codigo', 'code', 'id'],
  sector: ['sector'],
  cliente: ['nombre', 'cliente', 'deudor'],
  saldoAsignadoUsd: ['saldo_inicial_usd', 'saldo_inicial'],
  saldoActualUsd: ['saldo_actual_usd', 'saldo_actual'],
  saldoAsignadoLocal: ['saldo_inicial'],
  saldoActualLocal: ['saldo_actual'],
  promesas: ['promesas', 'promesa', 'no_promesas', 'cantidad_promesas'],
  pagos: ['pagos', 'pago', 'no_pagos', 'cantidad_pagos']
};

const getString = (row: CarteraRow, keys: string[], fallback = ''): string => {
  const value = getField(row, keys);
  return value === undefined ? fallback : String(value).trim();
};

const getNumber = (row: CarteraRow, keys: string[]): number => parseNumber(getField(row, keys));

export interface GroupSummary {
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

const buildGroupSummary = (key: string, rows: CarteraRow[]): GroupSummary => {
  let saldoAsignadoUsd = 0;
  let saldoActualUsd = 0;
  let saldoAsignadoLocal = 0;
  let saldoActualLocal = 0;
  const countryCounts = new Map<string, number>();

  rows.forEach((row) => {
    saldoAsignadoUsd += getNumber(row, FIELD_KEYS.saldoAsignadoUsd);
    saldoActualUsd += getNumber(row, FIELD_KEYS.saldoActualUsd);
    saldoAsignadoLocal += getNumber(row, FIELD_KEYS.saldoAsignadoLocal);
    saldoActualLocal += getNumber(row, FIELD_KEYS.saldoActualLocal);

    const country = resolveCountry(getString(row, FIELD_KEYS.pais));
    if (country) {
      countryCounts.set(country.name, (countryCounts.get(country.name) ?? 0) + 1);
    }
  });

  let dominantCountry: CountryInfo | null = null;
  let bestCount = -1;
  countryCounts.forEach((count, name) => {
    if (count > bestCount) {
      bestCount = count;
      dominantCountry = ALLOWED_COUNTRIES.find((country) => country.name === name) ?? null;
    }
  });

  const recuperadoUsd = saldoAsignadoUsd - saldoActualUsd;
  const recuperadoLocal = saldoAsignadoLocal - saldoActualLocal;
  const porcentajeRecuperacion = saldoAsignadoUsd === 0 ? 0 : Number(((recuperadoUsd / saldoAsignadoUsd) * 100).toFixed(2));

  return {
    key,
    pais: dominantCountry ? (dominantCountry as CountryInfo).name : 'Sin país',
    paisAbbr: dominantCountry ? (dominantCountry as CountryInfo).abbr : '—',
    cuentas: rows.length,
    saldoAsignadoUsd,
    saldoActualUsd,
    saldoAsignadoLocal,
    saldoActualLocal,
    recuperadoUsd,
    recuperadoLocal,
    porcentajeRecuperacion
  };
};

const groupBy = (records: CarteraRow[], keys: string[], fallback: string): Map<string, CarteraRow[]> => {
  const groups = new Map<string, CarteraRow[]>();
  records.forEach((row) => {
    const value = getString(row, keys) || fallback;
    const list = groups.get(value) ?? [];
    list.push(row);
    groups.set(value, list);
  });
  return groups;
};

interface GroupAccumulator {
  key: string;
  cuentas: number;
  saldoAsignadoUsd: number;
  saldoActualUsd: number;
  saldoAsignadoLocal: number;
  saldoActualLocal: number;
  countryCounts: Map<string, number>;
}

/**
 * Agrupa y resume en UNA sola pasada por fila (antes: groupBy que almacenaba
 * arrays de filas + una segunda pasada en buildGroupSummary). Resultados
 * idénticos a groupBy + buildGroupSummary, sin almacenar los arrays de filas.
 */
const aggregateGroupSummaries = (records: CarteraRow[], keys: string[], fallback: string): GroupSummary[] => {
  const groups = new Map<string, GroupAccumulator>();

  for (const row of records) {
    const key = getString(row, keys) || fallback;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        cuentas: 0,
        saldoAsignadoUsd: 0,
        saldoActualUsd: 0,
        saldoAsignadoLocal: 0,
        saldoActualLocal: 0,
        countryCounts: new Map<string, number>()
      };
      groups.set(key, group);
    }

    group.cuentas += 1;
    group.saldoAsignadoUsd += getNumber(row, FIELD_KEYS.saldoAsignadoUsd);
    group.saldoActualUsd += getNumber(row, FIELD_KEYS.saldoActualUsd);
    group.saldoAsignadoLocal += getNumber(row, FIELD_KEYS.saldoAsignadoLocal);
    group.saldoActualLocal += getNumber(row, FIELD_KEYS.saldoActualLocal);

    const country = resolveCountry(getString(row, FIELD_KEYS.pais));
    if (country) {
      group.countryCounts.set(country.name, (group.countryCounts.get(country.name) ?? 0) + 1);
    }
  }

  const result: GroupSummary[] = [];
  groups.forEach((group) => {
    let dominantCountry: CountryInfo | null = null;
    let bestCount = -1;
    group.countryCounts.forEach((count, name) => {
      if (count > bestCount) {
        bestCount = count;
        dominantCountry = ALLOWED_COUNTRIES.find((country) => country.name === name) ?? null;
      }
    });

    const recuperadoUsd = group.saldoAsignadoUsd - group.saldoActualUsd;
    const recuperadoLocal = group.saldoAsignadoLocal - group.saldoActualLocal;
    const porcentajeRecuperacion =
      group.saldoAsignadoUsd === 0 ? 0 : Number(((recuperadoUsd / group.saldoAsignadoUsd) * 100).toFixed(2));

    result.push({
      key: group.key,
      pais: dominantCountry ? (dominantCountry as CountryInfo).name : 'Sin país',
      paisAbbr: dominantCountry ? (dominantCountry as CountryInfo).abbr : '—',
      cuentas: group.cuentas,
      saldoAsignadoUsd: group.saldoAsignadoUsd,
      saldoActualUsd: group.saldoActualUsd,
      saldoAsignadoLocal: group.saldoAsignadoLocal,
      saldoActualLocal: group.saldoActualLocal,
      recuperadoUsd,
      recuperadoLocal,
      porcentajeRecuperacion
    });
  });

  return result;
};

export const aggregateTopGestores = (records: CarteraRow[], limit = 20): GroupSummary[] =>
  aggregateGroupSummaries(records, FIELD_KEYS.gestor, 'Sin gestor')
    .sort((a, b) => b.recuperadoUsd - a.recuperadoUsd)
    .slice(0, limit);

export const aggregateTopZonas = (records: CarteraRow[], limit = 20): GroupSummary[] =>
  aggregateGroupSummaries(records, FIELD_KEYS.zona, 'Sin zona')
    .sort((a, b) => b.saldoActualUsd - a.saldoActualUsd)
    .slice(0, limit);

export interface CountrySummary {
  pais: string;
  abbr: string;
  flag: string;
  cuentas: number;
  saldoAsignadoUsd: number;
  saldoActualUsd: number;
  recuperadoUsd: number;
  porcentajeRecuperacion: number;
}

export const aggregateCountrySummary = (records: CarteraRow[]): CountrySummary[] => {
  const totals = new Map<string, { cuentas: number; saldoAsignadoUsd: number; saldoActualUsd: number }>();

  records.forEach((row) => {
    const country = resolveCountry(getString(row, FIELD_KEYS.pais));
    if (!country) return;
    const existing = totals.get(country.name) ?? { cuentas: 0, saldoAsignadoUsd: 0, saldoActualUsd: 0 };
    totals.set(country.name, {
      cuentas: existing.cuentas + 1,
      saldoAsignadoUsd: existing.saldoAsignadoUsd + getNumber(row, FIELD_KEYS.saldoAsignadoUsd),
      saldoActualUsd: existing.saldoActualUsd + getNumber(row, FIELD_KEYS.saldoActualUsd)
    });
  });

  return ALLOWED_COUNTRIES.filter((country) => totals.has(country.name)).map((country) => {
    const values = totals.get(country.name)!;
    const recuperadoUsd = values.saldoAsignadoUsd - values.saldoActualUsd;
    const porcentajeRecuperacion = values.saldoAsignadoUsd === 0 ? 0 : Number(((recuperadoUsd / values.saldoAsignadoUsd) * 100).toFixed(2));
    return {
      pais: country.name,
      abbr: country.abbr,
      flag: country.flag,
      cuentas: values.cuentas,
      saldoAsignadoUsd: values.saldoAsignadoUsd,
      saldoActualUsd: values.saldoActualUsd,
      recuperadoUsd,
      porcentajeRecuperacion
    };
  });
};

export interface CampaniaSummary {
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

interface CampaniaAccumulator {
  campania: string;
  cuentas: number;
  saldoAsignadoUsd: number;
  saldoActualUsd: number;
  saldoAsignadoLocal: number;
  saldoActualLocal: number;
  promesas: number;
  pagos: number;
}

/**
 * Resume por campaña en UNA sola pasada por fila (antes: groupBy + una pasada
 * en buildGroupSummary + dos reduces adicionales para promesas y pagos = varias
 * pasadas). No se resuelve el país porque CampaniaSummary NO lo expone, así que
 * ese cálculo era descartado. Resultados idénticos a la versión anterior.
 */
export const aggregateResumenCampania = (records: CarteraRow[]): CampaniaSummary[] => {
  const groups = new Map<string, CampaniaAccumulator>();

  for (const row of records) {
    const campania = getString(row, FIELD_KEYS.campania) || 'Sin campaña';
    let group = groups.get(campania);
    if (!group) {
      group = {
        campania,
        cuentas: 0,
        saldoAsignadoUsd: 0,
        saldoActualUsd: 0,
        saldoAsignadoLocal: 0,
        saldoActualLocal: 0,
        promesas: 0,
        pagos: 0
      };
      groups.set(campania, group);
    }

    group.cuentas += 1;
    group.saldoAsignadoUsd += getNumber(row, FIELD_KEYS.saldoAsignadoUsd);
    group.saldoActualUsd += getNumber(row, FIELD_KEYS.saldoActualUsd);
    group.saldoAsignadoLocal += getNumber(row, FIELD_KEYS.saldoAsignadoLocal);
    group.saldoActualLocal += getNumber(row, FIELD_KEYS.saldoActualLocal);
    group.promesas += getNumber(row, FIELD_KEYS.promesas);
    group.pagos += getNumber(row, FIELD_KEYS.pagos);
  }

  const result: CampaniaSummary[] = [];
  groups.forEach((group) => {
    const recuperadoUsd = group.saldoAsignadoUsd - group.saldoActualUsd;
    const porcentajeRecuperacion =
      group.saldoAsignadoUsd === 0 ? 0 : Number(((recuperadoUsd / group.saldoAsignadoUsd) * 100).toFixed(2));
    result.push({
      campania: group.campania,
      cuentas: group.cuentas,
      saldoAsignadoUsd: group.saldoAsignadoUsd,
      saldoActualUsd: group.saldoActualUsd,
      saldoAsignadoLocal: group.saldoAsignadoLocal,
      saldoActualLocal: group.saldoActualLocal,
      recuperadoUsd,
      porcentajeRecuperacion,
      promesas: group.promesas,
      pagos: group.pagos
    });
  });

  return result.sort((a, b) => b.saldoAsignadoUsd - a.saldoAsignadoUsd);
};

// --- Filtros (cascada) y detalle de cuentas ---

export interface DashboardMultiFilterParams {
  pais: string[];
  gestor: string[];
  gerente: string[];
  zona: string[];
  pd: string[];
  campania: string[];
}

export interface FilterOptions {
  pais: string[];
  gestor: string[];
  gerente: string[];
  zona: string[];
  pd: string[];
  campania: string[];
}

const normalizeValue = (value: unknown): string => String(value ?? '').trim();

const getFieldValue = (row: CarteraRow, keys: string[]): string => {
  // Bucle directo en lugar de keys.map(...).find(...): evita asignar un array
  // por llamada (esta función se invoca ~6 veces por fila en buildFilterOptions).
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null) return normalizeValue(value);
  }
  return '';
};

const rowMatchesFilter = (row: CarteraRow, values: string[], keys: string[]): boolean => {
  if (!values.length) return true;
  const normalizedValues = values.map((value) => value.trim().toLocaleLowerCase());
  const fieldValue = getFieldValue(row, keys).toLocaleLowerCase();
  return normalizedValues.includes(fieldValue);
};

const filterRows = (
  rows: CarteraRow[],
  filters: DashboardMultiFilterParams,
  excludeField?: keyof DashboardMultiFilterParams
): CarteraRow[] =>
  rows.filter((row) => {
    if (excludeField !== 'pais' && !rowMatchesFilter(row, filters.pais, ['pais'])) return false;
    if (excludeField !== 'zona' && !rowMatchesFilter(row, filters.zona, ['zona'])) return false;
    if (excludeField !== 'gestor' && !rowMatchesFilter(row, filters.gestor, ['gestor'])) return false;
    if (excludeField !== 'gerente' && !rowMatchesFilter(row, filters.gerente, ['gerente', 'gerente_zona'])) return false;
    if (excludeField !== 'pd' && !rowMatchesFilter(row, filters.pd, ['pd_actual', 'pd'])) return false;
    if (excludeField !== 'campania' && !rowMatchesFilter(row, filters.campania, ['campania_adeuda', 'campania', 'campaña', 'campaign'])) return false;
    return true;
  });

const getUniqueOptions = (rows: CarteraRow[], keyVariants: string[]): string[] => {
  const values = rows.map((row) => getFieldValue(row, keyVariants)).filter((value) => value !== '');
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
};

export const buildFilterOptions = (rows: CarteraRow[], filters: DashboardMultiFilterParams): FilterOptions => ({
  pais: getUniqueOptions(filterRows(rows, filters, 'pais'), ['pais']),
  zona: getUniqueOptions(filterRows(rows, filters, 'zona'), ['zona']),
  gestor: getUniqueOptions(filterRows(rows, filters, 'gestor'), ['gestor']),
  gerente: getUniqueOptions(filterRows(rows, filters, 'gerente'), ['gerente', 'gerente_zona']),
  pd: getUniqueOptions(filterRows(rows, filters, 'pd'), ['pd_actual', 'pd']),
  campania: getUniqueOptions(filterRows(rows, filters, 'campania'), ['campania_adeuda', 'campania', 'campaña', 'campaign'])
});

/**
 * Filtra las filas por los mismos criterios del dashboard (equivalente al
 * filteredTableData del frontend). Se usa para el detalle de cuentas, el
 * resumen por campaña y el resumen por país.
 */
export const filterCarteraRows = (rows: CarteraRow[], filters: DashboardMultiFilterParams): CarteraRow[] => {
  const normalize = (value: unknown) => String(value ?? '').toLocaleLowerCase().trim();

  return rows.filter((row) => {
    const rowPais = normalize(row.pais);
    const rowGestor = normalize(row.gestor);
    const rowGerente = normalize(row.gerente ?? row.gerente_zona);
    const rowZona = normalize(row.zona);
    const rowPd = normalize(row.pd_actual ?? row.pd);
    const rowCampania = normalize(row.campania_adeuda ?? row.campania ?? (row as Record<string, unknown>)['campaña'] ?? row.campaign);

    if (filters.pais.length && !filters.pais.map((v) => v.toLocaleLowerCase()).includes(rowPais)) return false;
    if (filters.gestor.length && !filters.gestor.map((v) => v.toLocaleLowerCase()).includes(rowGestor)) return false;
    if (filters.gerente.length && !filters.gerente.map((v) => v.toLocaleLowerCase()).includes(rowGerente)) return false;
    if (filters.zona.length && !filters.zona.map((v) => v.toLocaleLowerCase()).includes(rowZona)) return false;
    if (filters.pd.length && !filters.pd.map((v) => v.toLocaleLowerCase()).includes(rowPd)) return false;
    if (filters.campania.length && !filters.campania.map((v) => v.toLocaleLowerCase()).includes(rowCampania)) return false;
    return true;
  });
};
