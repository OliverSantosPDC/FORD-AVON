export interface MonedaOption {
  code: string;
  label: string;
  /** Símbolo/sigla a mostrar en gráficos (nunca el código ISO). */
  symbol: string;
  /** Nombre canónico del país (igual a ALLOWED_COUNTRIES[].name) cuya moneda local es esta. Ausente para Dólares (global). */
  pais?: string;
}

// Mismos países/monedas que ya usa el resto del dashboard (ver MONEDA_POR_PAIS en gestionService y ALLOWED_COUNTRIES en carteraAggregations).
export const MONEDA_OPTIONS: MonedaOption[] = [
  { code: 'USD', label: 'Dólares', symbol: '$' },
  { code: 'GTQ', label: 'Quetzales', symbol: 'Q', pais: 'Guatemala' },
  { code: 'HNL', label: 'Lempiras', symbol: 'L', pais: 'Honduras' },
  { code: 'NIO', label: 'Córdobas', symbol: 'C', pais: 'Nicaragua' },
  { code: 'PAB', label: 'Balboas', symbol: 'B/$', pais: 'Panamá' },
  { code: 'DOP', label: 'Pesos RD', symbol: 'RD$', pais: 'República Dominicana' }
];

/** Símbolo/sigla visual a usar en gráficos para un código de moneda (nunca el código ISO). */
export const simboloMoneda = (code: string): string =>
  MONEDA_OPTIONS.find((option) => option.code === code)?.symbol ?? code;
