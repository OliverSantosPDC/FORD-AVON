import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { SUPABASE_JWT_SECRET } from '../config/authEnv';
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
 * Middleware que exige un JWT válido de Supabase, verifica su firma localmente
 * con SUPABASE_JWT_SECRET, y carga el perfil/rol/permisos en req.auth.
 * NO aplica todavía ningún filtrado de datos por alcance.
 */
export const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!SUPABASE_JWT_SECRET) {
      res.status(500).json({ error: 'Autenticación no configurada en el servidor (falta SUPABASE_JWT_SECRET).' });
      return;
    }

    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'No autenticado.' });
      return;
    }

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, SUPABASE_JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    } catch {
      res.status(401).json({ error: 'Token inválido o expirado.' });
      return;
    }

    const userId = typeof payload.sub === 'string' ? payload.sub : '';
    if (!userId) {
      res.status(401).json({ error: 'Token sin usuario.' });
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
