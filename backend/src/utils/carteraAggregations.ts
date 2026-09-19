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
 * Top Gestores: agrupa por la IDENTIDAD real del Gestor (`gestor_pais_zona`,
 * vía el mapa País-Zona→nombre de `gestorPorPaisZona`), nunca por el texto
 * `cartera.gestor` — mismo criterio que la autorización/el catálogo del
 * filtro (ver `rowMatchesPersonaFilter`/`opcionesPersonas`). Una fila cuyo
 * País-Zona no tiene ningún Gestor real asignado cae en "Sin gestor
 * asignado" (nunca inventa una persona a partir del texto de cartera).
 */
export const aggregateTopGestores = (records: CarteraRow[], gestorPorZona: Map<string, string>, limit = 20): GroupSummary[] =>
  aggregateGroupSummaries(records, (row) => resolverGestorReal(row, gestorPorZona))
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
 * Resuelve el Gestor real de una fila de cartera: si la cuenta tiene un
 * GESTOR EFECTIVO vigente (override de `asignaciones.gestor_nuevo_id`, ya
 * validado por `CarteraService.overlayEffectiveGestor` contra
 * `gestores.nombre_cartera` con `usuario_id`/`activo`), usa esa identidad
 * confirmada — marca presente en la fila como `gestor_original` (solo
 * existe cuando hubo override). Si no, resuelve por País-Zona
 * (`gestor_pais_zona`). Nunca el texto crudo `cartera.gestor` sin validar.
 */
const resolverGestorReal = (row: CarteraRow, gestorPorZona: Map<string, string>, fallback = 'Sin gestor asignado'): string => {
  if ((row as Record<string, unknown>).gestor_original !== undefined) {
    const efectivo = getFieldValue(row, ['gestor']);
    return efectivo || fallback;
  }
  const pais = getFieldValue(row, ['pais']);
  const zona = getFieldValue(row, ['zona']);
  if (!pais || !zona) return fallback;
  return gestorPorZona.get(paisZonaKey(pais, zona)) ?? fallback;
};

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
 * RELACIÓN CRUZADA Gestor↔Gerente (`supervisoresPermitidos`): auditoría real
 * de Supabase (project vuazzailuqgbjnnbdtrg) confirmó que el modelo actual
 * NO tiene una tabla de relación directa Gestor→Gerente. La única relación
 * real es estructural: ambos dependen del mismo Supervisor, en dos ramas
 * paralelas (`supervisor_gestor` y `supervisor_gerente_zona`). Por eso,
 * cuando el usuario tiene seleccionado un Gestor y/o un Gerente, la OTRA
 * dimensión se acota a las personas que comparten AL MENOS UN Supervisor con
 * la/las persona(s) seleccionada(s) — nunca a "todas las personas del
 * alcance del usuario conectado" (eso permitiría, p. ej., que seleccionar al
 * Gestor Angie Buch, supervisada por Daniel Monge, siguiera mostrando
 * Gerentes de Oliver Santos). `supervisoresPermitidos = null` significa "sin
 * selección activa en la otra dimensión" (sin recorte); un `Set` vacío
 * significa "la persona seleccionada no tiene Supervisor vigente" y por lo
 * tanto NINGUNA persona de la otra dimensión puede compartir uno — 0
 * opciones, correcto (nunca se amplía el alcance).
 */
const opcionesPersonas = (
  personas: PersonaFiltro[],
  filtrosPais: string[],
  filtrosZona: string[],
  supervisoresPermitidos: Set<string> | null
): string[] => {
  const paisSet = new Set(filtrosPais.map((v) => v.trim().toLocaleLowerCase()).filter(Boolean));
  const zonaSet = new Set(filtrosZona.map((v) => v.trim().toLocaleLowerCase()).filter(Boolean));
  const hayFiltroGeografico = paisSet.size > 0 || zonaSet.size > 0;

  return personas
    .filter((persona) => {
      if (supervisoresPermitidos && !persona.supervisorIds.some((id) => supervisoresPermitidos.has(id))) return false;
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

/** Supervisores vigentes de la(s) persona(s) actualmente SELECCIONADA(s) en
 *  un filtro (por nombre) — usado para acotar la dimensión Gestor↔Gerente
 *  cruzada (ver `opcionesPersonas`). `null` = sin selección (sin recorte). */
const supervisorIdsDeSeleccion = (personas: PersonaFiltro[], seleccionados: string[]): Set<string> | null => {
  if (seleccionados.length === 0) return null;
  const nombres = new Set(seleccionados.map((v) => v.trim().toLocaleLowerCase()));
  const ids = new Set<string>();
  personas.forEach((persona) => {
    if (nombres.has(persona.nombre.trim().toLocaleLowerCase())) {
      persona.supervisorIds.forEach((id) => ids.add(id));
    }
  });
  return ids;
};

export const buildFilterOptions = (
  rows: CarteraRow[],
  filters: DashboardMultiFilterParams,
  personas: PersonasEnAlcance
): FilterOptions => {
  const supervisoresDeGestorSeleccionado = supervisorIdsDeSeleccion(personas.gestores, filters.gestor);
  const supervisoresDeGerenteSeleccionado = supervisorIdsDeSeleccion(personas.gerentes, filters.gerente);
  return {
    pais: getUniqueOptions(filterRows(rows, filters, personas, 'pais'), ['pais']),
    zona: getUniqueOptions(filterRows(rows, filters, personas, 'zona'), ['zona']),
    gestor: opcionesPersonas(personas.gestores, filters.pais, filters.zona, supervisoresDeGerenteSeleccionado),
    gerente: opcionesPersonas(personas.gerentes, filters.pais, filters.zona, supervisoresDeGestorSeleccionado),
    pd: getUniqueOptions(filterRows(rows, filters, personas, 'pd'), ['pd_actual', 'pd']),
    campania: getUniqueOptions(filterRows(rows, filters, personas, 'campania'), ['campania_adeuda', 'campania', 'campaña', 'campaign'])
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
