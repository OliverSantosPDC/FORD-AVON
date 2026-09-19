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
  pdInicial: ['pd_inicial'],
  pdActual: ['pd_actual', 'pd'],
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
const aggregateGroupSummaries = (records: CarteraRow[], keyResolver: (row: CarteraRow) => string): GroupSummary[] => {
  const groups = new Map<string, GroupAccumulator>();

  for (const row of records) {
    const key = keyResolver(row);
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

/**
 * Top Gestores: agrupa por `gestor`, que a esta altura YA es la IDENTIDAD
 * real (sobrescrita por `overlayIdentidadReal` antes de llegar aquí) —
 * nunca el texto crudo `cartera.gestor` original.
 */
export const aggregateTopGestores = (records: CarteraRow[], limit = 20): GroupSummary[] =>
  aggregateGroupSummaries(records, (row) => getString(row, FIELD_KEYS.gestor) || 'Sin gestor asignado')
    .sort((a, b) => b.recuperadoUsd - a.recuperadoUsd)
    .slice(0, limit);

export const aggregateTopZonas = (records: CarteraRow[], limit = 20): GroupSummary[] =>
  aggregateGroupSummaries(records, (row) => getString(row, FIELD_KEYS.zona) || 'Sin zona')
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

export interface ZonaSectorPorPaisSectorItem { sector: string; saldoActualUsd: number; cuentas: number; }
export interface ZonaSectorPorPaisZonaItem { zona: string; saldoActualUsd: number; cuentas: number; sectores: ZonaSectorPorPaisSectorItem[]; }
export interface ZonaSectorPorPaisItem { paisKey: string; paisNombre: string; zonas: ZonaSectorPorPaisZonaItem[]; }

/**
 * Saldo actual agrupado País → Zona → Sector (sin límite de filas), antes
 * calculado en el cliente (DashboardZonaSector.tsx) a partir de la cartera
 * completa descargada vía /api/cartera. Reemplaza a `aggregateZonaSector`
 * (agrupaba solo por Zona, sin País, y limitaba a 20 — comprobado sin
 * ningún consumidor real en el frontend, se elimina en vez de mantener dos
 * resúmenes de zona distintos). Solo USD: el cliente sigue multiplicando
 * por la tasa vigente para LOCAL, así que un cambio de moneda no repite
 * esta agregación ni pide datos de nuevo.
 */
export const calculateZonaSectorPorPais = (records: CarteraRow[]): ZonaSectorPorPaisItem[] => {
  const zonas = new Map<string, { paisKey: string; paisNombre: string; zona: string; usd: number; cuentas: number; sectores: Map<string, { usd: number; cuentas: number }> }>();
  for (const row of records) {
    const country = resolveCountry(getField(row, FIELD_KEYS.pais));
    const paisRaw = getField(row, FIELD_KEYS.pais);
    const paisKey = country?.abbr ?? String(paisRaw ?? 'Sin país').trim().toUpperCase();
    const paisNombre = country?.name ?? String(paisRaw ?? 'Sin país');
    const zona = getString(row, FIELD_KEYS.zona) || 'Sin zona';
    const sector = getString(row, FIELD_KEYS.sector) || 'Sin sector';
    const usd = getNumber(row, FIELD_KEYS.saldoActualUsd);
    const key = `${paisKey}|||${zona}`;
    const z = zonas.get(key) ?? { paisKey, paisNombre, zona, usd: 0, cuentas: 0, sectores: new Map<string, { usd: number; cuentas: number }>() };
    z.usd += usd;
    z.cuentas += 1;
    const s = z.sectores.get(sector) ?? { usd: 0, cuentas: 0 };
    s.usd += usd;
    s.cuentas += 1;
    z.sectores.set(sector, s);
    zonas.set(key, z);
  }

  const porPais = new Map<string, ZonaSectorPorPaisItem>();
  zonas.forEach((z) => {
    const grupo = porPais.get(z.paisKey) ?? { paisKey: z.paisKey, paisNombre: z.paisNombre, zonas: [] as ZonaSectorPorPaisZonaItem[] };
    grupo.zonas.push({
      zona: z.zona,
      saldoActualUsd: z.usd,
      cuentas: z.cuentas,
      sectores: Array.from(z.sectores.entries())
        .map(([sector, s]) => ({ sector, saldoActualUsd: s.usd, cuentas: s.cuentas }))
        .sort((a, b) => b.saldoActualUsd - a.saldoActualUsd)
    });
    porPais.set(z.paisKey, grupo);
  });

  return Array.from(porPais.values()).sort((a, b) => a.paisNombre.localeCompare(b.paisNombre, 'es', { sensitivity: 'base' }));
};

/** Bucket de PD (PD0-PD7) a partir de un valor crudo (ej. "PD3", "A3", "3").
 *  MISMA regex que el frontend (ResumenPdTable.tsx/PDMigrationChart.tsx,
 *  `normalizePd`): los resultados deben ser idénticos byte a byte a los que
 *  antes calculaba el navegador sobre la cartera completa. */
const PD_BUCKETS = ['PD0', 'PD1', 'PD2', 'PD3', 'PD4', 'PD5', 'PD6', 'PD7'];
const normalizePdBucket = (value: unknown): string | null => {
  const raw = String(value ?? '').trim().toUpperCase();
  const match = raw.match(/(?:PD|A)([0-7])/);
  return match ? `PD${match[1]}` : null;
};

export interface ResumenPdInicialItem {
  pd: string;
  cuentas: number;
  saldoAsignadoUsd: number;
  saldoActualUsd: number;
  recuperadoUsd: number;
  porcentajeRecuperacionUsd: number;
}

/**
 * Resumen agrupado por PD INICIAL (`pd_inicial`), antes calculado en el
 * cliente (ResumenPdTable.tsx) a partir de la cartera completa descargada
 * vía `/api/cartera` — el `resumenPD` existente agrupa por PD ACTUAL, una
 * dimensión distinta, así que no podía reutilizarse. Se calcula aquí sobre
 * las mismas filas (`rawFiltered`) que ya están en memoria para las demás
 * agregaciones del dashboard: cero consultas adicionales a Supabase, cero
 * filas transferidas al navegador para este cálculo. USD siempre; LOCAL se
 * sigue multiplicando por la tasa en el cliente (igual que el resto del
 * dashboard), así que un cambio de moneda no repite esta agregación.
 */
export const calculateResumenPdInicial = (records: CarteraRow[]): ResumenPdInicialItem[] => {
  const totals = new Map<string, { asignadoUsd: number; actualUsd: number; cuentas: number }>();
  for (const row of records) {
    const pd = normalizePdBucket(getField(row, FIELD_KEYS.pdInicial));
    if (!pd) continue;
    const existing = totals.get(pd) ?? { asignadoUsd: 0, actualUsd: 0, cuentas: 0 };
    existing.asignadoUsd += getNumber(row, FIELD_KEYS.saldoAsignadoUsd);
    existing.actualUsd += getNumber(row, FIELD_KEYS.saldoActualUsd);
    existing.cuentas += 1;
    totals.set(pd, existing);
  }
  return PD_BUCKETS.filter((pd) => totals.has(pd)).map((pd) => {
    const v = totals.get(pd)!;
    const recuperadoUsd = v.asignadoUsd - v.actualUsd;
    const porcentajeRecuperacionUsd = v.asignadoUsd === 0 ? 0 : Number(((recuperadoUsd / v.asignadoUsd) * 100).toFixed(2));
    return { pd, cuentas: v.cuentas, saldoAsignadoUsd: v.asignadoUsd, saldoActualUsd: v.actualUsd, recuperadoUsd, porcentajeRecuperacionUsd };
  });
};

export interface PdMigrationItem {
  pdInicial: string;
  pdActual: string;
  saldoInicialUsd: number;
  cuentas: number;
}

/**
 * Matriz PD Inicial → PD Actual (a lo sumo 8×8 = 64 celdas), antes calculada
 * en el cliente (PDMigrationChart.tsx) a partir de la cartera completa.
 * `saldoInicialUsd` es la suma de `saldo_inicial_usd` de cada combinación
 * (mismo campo/signo que usaba el cálculo en el navegador); el cliente sigue
 * decidiendo USD/LOCAL multiplicando por la tasa vigente, así que la matriz
 * se calcula UNA vez sin importar la moneda seleccionada.
 */
export const calculatePdMigration = (records: CarteraRow[]): PdMigrationItem[] => {
  const totals = new Map<string, { saldo: number; cuentas: number }>();
  for (const row of records) {
    const pdInicial = normalizePdBucket(getField(row, FIELD_KEYS.pdInicial));
    const pdActual = normalizePdBucket(getField(row, FIELD_KEYS.pdActual));
    if (!pdInicial || !pdActual) continue;
    const saldoUsd = getNumber(row, FIELD_KEYS.saldoAsignadoUsd);
    if (saldoUsd <= 0) continue;
    const key = `${pdInicial}|${pdActual}`;
    const existing = totals.get(key) ?? { saldo: 0, cuentas: 0 };
    existing.saldo += saldoUsd;
    existing.cuentas += 1;
    totals.set(key, existing);
  }
  const result: PdMigrationItem[] = [];
  totals.forEach((v, key) => {
    const [pdInicial, pdActual] = key.split('|');
    result.push({ pdInicial, pdActual, saldoInicialUsd: v.saldo, cuentas: v.cuentas });
  });
  return result.sort((a, b) =>
    PD_BUCKETS.indexOf(a.pdInicial) - PD_BUCKETS.indexOf(b.pdInicial) || PD_BUCKETS.indexOf(a.pdActual) - PD_BUCKETS.indexOf(b.pdActual)
  );
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

/**
 * Persona (Gestor o Gerente de zona) tal como la resuelve ScopeService a
 * partir de USUARIOS/roles/relaciones — NUNCA de `cartera`. `nombre` es el
 * valor que ve/selecciona el usuario en el Autocomplete (compatibilidad con
 * el diseño visual existente, que solo maneja strings); `paisZona` es SU
 * PROPIO conjunto de País-Zona asignado (gestor_pais_zona / gerente_zona_zona),
 * la fuente real para encadenar y filtrar, con independencia de que su nombre
 * exista o no en `cartera.gestor`/`cartera.gerente_zona`.
 */
export interface PersonaFiltro {
  nombre: string;
  paisZona: Array<{ pais: string; zona: string }>;
  /** `profiles.id` de sus Supervisores vigentes (`supervisor_gestor` /
   *  `supervisor_gerente_zona`, ver ScopeService). Única relación REAL entre
   *  Gestor y Gerente de zona en el modelo actual: no existe una tabla de
   *  relación directa Gestor→Gerente — ambos dependen del mismo Supervisor
   *  como ramas paralelas (auditoría Supabase, project vuazzailuqgbjnnbdtrg:
   *  `supervisor_gestor` y `supervisor_gerente_zona` son las únicas tablas
   *  que conectan a un Supervisor con sus Gestores/Gerentes respectivamente).
   *  Se usa EXCLUSIVAMENTE para acotar el catálogo cruzado en
   *  `opcionesPersonas` cuando el usuario selecciona Gestor y/o Gerente. */
  supervisorIds: string[];
}

export interface PersonasEnAlcance {
  gestores: PersonaFiltro[];
  gerentes: PersonaFiltro[];
}

export const paisZonaKey = (pais: unknown, zona: unknown): string =>
  `${normalizeValue(pais).toLocaleLowerCase()}||${normalizeValue(zona).toLocaleLowerCase()}`;

/**
 * Mapa País-Zona → nombre del Gestor real que lo tiene asignado
 * (`gestor_pais_zona`), para agregaciones que necesitan la IDENTIDAD real
 * del Gestor (Top Gestores, Ranking de Gestores) en vez de `cartera.gestor`
 * (texto de exhibición: puede estar vacío, desactualizado o no vinculado a
 * ningún usuario real). Si dos Gestores compartieran el mismo País-Zona, se
 * atribuye al primero en orden alfabético — caso límite documentado, NO una
 * regla de negocio definitiva: auditado en producción (project
 * vuazzailuqgbjnnbdtrg), hoy cada Zona real tiene como máximo un Gestor y un
 * Gerente de zona asignado, así que esta rama nunca se activa actualmente.
 */
export const gestorPorPaisZona = (gestores: PersonaFiltro[]): Map<string, string> => {
  const map = new Map<string, string>();
  const ordenados = [...gestores].sort((a, b) => a.nombre.localeCompare(b.nombre, undefined, { sensitivity: 'base' }));
  for (const persona of ordenados) {
    for (const pz of persona.paisZona) {
      const key = paisZonaKey(pz.pais, pz.zona);
      if (!map.has(key)) map.set(key, persona.nombre);
    }
  }
  return map;
};

/**
 * IDENTIDAD REAL para exhibición: sobrescribe `gestor`/`gerente_zona` de
 * CADA fila con la identidad real resuelta — nunca el texto crudo de
 * `cartera` (columnas que van a dejar de existir). Aplicado UNA sola vez
 * por `CarteraService`/`GestionService`, justo después del scope y del
 * gestor efectivo, para que TODO consumidor (Dashboard, Centro de
 * Inteligencia, Control Operativo, Asignación, Gestión, exportaciones)
 * reciba siempre la misma identidad sin repetir esta lógica.
 *  - Gestor: el gestor EFECTIVO validado (override de
 *    `asignaciones.gestor_nuevo_id`, marcado por el flag
 *    `_gestorEfectivoOverride: true` — nunca un texto, para no filtrar el
 *    valor previo a la respuesta HTTP) tiene prioridad; si no, se resuelve
 *    por el PROPIO País-Zona de la fila (`gestor_pais_zona`).
 *  - Gerente de zona: SIEMPRE por País-Zona (`gerente_zona_zona`) — no
 *    existe un "gerente efectivo" por asignación, solo por Gestor.
 *  - Sin identidad real para esa fila ⇒ 'Sin gestor asignado'/'Sin
 *    gerente asignado' (nunca inventa, nunca cae de vuelta al texto).
 */
export const overlayIdentidadReal = (
  rows: CarteraRow[],
  gestorPorZona: Map<string, string>,
  gerentePorZona: Map<string, string>
): CarteraRow[] =>
  rows.map((row) => {
    const pais = getFieldValue(row, ['pais']);
    const zona = getFieldValue(row, ['zona']);
    const key = pais && zona ? paisZonaKey(pais, zona) : null;
    const tieneGestorEfectivo = (row as Record<string, unknown>)._gestorEfectivoOverride === true;
    const gestor = tieneGestorEfectivo
      ? getFieldValue(row, ['gestor']) || 'Sin gestor asignado'
      : (key && gestorPorZona.get(key)) || 'Sin gestor asignado';
    const gerente = (key && gerentePorZona.get(key)) || 'Sin gerente asignado';
    return { ...row, gestor, gerente_zona: gerente };
  });

const personasPorNombre = (personas: PersonaFiltro[]): Map<string, PersonaFiltro> => {
  const map = new Map<string, PersonaFiltro>();
  personas.forEach((p) => map.set(p.nombre.trim().toLocaleLowerCase(), p));
  return map;
};

/**
 * ¿La fila queda incluida por la selección de Gestor/Gerente? Coincide
 * ÚNICAMENTE si el País-Zona EXACTO de la fila está entre los de alguna
 * persona seleccionada (`gestor_pais_zona`/`gerente_zona_zona`) — nunca por
 * el texto libre `cartera.gestor`/`cartera.gerente_zona`.
 *
 * Auditoría real (project vuazzailuqgbjnnbdtrg): se confirmó que el puente
 * de texto para Gestor (antes activo vía `permitirNombre`) coincidía con
 * EXACTAMENTE 0 de las 18,107 filas reales de cartera contra cualquiera de
 * los 18 Gestores vigentes — los nombres curados (`gestores.nombre_cartera`,
 * p. ej. "Angie Buch") son deliberadamente distintos del texto operativo del
 * ERP (`cartera.gestor`, p. ej. "ANGIE DYANA BUCH DÍAZ"). El puente estaba
 * 100% inerte en producción; eliminarlo no cambia ningún resultado real y
 * cierra definitivamente el patrón prohibido "NOMBRE DE CUENTA → PERSONA"
 * (el mismo bug ya corregido para Gerente con Cristina Garcia/Ircania
 * Guerrero/Julissa Rodriguez/Leydi Perez/Stephanie German).
 *
 * Gestor y Gerente de zona usan ahora EXACTAMENTE la misma regla: identidad
 * desde usuarios/roles/relaciones (ScopeService), alcance geográfico
 * EXCLUSIVAMENTE desde `gestor_pais_zona`/`gerente_zona_zona`.
 */
const rowMatchesPersonaFilter = (
  row: CarteraRow,
  values: string[],
  personasPorNombreLower: Map<string, PersonaFiltro>
): boolean => {
  if (!values.length) return true;
  const seleccionadas = values.map((v) => v.trim().toLocaleLowerCase());

  const rowPais = getFieldValue(row, ['pais']);
  const rowZona = getFieldValue(row, ['zona']);
  if (!rowPais || !rowZona) return false;
  const rowKey = paisZonaKey(rowPais, rowZona);

  for (const nombre of seleccionadas) {
    const persona = personasPorNombreLower.get(nombre);
    if (persona && persona.paisZona.some((pz) => paisZonaKey(pz.pais, pz.zona) === rowKey)) return true;
  }
  return false;
};

/** `gestoresPorNombre`/`gerentesPorNombre` se reciben ya construidos: esta
 *  función se llama una vez POR DIMENSIÓN dentro de `buildFilterOptions`
 *  (hasta 4 veces por request) — reconstruir esos Map en cada llamada era
 *  trabajo repetido e idéntico (medido: buildFilterOptions llegaba a 612 ms
 *  sobre 18,107 filas; ver PersonasPorNombreMaps en buildFilterOptions). */
const filterRows = (
  rows: CarteraRow[],
  filters: DashboardMultiFilterParams,
  { gestoresPorNombre, gerentesPorNombre }: { gestoresPorNombre: Map<string, PersonaFiltro>; gerentesPorNombre: Map<string, PersonaFiltro> },
  excludeField?: keyof DashboardMultiFilterParams
): CarteraRow[] => {
  return rows.filter((row) => {
    if (excludeField !== 'pais' && !rowMatchesFilter(row, filters.pais, ['pais'])) return false;
    if (excludeField !== 'zona' && !rowMatchesFilter(row, filters.zona, ['zona'])) return false;
    if (excludeField !== 'gestor' && !rowMatchesPersonaFilter(row, filters.gestor, gestoresPorNombre)) return false;
    if (excludeField !== 'gerente' && !rowMatchesPersonaFilter(row, filters.gerente, gerentesPorNombre)) return false;
    if (excludeField !== 'pd' && !rowMatchesFilter(row, filters.pd, ['pd_actual', 'pd'])) return false;
    if (excludeField !== 'campania' && !rowMatchesFilter(row, filters.campania, ['campania_adeuda', 'campania', 'campaña', 'campaign'])) return false;
    return true;
  });
};

const getUniqueOptions = (rows: CarteraRow[], keyVariants: string[]): string[] => {
  const values = rows.map((row) => getFieldValue(row, keyVariants)).filter((value) => value !== '');
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
};

/**
 * OPCIONES de la dimensión Gestor/Gerente: el catálogo SIEMPRE sale de
 * `personas` (usuarios/roles/relaciones — ver ScopeService.gestoresEnAlcance /
 * gerentesZonaEnAlcance), nunca de `getUniqueOptions` sobre `cartera`.
 *
 * IDENTIDAD vs. ALCANCE GEOGRÁFICO (separados, nunca mezclados):
 * - Si NO hay ningún filtro País/Zona activo, el catálogo es la lista
 *   COMPLETA de `personas` (identidad + autorización, ya resuelta por
 *   ScopeService) — SIN exigir que la persona tenga ninguna relación
 *   País-Zona configurada ni ninguna fila visible en cartera. Una persona
 *   con 0 relaciones geográficas SIGUE siendo una persona autorizada válida
 *   (p. ej. un Gerente de zona real, supervisado por el usuario conectado,
 *   al que aún no se le configuró ningún `gerente_zona_zona` — "persona
 *   existente sin alcance geográfico" es distinto de "persona inexistente").
 * - Si SÍ hay un filtro País y/o Zona activo, la lista se acota a las
 *   personas cuyo PROPIO País-Zona (gestor_pais_zona/gerente_zona_zona)
 *   coincide con los valores SELECCIONADOS — nunca contra qué filas de
 *   cartera resultan visibles: una persona sin relaciones nunca podrá
 *   satisfacer un filtro geográfico explícito (correcto: no tiene zona ahí),
 *   pero eso no debe vaciar el catálogo completo cuando no se ha pedido
 *   ningún recorte geográfico.
 * Gestor y Gerente de zona usan EXACTAMENTE la misma regla (ver
 * `rowMatchesPersonaFilter`): ningún puente de texto con `cartera.gestor`/
 * `cartera.gerente_zona` — únicamente `gestor_pais_zona`/`gerente_zona_zona`.
 * Auditoría real (project vuazzailuqgbjnnbdtrg) confirmó que ese puente
 * coincidía con 0 de las 18,107 filas reales de cartera; eliminarlo no
 * cambia ningún resultado de producción actual.
 *
 * RELACIÓN CRUZADA Gestor↔Gerente (`paisZonaDeOtraSeleccionada`): el modelo
 * NO tiene una tabla de relación directa Gestor→Gerente ni Gerente→Gestor.
 * La relación REAL y correcta para esta cascada es GEOGRÁFICA: cuando el
 * usuario tiene seleccionado un Gestor y/o un Gerente, la OTRA dimensión se
 * acota a las personas cuyo PROPIO País-Zona (`gestor_pais_zona`/
 * `gerente_zona_zona`) intersecta AL MENOS UNA de las combinaciones
 * País-Zona de la/las persona(s) seleccionada(s) — NUNCA por compartir
 * Supervisor (decisión explícita: compartir Supervisor solo determina el
 * ALCANCE/autorización, ya aplicado antes en `gestoresEnAlcance`/
 * `gerentesZonaEnAlcance`; usarlo también como criterio de cascada mostraba,
 * p. ej., los ~57 Gerentes de TODO un Supervisor al elegir un Gestor con
 * solo 5 zonas reales — auditado en producción, project
 * vuazzailuqgbjnnbdtrg). `paisZonaDeOtraSeleccionada = null` significa "sin
 * selección activa en la otra dimensión" (sin recorte); un `Set` vacío
 * significa "la persona seleccionada no tiene ninguna relación País-Zona
 * propia vigente" y por lo tanto NINGUNA persona de la otra dimensión puede
 * intersectar — 0 opciones, correcto (nunca se amplía el alcance; un País-Zona
 * sin ninguna relación `gerente_zona_zona` configurada produce 0 Gerentes
 * hasta que se configure — nunca se fabrica una relación para evitarlo).
 */
const opcionesPersonas = (
  personas: PersonaFiltro[],
  filtrosPais: string[],
  filtrosZona: string[],
  paisZonaDeOtraSeleccionada: Set<string> | null
): string[] => {
  const paisSet = new Set(filtrosPais.map((v) => v.trim().toLocaleLowerCase()).filter(Boolean));
  const zonaSet = new Set(filtrosZona.map((v) => v.trim().toLocaleLowerCase()).filter(Boolean));
  const hayFiltroGeografico = paisSet.size > 0 || zonaSet.size > 0;

  return personas
    .filter((persona) => {
      if (paisZonaDeOtraSeleccionada && !persona.paisZona.some((pz) => paisZonaDeOtraSeleccionada.has(paisZonaKey(pz.pais, pz.zona)))) return false;
      if (!hayFiltroGeografico) return true;
      return persona.paisZona.some(
        (pz) =>
          (paisSet.size === 0 || paisSet.has(pz.pais.trim().toLocaleLowerCase())) &&
          (zonaSet.size === 0 || zonaSet.has(pz.zona.trim().toLocaleLowerCase()))
      );
    })
    .map((persona) => persona.nombre)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
};

/** Unión de los pares País-Zona PROPIOS de la(s) persona(s) actualmente
 *  SELECCIONADA(s) en un filtro (por nombre) — usado para acotar la
 *  dimensión Gestor↔Gerente cruzada geográficamente (ver `opcionesPersonas`).
 *  `null` = sin selección (sin recorte). */
const paisZonaDeSeleccion = (personas: PersonaFiltro[], seleccionados: string[]): Set<string> | null => {
  if (seleccionados.length === 0) return null;
  const nombres = new Set(seleccionados.map((v) => v.trim().toLocaleLowerCase()));
  const keys = new Set<string>();
  personas.forEach((persona) => {
    if (nombres.has(persona.nombre.trim().toLocaleLowerCase())) {
      persona.paisZona.forEach((pz) => keys.add(paisZonaKey(pz.pais, pz.zona)));
    }
  });
  return keys;
};

export const buildFilterOptions = (
  rows: CarteraRow[],
  filters: DashboardMultiFilterParams,
  personas: PersonasEnAlcance
): FilterOptions => {
  const paisZonaDeGestorSeleccionado = paisZonaDeSeleccion(personas.gestores, filters.gestor);
  const paisZonaDeGerenteSeleccionado = paisZonaDeSeleccion(personas.gerentes, filters.gerente);
  // Construidos UNA vez y reutilizados en las 4 llamadas a filterRows (antes:
  // 4 reconstrucciones idénticas de los mismos 2 Map, uno por dimensión).
  const mapas = { gestoresPorNombre: personasPorNombre(personas.gestores), gerentesPorNombre: personasPorNombre(personas.gerentes) };
  return {
    pais: getUniqueOptions(filterRows(rows, filters, mapas, 'pais'), ['pais']),
    zona: getUniqueOptions(filterRows(rows, filters, mapas, 'zona'), ['zona']),
    gestor: opcionesPersonas(personas.gestores, filters.pais, filters.zona, paisZonaDeGerenteSeleccionado),
    gerente: opcionesPersonas(personas.gerentes, filters.pais, filters.zona, paisZonaDeGestorSeleccionado),
    pd: getUniqueOptions(filterRows(rows, filters, mapas, 'pd'), ['pd_actual', 'pd']),
    campania: getUniqueOptions(filterRows(rows, filters, mapas, 'campania'), ['campania_adeuda', 'campania', 'campaña', 'campaign'])
  };
};

/**
 * Filtra las filas por los mismos criterios del dashboard (equivalente al
 * filteredTableData del frontend). Se usa para el detalle de cuentas, el
 * resumen por campaña y el resumen por país. Gestor/Gerente usan
 * `rowMatchesPersonaFilter` (País-Zona propio de la persona seleccionada,
 * vía `gestor_pais_zona`/`gerente_zona_zona`) — nunca `cartera.gestor`/
 * `cartera.gerente_zona`.
 */
export const filterCarteraRows = (rows: CarteraRow[], filters: DashboardMultiFilterParams, personas: PersonasEnAlcance): CarteraRow[] => {
  const gestoresPorNombre = personasPorNombre(personas.gestores);
  const gerentesPorNombre = personasPorNombre(personas.gerentes);

  return rows.filter((row) => {
    if (!rowMatchesFilter(row, filters.pais, ['pais'])) return false;
    if (!rowMatchesPersonaFilter(row, filters.gestor, gestoresPorNombre)) return false;
    if (!rowMatchesPersonaFilter(row, filters.gerente, gerentesPorNombre)) return false;
    if (!rowMatchesFilter(row, filters.zona, ['zona'])) return false;
    if (!rowMatchesFilter(row, filters.pd, ['pd_actual', 'pd'])) return false;
    if (!rowMatchesFilter(row, filters.campania, ['campania_adeuda', 'campania', 'campaña', 'campaign'])) return false;
    return true;
  });
};

interface RowMatchFlags {
  pais: boolean;
  zona: boolean;
  gestor: boolean;
  gerente: boolean;
  pd: boolean;
  campania: boolean;
}

/**
 * Combina en UN solo recorrido de `rows` lo que antes hacían por separado
 * `filterCarteraRows` (1 pasada completa) + `buildFilterOptions` (hasta 4
 * pasadas más — una por dimensión país/zona/pd/campaña, cada una repitiendo
 * las OTRAS 5 comprobaciones de cada fila): hasta 5 pasadas completas sobre
 * las 18,107 filas reales de cartera, cada una repitiendo el mismo trabajo
 * de `getFieldValue`/`normalizeValue`/`paisZonaKey` por fila (medido en
 * producción: 299 ms + 510 ms = 809 ms, el segundo cuello de botella real de
 * `getDashboard()` tras `personasEnAlcance`).
 *
 * Aquí los 6 flags de coincidencia de CADA fila (país/zona/gestor/gerente/
 * pd/campaña) se calculan UNA sola vez; las 5 combinaciones restantes
 * (`rawFiltered` + una por dimensión) sólo leen esos booleanos ya calculados
 * — sin repetir acceso a campos ni normalización. Resultado matemáticamente
 * IDÉNTICO a llamar `filterCarteraRows` y `buildFilterOptions` por separado
 * con los mismos argumentos (cada flag depende únicamente de su propio
 * filtro, igual que antes — combinarlos no cambia ninguna condición).
 * Usado en los dos puntos reales donde ambas funciones se invocaban sobre
 * las MISMAS filas/filtros/personas: `CarteraService.getDashboard` e
 * `InteligenciaService.construirFilterOptionsCentro`. `filterCarteraRows` y
 * `buildFilterOptions` se conservan tal cual para sus otros llamadores
 * (`listCartera`, etc.) que no comparten ese mismo par de filas/filtros.
 */
export const filterCarteraRowsAndBuildFilterOptions = (
  rows: CarteraRow[],
  filters: DashboardMultiFilterParams,
  personas: PersonasEnAlcance
): { filtered: CarteraRow[]; filterOptions: FilterOptions } => {
  const gestoresPorNombre = personasPorNombre(personas.gestores);
  const gerentesPorNombre = personasPorNombre(personas.gerentes);

  const flags: RowMatchFlags[] = rows.map((row) => ({
    pais: rowMatchesFilter(row, filters.pais, ['pais']),
    zona: rowMatchesFilter(row, filters.zona, ['zona']),
    gestor: rowMatchesPersonaFilter(row, filters.gestor, gestoresPorNombre),
    gerente: rowMatchesPersonaFilter(row, filters.gerente, gerentesPorNombre),
    pd: rowMatchesFilter(row, filters.pd, ['pd_actual', 'pd']),
    campania: rowMatchesFilter(row, filters.campania, ['campania_adeuda', 'campania', 'campaña', 'campaign'])
  }));

  const byFlags = (excludeField?: keyof RowMatchFlags): CarteraRow[] =>
    rows.filter((_row, i) => {
      const f = flags[i];
      return (
        (excludeField === 'pais' || f.pais) &&
        (excludeField === 'zona' || f.zona) &&
        (excludeField === 'gestor' || f.gestor) &&
        (excludeField === 'gerente' || f.gerente) &&
        (excludeField === 'pd' || f.pd) &&
        (excludeField === 'campania' || f.campania)
      );
    });

  const filtered = byFlags();

  const paisZonaDeGestorSeleccionado = paisZonaDeSeleccion(personas.gestores, filters.gestor);
  const paisZonaDeGerenteSeleccionado = paisZonaDeSeleccion(personas.gerentes, filters.gerente);

  const filterOptions: FilterOptions = {
    pais: getUniqueOptions(byFlags('pais'), ['pais']),
    zona: getUniqueOptions(byFlags('zona'), ['zona']),
    gestor: opcionesPersonas(personas.gestores, filters.pais, filters.zona, paisZonaDeGerenteSeleccionado),
    gerente: opcionesPersonas(personas.gerentes, filters.pais, filters.zona, paisZonaDeGestorSeleccionado),
    pd: getUniqueOptions(byFlags('pd'), ['pd_actual', 'pd']),
    campania: getUniqueOptions(byFlags('campania'), ['campania_adeuda', 'campania', 'campaña', 'campaign'])
  };

  return { filtered, filterOptions };
};
