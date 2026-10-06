import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { NotificacionesController } from '../controllers/NotificacionesController';

const router = Router();
const c = new NotificacionesController();

// Solo requireAuth: cada usuario consulta/marca ÚNICAMENTE sus propias
// notificaciones (el servicio acota TODA consulta por
// usuario_destinatario_id = req.auth.userId) — no hay ninguna acción sobre
// notificaciones de otro usuario que un permiso de módulo deba bloquear,
// igual que "Mi firma de autorización" en gestionRoutes.ts.
router.get('/notificaciones/contador', requireAuth, (req, res) => c.contador(req, res));
router.get('/notificaciones', requireAuth, (req, res) => c.listar(req, res));
router.patch('/notificaciones/:id/leida', requireAuth, (req, res) => c.marcarLeida(req, res));
router.patch('/notificaciones/leidas', requireAuth, (req, res) => c.marcarTodasLeidas(req, res));

export default router;
