import crypto from 'crypto';
import jwt, { JwtPayload, VerifyOptions } from 'jsonwebtoken';
import {
  SUPABASE_JWKS_URL,
  SUPABASE_ISSUER,
  SUPABASE_AUDIENCE,
  SUPABASE_JWT_SECRET
} from '../config/authEnv';

/**
 * Verificador de JWT de Supabase Auth compatible con "Signing Keys":
 *  - Tokens firmados con clave asimétrica (ES256/RS256): se validan con la clave
 *    PÚBLICA obtenida del JWKS del proyecto, seleccionada por `kid`.
 *  - Tokens legados HS256: se validan con SUPABASE_JWT_SECRET (respaldo).
 *
 * Soporta rotación de claves: si llega un `kid` desconocido o la caché expiró,
 * se vuelve a descargar el JWKS (con un intervalo mínimo anti-abuso).
 */

interface JwksResponse {
  keys?: crypto.JsonWebKey[];
}

const JWKS_TTL_MS = 10 * 60 * 1000; // Caché de claves: 10 minutos.
const JWKS_MIN_REFETCH_MS = 30 * 1000; // No refrescar más de 1 vez cada 30 s.

let cachedKeys = new Map<string, crypto.KeyObject>();
let lastFetch = 0;
let lastAttempt = 0;

const fetchJwks = async (): Promise<void> => {
  if (!SUPABASE_JWKS_URL) throw new Error('JWKS no configurado (falta SUPABASE_URL).');
  lastAttempt = Date.now();

  const res = await fetch(SUPABASE_JWKS_URL);
  if (!res.ok) throw new Error(`No se pudo obtener el JWKS (HTTP ${res.status}).`);

  const body = (await res.json()) as JwksResponse;
  const next = new Map<string, crypto.KeyObject>();

  for (const jwk of body.keys ?? []) {
    const kid = (jwk as { kid?: string }).kid;
    if (!kid) continue;
    try {
      next.set(kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
    } catch {
      // Clave no convertible: se ignora en silencio (no debe tumbar el resto).
    }
  }

  cachedKeys = next;
  lastFetch = Date.now();
};

const getPublicKey = async (kid: string): Promise<crypto.KeyObject | null> => {
  const cacheFresh = Date.now() - lastFetch < JWKS_TTL_MS;

  // Refresca si: no tenemos ese kid (posible rotación) o la caché expiró,
  // respetando un intervalo mínimo entre descargas.
  const needsRefresh = !cachedKeys.has(kid) || !cacheFresh;
  const canRefetch = Date.now() - lastAttempt > JWKS_MIN_REFETCH_MS;

  if (needsRefresh && (canRefetch || cachedKeys.size === 0)) {
    await fetchJwks();
  }

  return cachedKeys.get(kid) ?? null;
};

const decodeHeader = (token: string): { kid?: string; alg?: string } => {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string') return {};
  return { kid: decoded.header.kid, alg: decoded.header.alg };
};

export interface VerifiedToken {
  userId: string;
  payload: JwtPayload;
}

/** Datos NO sensibles del token, útiles para diagnóstico (sin firma ni secretos). */
export const tokenDiagnostics = (token: string): Record<string, unknown> => {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string') return { decodable: false };
  const payload = decoded.payload as JwtPayload;
  return {
    alg: decoded.header.alg,
    kid: decoded.header.kid,
    iss: payload.iss,
    aud: payload.aud,
    sub_present: Boolean(payload.sub),
    exp: payload.exp
  };
};

/**
 * Verifica firma + issuer + audience + expiración. Devuelve el userId (sub).
 * Lanza Error con mensaje claro (sin exponer secretos) si algo falla.
 */
export const verifySupabaseToken = async (token: string): Promise<VerifiedToken> => {
  const { kid, alg } = decodeHeader(token);

  const baseOptions: VerifyOptions = {
    algorithms: [],
    ...(SUPABASE_ISSUER ? { issuer: SUPABASE_ISSUER } : {}),
    ...(SUPABASE_AUDIENCE ? { audience: SUPABASE_AUDIENCE } : {})
  };

  let payload: JwtPayload;

  if (alg === 'HS256') {
    // Token legado firmado con el shared secret (esquema previo).
    if (!SUPABASE_JWT_SECRET) {
      throw new Error('Token HS256 recibido pero SUPABASE_JWT_SECRET no está configurado.');
    }
    payload = jwt.verify(token, SUPABASE_JWT_SECRET, {
      ...baseOptions,
      algorithms: ['HS256']
    }) as JwtPayload;
  } else if (alg === 'ES256' || alg === 'RS256') {
    // Token actual firmado con clave asimétrica → validar con clave pública (JWKS).
    if (!kid) throw new Error('El token no incluye `kid`; no se puede seleccionar la clave pública.');
    const key = await getPublicKey(kid);
    if (!key) throw new Error('No se encontró en el JWKS una clave pública para el `kid` del token.');
    payload = jwt.verify(token, key, {
      ...baseOptions,
      algorithms: [alg]
    }) as JwtPayload;
  } else {
    throw new Error(`Algoritmo de firma no soportado: ${alg ?? 'desconocido'}.`);
  }

  const userId = typeof payload.sub === 'string' ? payload.sub : '';
  if (!userId) throw new Error('El token no contiene `sub` (identificador de usuario).');

  return { userId, payload };
};
