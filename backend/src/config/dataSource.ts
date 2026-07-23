import { DATA_SOURCE } from './env';
import { CarteraDataSource } from '../repositories/CarteraRepository';
import { SupabaseCarteraAdapter } from '../adapters/supabase/SupabaseCarteraAdapter';
import { ExcelCarteraAdapter } from '../adapters/excel/ExcelCarteraAdapter';

/**
 * Selecciona la fuente de datos del dashboard según la variable DATA_SOURCE.
 * Por defecto usa Supabase; 'excel' queda disponible como fallback.
 * Se cachea la instancia para reutilizarla entre peticiones.
 */
let cached: CarteraDataSource | null = null;

export const getCarteraDataSource = (): CarteraDataSource => {
  if (cached) {
    return cached;
  }

  cached = DATA_SOURCE === 'excel' ? new ExcelCarteraAdapter() : new SupabaseCarteraAdapter();
  return cached;
};
