import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente de Supabase para el frontend (navegador).
 * SÓLO usa la ANON/PUBLISHABLE KEY vía variables VITE_. NUNCA la service role.
 * Se usa exclusivamente para subir el archivo Excel directo a Supabase Storage.
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let client: SupabaseClient | null = null;

export const getSupabaseBrowserClient = (): SupabaseClient => {
  if (client) return client;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'Faltan variables de entorno del frontend: VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY.'
    );
  }

  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  return client;
};
