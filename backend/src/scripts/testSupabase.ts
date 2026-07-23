import { getSupabaseClient } from '../config/supabaseClient';
import { SUPABASE_CARTERA_TABLE } from '../config/env';

/**
 * Prueba de conexión a Supabase.
 * Verifica que las credenciales sean válidas y que la tabla `cartera`
 * sea accesible, mostrando el número de filas almacenadas.
 *
 * Uso: node dist/scripts/testSupabase.js
 */
const main = async (): Promise<void> => {
  console.log('=== Prueba de conexión a Supabase ===');

  const client = getSupabaseClient();
  const { count, error } = await client
    .from(SUPABASE_CARTERA_TABLE)
    .select('*', { count: 'exact', head: true });

  if (error) {
    throw new Error(`Conexión fallida al consultar "${SUPABASE_CARTERA_TABLE}": ${error.message}`);
  }

  console.log('Conexión exitosa.');
  console.log(`Tabla "${SUPABASE_CARTERA_TABLE}" accesible. Filas actuales: ${count ?? 0}`);
};

main().catch((err) => {
  console.error('');
  console.error('ERROR DE CONEXIÓN:');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
