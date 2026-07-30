import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { ControlController } from '../controllers/ControlController';

const router = Router();
const c = new ControlController();
const VER = 'control_operativo.ver';

router.get('/control/dashboard', requireAuth, requirePermission(VER), (req, res) => c.dashboard(req, res));
router.get('/control/gestores', requireAuth, requirePermission(VER), (req, res) => c.gestores(req, res));
router.get('/control/zonas', requireAuth, requirePermission(VER), (req, res) => c.zonas(req, res));
router.get('/control/pd-campanas', requireAuth, requirePermission(VER), (req, res) => c.pdCampanas(req, res));
router.get('/control/cuentas', requireAuth, requirePermission(VER), (req, res) => c.cuentas(req, res));
router.get('/control/indicadores', requireAuth, requirePermission(VER), (req, res) => c.indicadores(req, res));
router.get('/control/pendientes', requireAuth, requirePermission(VER), (req, res) => c.pendientes(req, res));

export default router;
