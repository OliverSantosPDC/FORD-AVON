import { Request, Response } from 'express';
import {
  contarNoLeidas, listarNotificaciones, marcarLeida, marcarTodasLeidas, NotificacionesError
} from '../services/NotificacionesService';

/**
 * Notificaciones (campana del Header). Cada endpoint resuelve el
 * destinatario EXCLUSIVAMENTE desde `req.auth.userId` (el usuario
 * autenticado) — nunca desde un parámetro de la petición — así que no
 * existe forma de consultar ni marcar las notificaciones de otro usuario,
 * ni manipulando la URL ni el body.
 */
export class NotificacionesController {
  async contador(req: Request, res: Response): Promise<Response | void> {
    try {
      const usuarioId = req.auth?.userId;
      if (!usuarioId) return res.status(401).json({ error: 'No autenticado.' });
      const noLeidas = await contarNoLeidas(usuarioId);
      return res.json({ noLeidas });
    } catch (e) { return this.fail(res, e, 'No se pudo cargar el contador de notificaciones.'); }
  }

  async listar(req: Request, res: Response): Promise<Response | void> {
    try {
      const usuarioId = req.auth?.userId;
      if (!usuarioId) return res.status(401).json({ error: 'No autenticado.' });
      const limit = Number(req.query.limit) || undefined;
      const offset = Number(req.query.offset) || undefined;
      const soloNoLeidas = req.query.soloNoLeidas === 'true';
      const notificaciones = await listarNotificaciones(usuarioId, { limit, offset, soloNoLeidas });
      return res.json(notificaciones);
    } catch (e) { return this.fail(res, e, 'No se pudieron cargar las notificaciones.'); }
  }

  /** PATCH /api/notificaciones/:id/leida — 404 tanto si no existe como si
   *  no pertenece al usuario autenticado (nunca se revela cuál de los dos). */
  async marcarLeida(req: Request, res: Response): Promise<Response | void> {
    try {
      const usuarioId = req.auth?.userId;
      if (!usuarioId) return res.status(401).json({ error: 'No autenticado.' });
      const ok = await marcarLeida(req.params.id, usuarioId);
      if (!ok) return res.status(404).json({ error: 'Notificación no encontrada.' });
      return res.json({ ok: true });
    } catch (e) { return this.fail(res, e, 'No se pudo marcar la notificación.'); }
  }

  async marcarTodasLeidas(req: Request, res: Response): Promise<Response | void> {
    try {
      const usuarioId = req.auth?.userId;
      if (!usuarioId) return res.status(401).json({ error: 'No autenticado.' });
      const cantidad = await marcarTodasLeidas(usuarioId);
      return res.json({ ok: true, cantidad });
    } catch (e) { return this.fail(res, e, 'No se pudieron marcar las notificaciones.'); }
  }

  private fail(res: Response, error: unknown, fallback: string): Response {
    const message = error instanceof NotificacionesError ? error.message : fallback;
    console.error('[NOTIFICACIONES]', error);
    return res.status(400).json({ error: message });
  }
}
