import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { AsignacionController } from '../controllers/AsignacionController';

const router = Router();
const c = new AsignacionController();
const VER = 'control_operativo.asignacion.ver';
const SIMULAR = 'control_operativo.asignacion.simular';
const APLICAR = 'control_operativo.asignacion.aplicar';
const REASIGNAR = 'control_operativo.reasignacion';

router.get('/control/asignacion/gestores', requireAuth, requirePermission(VER), (req, res) => c.gestores(req, res));
router.get('/control/asignacion/historial', requireAuth, requirePermission(VER), (req, res) => c.historial(req, res));
router.post('/control/asignacion/simular', requireAuth, requirePermission(SIMULAR), (req, res) => c.simular(req, res));
router.post('/control/asignacion/aplicar', requireAuth, requirePermission(APLICAR), (req, res) => c.aplicar(req, res));
router.post('/control/asignacion/reasignar', requireAuth, requirePermission(REASIGNAR), (req, res) => c.reasignar(req, res));

export default router;
