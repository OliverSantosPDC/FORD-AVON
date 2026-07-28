import 'dotenv/config';
import { SUPABASE_URL } from './env';

/**
 * Configuración de verificación de JWT de Supabase Auth.
 *
 * Supabase migró a "Signing Keys": los access tokens actuales se firman con una
 * clave asimétrica (ECC P-256 → ES256) y se validan con la clave PÚBLICA
 * publicada en el JWKS del proyecto. El antiguo esquema simétrico (HS256 con un
 * "shared secret") queda solo como clave LEGADA/previa durante la rotación.
 *
 * Por eso el backend valida preferentemente vía JWKS (clave pública, con soporte
 * de rotación) y usa SUPABASE_JWT_SECRET únicamente como respaldo para tokens
 * legados firmados en HS256.
 */

/** Secreto HS256 legado (Project Settings → API → JWT Secret). OPCIONAL ahora. */
export const SUPABASE_JWT_SECRET = (process.env.SUPABASE_JWT_SECRET ?? '').trim();

/**
 * Endpoint JWKS del proyecto (claves públicas de firma). Se DERIVA de SUPABASE_URL
 * ya existente; no requiere una variable nueva.
 *   https://<ref>.supabase.co/auth/v1/.well-known/jwks.json
 */
export const SUPABASE_JWKS_URL = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` : '';

/** Issuer esperado de los tokens de Supabase Auth: https://<ref>.supabase.co/auth/v1 */
export const SUPABASE_ISSUER = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1` : '';

/** Audiencia estándar de los access tokens de usuarios autenticados. Configurable. */
export const SUPABASE_AUDIENCE = (process.env.SUPABASE_JWT_AUD ?? 'authenticated').trim();

/** Verdadero si hay al menos un mecanismo de verificación disponible. */
export const isAuthConfigured = (): boolean => Boolean(SUPABASE_JWKS_URL || SUPABASE_JWT_SECRET);
