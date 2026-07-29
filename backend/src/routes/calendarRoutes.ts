import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { CalendarController } from '../controllers/CalendarController';

const router = Router();
const controller = new CalendarController();

// Todos los endpoints exigen JWT válido + permiso de calendario. El scope de
// datos se aplica dentro de CalendarService (reutiliza req.auth.scopeContext).
router.get('/calendario/tipos', requireAuth, requirePermission('calendario.ver'), (req, res) => controller.tipos(req, res));
router.get('/calendario', requireAuth, requirePermission('calendario.ver'), (req, res) => controller.list(req, res));
router.get('/calendario/:id', requireAuth, requirePermission('calendario.ver'), (req, res) => controller.detail(req, res));
router.post('/calendario', requireAuth, requirePermission('calendario.crear'), (req, res) => controller.create(req, res));
router.patch('/calendario/:id', requireAuth, requirePermission('calendario.editar'), (req, res) => controller.update(req, res));
router.delete('/calendario/:id', requireAuth, requirePermission('calendario.eliminar'), (req, res) => controller.remove(req, res));

export default router;
