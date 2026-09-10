export interface MonedaOption {
  code: string;
  label: string;
  /** Nombre canónico del país (igual a ALLOWED_COUNTRIES[].name) cuya moneda local es esta. Ausente para Dólares (global). */
  pais?: string;
}

// Mismos países/monedas que ya usa el resto del dashboard (ver MONEDA_POR_PAIS en gestionService y ALLOWED_COUNTRIES en carteraAggregations).
export const MONEDA_OPTIONS: MonedaOption[] = [
  { code: 'USD', label: 'Dólares' },
  { code: 'GTQ', label: 'Quetzales', pais: 'Guatemala' },
  { code: 'HNL', label: 'Lempiras', pais: 'Honduras' },
  { code: 'NIO', label: 'Córdobas', pais: 'Nicaragua' },
  { code: 'PAB', label: 'Balboas', pais: 'Panamá' },
  { code: 'DOP', label: 'Pesos RD', pais: 'República Dominicana' }
];
