import { Request, Response, NextFunction } from 'express';
import { isAuthConfigured } from '../config/authEnv';
import { verifySupabaseToken, tokenDiagnostics } from '../services/JwtVerifier';
import { AuthContext, loadAuthContext } from '../services/PerfilService';
import { registrarAuditoria } from '../services/AuditoriaService';

// Extiende Express.Request con el contexto autenticado.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const extractToken = (req: Request): string | null => {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
};

/**
 * Middleware que exige un JWT válido de Supabase Auth. Verifica la firma con la
 * clave PÚBLICA del JWKS del proyecto (ES256/RS256) o, como respaldo, con el
 * secreto HS256 legado; valida issuer/audience/expiración; y carga
 * perfil/rol/permisos en req.auth. NO aplica todavía filtrado de datos por alcance.
 */
export const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isAuthConfigured()) {
      res.status(500).json({ error: 'Autenticación no configurada en el servidor (falta SUPABASE_URL o SUPABASE_JWT_SECRET).' });
      return;
    }

    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'No autenticado.' });
      return;
    }

    let userId: string;
    try {
      const verified = await verifySupabaseToken(token);
      userId = verified.userId;
    } catch (err) {
      // Log de diagnóstico TEMPORAL: nunca imprime el token completo ni secretos.
      console.warn('[AUTH] Verificación JWT fallida:', (err as Error).message, tokenDiagnostics(token));
      res.status(401).json({ error: 'Token inválido o expirado.' });
      return;
    }

    const context = await loadAuthContext(userId);
    if (!context) {
      await registrarAuditoria(userId, 'acceso_denegado', 'sesion', userId, { motivo: 'perfil inexistente o inactivo' });
      res.status(403).json({ error: 'Perfil no encontrado o inactivo.' });
      return;
    }

    req.auth = context;
    next();
  } catch (error) {
    next(error);
  }
};
