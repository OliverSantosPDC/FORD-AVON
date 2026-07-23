import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, assertSupabaseEnv } from './env';

/**
 * Cliente de Supabase creado de forma perezosa (singleton).
 * Se usa la SERVICE ROLE KEY porque este cliente corre exclusivamente en el
 * backend (nunca se expone al navegador) y necesita permisos para importar
 * y leer datos sin restricciones de RLS.
 */
let client: SupabaseClient | null = null;

export const getSupabaseClient = (): SupabaseClient => {
  if (client) {
    return client;
  }

  assertSupabaseEnv();

  client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  return client;
};
