import { Request, Response } from 'express';
import { registrarAuditoria } from '../services/AuditoriaService';

/**
 * Controlador de sesión. Requiere que el middleware requireAuth ya haya
 * poblado req.auth. NO expone información sensible.
 */
export class AuthController {
  async me(req: Request, res: Response): Promise<Response> {
    const auth = req.auth;
    if (!auth) return res.status(401).json({ error: 'No autenticado.' });

    return res.json({
      user: {
        id: auth.profile.id,
        email: auth.profile.email,
        nombre: auth.profile.nombre,
        apellido: auth.profile.apellido
      },
      role: auth.role,
      permissions: auth.permissions,
      scope: auth.scope
    });
  }

  /** Registra eventos de sesión (login/logout) en auditoría. */
  async event(req: Request, res: Response): Promise<Response> {
    const auth = req.auth;
    if (!auth) return res.status(401).json({ error: 'No autenticado.' });

    const tipo = String((req.body as { tipo?: string } | undefined)?.tipo ?? '').toLowerCase();
    const accion = tipo === 'logout' ? 'logout' : 'login';
    await registrarAuditoria(auth.userId, accion, 'sesion', auth.userId);
    return res.json({ ok: true });
  }
}
