import { getSupabaseClient } from './config/supabaseClient';
import { SUPABASE_CARTERA_TABLE } from './config/env';

/**
 * Prueba de conexión rápida a Supabase.
 * (Versión canónica y mantenida en src/scripts/testSupabase.ts;
 *  este archivo se conserva por compatibilidad.)
 */
async function testConnection() {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from(SUPABASE_CARTERA_TABLE)
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('ERROR DE SUPABASE:');
    console.error(error);
    process.exit(1);
  }

  console.log('CONEXIÓN EXITOSA CON SUPABASE');
  console.log(`Filas en "${SUPABASE_CARTERA_TABLE}":`, count ?? 0);
}

testConnection();
