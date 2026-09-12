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
}

export interface PersonasEnAlcance {
  gestores: PersonaFiltro[];
  gerentes: PersonaFiltro[];
}

const paisZonaKey = (pais: unknown, zona: unknown): string =>
  `${normalizeValue(pais).toLocaleLowerCase()}||${normalizeValue(zona).toLocaleLowerCase()}`;

const personasPorNombre = (personas: PersonaFiltro[]): Map<string, PersonaFiltro> => {
  const map = new Map<string, PersonaFiltro>();
  personas.forEach((p) => map.set(p.nombre.trim().toLocaleLowerCase(), p));
  return map;
};

/**
 * ¿La fila queda incluida por la selección de Gestor/Gerente? Coincide si:
 * (a) el nombre de la fila (cartera.gestor/gerente_zona) es uno de los
 *     seleccionados — puente de compatibilidad para cuando SÍ coincide —, O
 * (b) el País-Zona EXACTO de la fila está entre los de alguna persona
 *     seleccionada (`gestor_pais_zona`/`gerente_zona_zona`), aunque su nombre
 *     NUNCA exista en `cartera` — mismo principio OR que ScopeFilter.applyScope,
 *     aplicado ahora a la SELECCIÓN del filtro (nunca `row.gestor === nombre`
 *     como única condición).
 */
const rowMatchesPersonaFilter = (
  row: CarteraRow,
  values: string[],
  nameKeys: string[],
  personasPorNombreLower: Map<string, PersonaFiltro>
): boolean => {
  if (!values.length) return true;
  const seleccionadas = values.map((v) => v.trim().toLocaleLowerCase());
  const rowNombre = getFieldValue(row, nameKeys).toLocaleLowerCase();
  if (rowNombre && seleccionadas.includes(rowNombre)) return true;

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

const filterRows = (
  rows: CarteraRow[],
  filters: DashboardMultiFilterParams,
  personas: PersonasEnAlcance,
  excludeField?: keyof DashboardMultiFilterParams
): CarteraRow[] => {
  const gestoresPorNombre = personasPorNombre(personas.gestores);
  const gerentesPorNombre = personasPorNombre(personas.gerentes);
  return rows.filter((row) => {
    if (excludeField !== 'pais' && !rowMatchesFilter(row, filters.pais, ['pais'])) return false;
    if (excludeField !== 'zona' && !rowMatchesFilter(row, filters.zona, ['zona'])) return false;
    if (excludeField !== 'gestor' && !rowMatchesPersonaFilter(row, filters.gestor, ['gestor'], gestoresPorNombre)) return false;
    if (excludeField !== 'gerente' && !rowMatchesPersonaFilter(row, filters.gerente, ['gerente', 'gerente_zona'], gerentesPorNombre)) return false;
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
 * gerentesZonaEnAlcance), nunca de `getUniqueOptions` sobre `cartera`. Cada
 * persona entra en la lista si alcanza alguna de las `filasElegibles` (las
 * filas ya acotadas por las DEMÁS dimensiones seleccionadas): por nombre
 * (cuando coincide con `cartera.gestor`/`gerente_zona`) o porque su propio
 * País-Zona intersecta el de esas filas — así una persona sin ninguna fila
 * con su nombre en cartera (p. ej. un Gestor nuevo, con gestor_pais_zona pero
 * 0 coincidencias de nombre) sigue apareciendo mientras su asignación
 * intersecte el universo filtrado.
 */
const opcionesPersonas = (personas: PersonaFiltro[], filasElegibles: CarteraRow[], nameKeys: string[]): string[] => {
  const paresPresentes = new Set<string>();
  const nombresPresentes = new Set<string>();
  filasElegibles.forEach((row) => {
    const nombre = getFieldValue(row, nameKeys).toLocaleLowerCase();
    if (nombre) nombresPresentes.add(nombre);
    const pais = getFieldValue(row, ['pais']);
    const zona = getFieldValue(row, ['zona']);
    if (pais && zona) paresPresentes.add(paisZonaKey(pais, zona));
  });

  return personas
    .filter((persona) => {
      if (nombresPresentes.has(persona.nombre.trim().toLocaleLowerCase())) return true;
      return persona.paisZona.some((pz) => paresPresentes.has(paisZonaKey(pz.pais, pz.zona)));
    })
    .map((persona) => persona.nombre)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
};

export const buildFilterOptions = (
  rows: CarteraRow[],
  filters: DashboardMultiFilterParams,
  personas: PersonasEnAlcance
): FilterOptions => ({
  pais: getUniqueOptions(filterRows(rows, filters, personas, 'pais'), ['pais']),
  zona: getUniqueOptions(filterRows(rows, filters, personas, 'zona'), ['zona']),
  gestor: opcionesPersonas(personas.gestores, filterRows(rows, filters, personas, 'gestor'), ['gestor']),
  gerente: opcionesPersonas(personas.gerentes, filterRows(rows, filters, personas, 'gerente'), ['gerente', 'gerente_zona']),
  pd: getUniqueOptions(filterRows(rows, filters, personas, 'pd'), ['pd_actual', 'pd']),
  campania: getUniqueOptions(filterRows(rows, filters, personas, 'campania'), ['campania_adeuda', 'campania', 'campaña', 'campaign'])
});

/**
 * Filtra las filas por los mismos criterios del dashboard (equivalente al
 * filteredTableData del frontend). Se usa para el detalle de cuentas, el
 * resumen por campaña y el resumen por país. Gestor/Gerente usan
 * `rowMatchesPersonaFilter` (nombre O País-Zona propio de la persona
 * seleccionada) — nunca solo `row.gestor === valor`.
 */
export const filterCarteraRows = (rows: CarteraRow[], filters: DashboardMultiFilterParams, personas: PersonasEnAlcance): CarteraRow[] => {
  const gestoresPorNombre = personasPorNombre(personas.gestores);
  const gerentesPorNombre = personasPorNombre(personas.gerentes);

  return rows.filter((row) => {
    if (!rowMatchesFilter(row, filters.pais, ['pais'])) return false;
    if (!rowMatchesPersonaFilter(row, filters.gestor, ['gestor'], gestoresPorNombre)) return false;
    if (!rowMatchesPersonaFilter(row, filters.gerente, ['gerente', 'gerente_zona'], gerentesPorNombre)) return false;
    if (!rowMatchesFilter(row, filters.zona, ['zona'])) return false;
    if (!rowMatchesFilter(row, filters.pd, ['pd_actual', 'pd'])) return false;
    if (!rowMatchesFilter(row, filters.campania, ['campania_adeuda', 'campania', 'campaña', 'campaign'])) return false;
    return true;
  });
};
