import { Request, Response } from 'express';
import { registrarAuditoria } from '../services/AuditoriaService';
import { limpiarEstadoPasswordTemporal } from '../services/UsuariosService';

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
      scope: auth.scope,
      passwordPolicy: auth.passwordPolicy
    });
  }

  /**
   * POST /api/auth/password-changed — el propio usuario confirma que ya
   * cambió su contraseña (temporal vigente O vencida, ver requireAuth) desde
   * el flujo de Login/RootLayout. Limpia SOLO su propio estado temporal
   * (nunca el de otro usuario_id: siempre req.auth.userId, jamás un id del
   * body/params). No recibe ni valida la contraseña en sí — eso ya lo hizo
   * Supabase Auth vía authService.updatePassword() en el cliente; este
   * endpoint únicamente actualiza los metadatos de vigencia en profiles.
   */
  async passwordChanged(req: Request, res: Response): Promise<Response> {
    const auth = req.auth;
    if (!auth) return res.status(401).json({ error: 'No autenticado.' });
    try {
      await limpiarEstadoPasswordTemporal(auth.userId);
      await registrarAuditoria(auth.userId, 'password.cambiar_propia', 'usuarios', auth.userId, {});
      return res.json({ ok: true });
    } catch (error) {
      console.error('[AUTH] password-changed', error);
      return res.status(400).json({ error: 'No se pudo actualizar el estado de la contraseña.' });
    }
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
