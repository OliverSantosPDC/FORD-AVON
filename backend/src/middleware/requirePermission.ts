import { Request, Response, NextFunction } from 'express';
import { registrarAuditoria } from '../services/AuditoriaService';

/**
 * Middleware de autorización por PERMISO (no por rol). Debe ejecutarse SIEMPRE
 * después de `requireAuth`, que ya pobló `req.auth` con perfil/rol/permisos.
 *
 * La autorización se basa en la clave de permiso (p. ej. `cartera.importar`),
 * de modo que cualquier rol que tenga ese permiso queda autorizado. Así, si el
 * permiso está asignado a Administrador y Supervisor, ambos pasan; el resto no.
 */
export const requirePermission = (permission: string) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const auth = req.auth;
    if (!auth) {
      res.status(401).json({ error: 'No autenticado.' });
      return;
    }

    if (!auth.permissions.includes(permission)) {
      await registrarAuditoria(auth.userId, 'acceso_denegado', 'permiso', permission, {
        permiso: permission,
        rol: auth.role?.clave ?? null
      });
      res.status(403).json({ error: 'No autorizado para esta acción.' });
      return;
    }

    next();
  };
};
