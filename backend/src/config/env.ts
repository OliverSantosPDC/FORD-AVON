import 'dotenv/config';

/**
 * Configuración centralizada de variables de entorno.
 * Las credenciales de Supabase NUNCA se hardcodean: provienen exclusivamente
 * de variables de entorno (backend/.env, ignorado por git).
 */

/**
 * Normaliza la URL del proyecto Supabase.
 * `createClient` espera SÓLO el origen del proyecto (https://<ref>.supabase.co)
 * y él mismo añade "/rest/v1". Si el .env incluyera por error el sufijo
 * "/rest/v1" (o una barra final), las peticiones POST/INSERT construirían una
 * ruta duplicada ("/rest/v1/rest/v1/cartera") que el gateway rechaza con
 * "Invalid path specified in request URL". Aquí se recorta a sólo el origen.
 */
const normalizeSupabaseUrl = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    // Con URL válida, conservamos únicamente el origen (protocolo + host).
    return new URL(trimmed).origin;
  } catch {
    // Fallback defensivo si no es una URL parseable: quitar sufijos y barras.
    return trimmed.replace(/\/+$/, '').replace(/\/rest\/v1$/i, '').replace(/\/+$/, '');
  }
};

export const SUPABASE_URL = normalizeSupabaseUrl(process.env.SUPABASE_URL ?? '');
export const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();

/**
 * Fuente de datos del dashboard.
 * - 'supabase' (por defecto): el backend consulta la tabla `cartera` en Supabase.
 * - 'excel': fallback que lee Cartera.xlsx directamente (comportamiento anterior).
 */
export const DATA_SOURCE = (process.env.DATA_SOURCE ?? 'supabase').toLowerCase();

/** Nombre de la tabla de cartera en Supabase (normalizado sin espacios/CRLF). */
export const SUPABASE_CARTERA_TABLE = (process.env.SUPABASE_CARTERA_TABLE ?? 'cartera').trim();

/** Bucket de Supabase Storage donde se persiste el archivo de cartera. */
export const SUPABASE_CARTERA_BUCKET = (process.env.SUPABASE_CARTERA_BUCKET ?? 'cartera').trim();

/** Nombre fijo del objeto activo dentro del bucket. */
export const SUPABASE_CARTERA_OBJECT = (process.env.SUPABASE_CARTERA_OBJECT ?? 'Cartera.xlsx').trim();

/**
 * Lanza un error claro si faltan las credenciales de Supabase.
 * Se invoca de forma perezosa (sólo cuando realmente se usa Supabase),
 * para que el modo 'excel' y la compilación no requieran credenciales.
 */
export const assertSupabaseEnv = (): void => {
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');

  if (missing.length) {
    throw new Error(
      `Faltan variables de entorno de Supabase: ${missing.join(', ')}. ` +
        'Defínelas en backend/.env (usa backend/.env.example como referencia).'
    );
  }
};
