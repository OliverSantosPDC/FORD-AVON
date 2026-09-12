import { Request, Response } from 'express';
import {
  crearSolicitud,
  listarSolicitudes,
  resolverSolicitud,
  eliminarSolicitudesHistorial,
  PasswordRequestError
} from '../services/PasswordRequestService';

/**
 * Controlador de solicitudes de cambio de contraseña.
 * - `crear` es público (Login, sin sesión).
 * - `listar`/`resolver`/`eliminarHistorial` exigen requireAuth +
 *   requirePermission('usuarios.administrar_global').
 */
export class PasswordRequestController {
  async crear(req: Request, res: Response): Promise<Response> {
    try {
      const { email, motivo } = req.body ?? {};
      await crearSolicitud(String(email ?? ''), motivo ? String(motivo) : undefined);
      // Respuesta genérica: no revela si el correo existe.
      return res.json({ ok: true });
    } catch (error) {
      return this.fail(res, error, 'No se pudo registrar la solicitud.');
    }
  }

  async listar(_req: Request, res: Response): Promise<Response> {
    try {
      return res.json(await listarSolicitudes());
    } catch (error) {
      return this.fail(res, error, 'No se pudieron cargar las solicitudes.');
    }
  }

  async resolver(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const { accion, observaciones } = req.body ?? {};
      if (accion !== 'aprobar' && accion !== 'rechazar') {
        return res.status(400).json({ error: 'Acción inválida.' });
      }
      const actorId = req.auth?.userId ?? null;
      const result = await resolverSolicitud(id, accion, observaciones ? String(observaciones) : null, actorId);
      return res.json(result);
    } catch (error) {
      return this.fail(res, error, 'No se pudo resolver la solicitud.');
    }
  }

  /** DELETE /api/usuarios/password-requests — elimina registros del HISTORIAL (nunca PENDIENTE). */
  async eliminarHistorial(req: Request, res: Response): Promise<Response> {
    try {
      const { ids } = (req.body ?? {}) as { ids?: unknown };
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Debes indicar al menos un registro a eliminar.' });
      }
      const actorId = req.auth?.userId ?? null;
      const result = await eliminarSolicitudesHistorial(ids.map(String), actorId);
      return res.json(result);
    } catch (error) {
      return this.fail(res, error, 'No se pudo eliminar el historial.');
    }
  }

  private fail(res: Response, error: unknown, fallback: string): Response {
    if (error instanceof PasswordRequestError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('[PasswordRequest]', error);
    return res.status(500).json({ error: fallback });
  }
}
