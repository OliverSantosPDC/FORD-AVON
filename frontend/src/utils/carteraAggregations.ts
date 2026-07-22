import type { CarteraRecord } from '../types/cartera';

// Países soportados por la operación ejecutiva, con su abreviatura estándar y bandera.
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

export const normalizeText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

export const resolveCountry = (rawValue: unknown): CountryInfo | null => {
  const normalized = normalizeText(String(rawValue ?? ''));
  if (!normalized) return null;
  return ALLOWED_COUNTRIES.find((country) => country.matches.includes(normalized)) ?? null;
};

export const getField = (row: CarteraRecord, keys: string[]) => {
  const lookup = new Map<string, unknown>();
  Object.keys(row).forEach((key) => lookup.set(key.toLowerCase(), row[key]));
  for (const key of keys) {
    const value = lookup.get(key.toLowerCase());
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

const FIELD_KEYS = {
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

const getString = (row: CarteraRecord, keys: string[], fallback = '') => {
  const value = getField(row, keys);
  return value === undefined ? fallback : String(value).trim();
};

const getNumber = (row: CarteraRecord, keys: string[]) => parseNumber(getField(row, keys));

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

const buildGroupSummary = (key: string, rows: CarteraRecord[]): GroupSummary => {
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

const groupBy = (records: CarteraRecord[], keys: string[], fallback: string) => {
  const groups = new Map<string, CarteraRecord[]>();
  records.forEach((row) => {
    const value = getString(row, keys) || fallback;
    const list = groups.get(value) ?? [];
    list.push(row);
    groups.set(value, list);
  });
  return groups;
};

export const aggregateTopGestores = (records: CarteraRecord[], limit = 20): GroupSummary[] => {
  const groups = groupBy(records, FIELD_KEYS.gestor, 'Sin gestor');
  return Array.from(groups.entries())
    .map(([key, rows]) => buildGroupSummary(key, rows))
    .sort((a, b) => b.recuperadoUsd - a.recuperadoUsd)
    .slice(0, limit);
};

export const aggregateTopZonas = (records: CarteraRecord[], limit = 20): GroupSummary[] => {
  const groups = groupBy(records, FIELD_KEYS.zona, 'Sin zona');
  return Array.from(groups.entries())
    .map(([key, rows]) => buildGroupSummary(key, rows))
    .sort((a, b) => b.saldoActualUsd - a.saldoActualUsd)
    .slice(0, limit);
};

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

export const aggregateCountrySummary = (records: CarteraRecord[]): CountrySummary[] => {
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

export const aggregateResumenCampania = (records: CarteraRecord[]): CampaniaSummary[] => {
  const groups = groupBy(records, FIELD_KEYS.campania, 'Sin campaña');

  return Array.from(groups.entries())
    .map(([campania, rows]) => {
      const summary = buildGroupSummary(campania, rows);
      const promesas = rows.reduce((sum, row) => sum + getNumber(row, FIELD_KEYS.promesas), 0);
      const pagos = rows.reduce((sum, row) => sum + getNumber(row, FIELD_KEYS.pagos), 0);
      return {
        campania,
        cuentas: summary.cuentas,
        saldoAsignadoUsd: summary.saldoAsignadoUsd,
        saldoActualUsd: summary.saldoActualUsd,
        saldoAsignadoLocal: summary.saldoAsignadoLocal,
        saldoActualLocal: summary.saldoActualLocal,
        recuperadoUsd: summary.recuperadoUsd,
        porcentajeRecuperacion: summary.porcentajeRecuperacion,
        promesas,
        pagos
      };
    })
    .sort((a, b) => b.saldoAsignadoUsd - a.saldoAsignadoUsd);
};

export const getCarteraField = getField;
export const carteraFieldKeys = FIELD_KEYS;

// Orden de riesgo fijo utilizado en toda la interfaz ejecutiva: nunca se ordena alfabéticamente.
export const PD_ORDER = ['PD0', 'PD1', 'PD2', 'PD3', 'PD4', 'PD5', 'PD6', 'PD7'];

export const getPdIndex = (pd: string) => {
  const normalized = String(pd ?? '').trim().toUpperCase();
  const index = PD_ORDER.indexOf(normalized);
  return index === -1 ? PD_ORDER.length : index;
};

export interface PdEstado {
  label: string;
  color: string;
  dot: string;
}

const PD_ESTADOS: Record<string, PdEstado> = {
  PD0: { label: 'Excelente', color: '#22C55E', dot: '🟢' },
  PD1: { label: 'Controlado', color: '#16A34A', dot: '🟢' },
  PD2: { label: 'Atención', color: '#EAB308', dot: '🟡' },
  PD3: { label: 'Seguimiento', color: '#F59E0B', dot: '🟡' },
  PD4: { label: 'Riesgo', color: '#F97316', dot: '🟠' },
  PD5: { label: 'Alto Riesgo', color: '#EA580C', dot: '🟠' },
  PD6: { label: 'Crítico', color: '#EF4444', dot: '🔴' },
  PD7: { label: 'Muy Crítico', color: '#B91C1C', dot: '🔴' }
};

export const getPdEstado = (pd: string): PdEstado => {
  const normalized = String(pd ?? '').trim().toUpperCase();
  return PD_ESTADOS[normalized] ?? { label: 'Sin clasificar', color: '#9CA3AF', dot: '⚪' };
};
