import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { ControlController } from '../controllers/ControlController';

const router = Router();
const c = new ControlController();
const VER = 'control_operativo.ver';
const CAL_VER = 'control_operativo.calidad.ver';
const CAL_EDIT = 'control_operativo.calidad.editar';

router.get('/control/dashboard', requireAuth, requirePermission(VER), (req, res) => c.dashboard(req, res));
router.get('/control/gestores', requireAuth, requirePermission(VER), (req, res) => c.gestores(req, res));
router.get('/control/zonas', requireAuth, requirePermission(VER), (req, res) => c.zonas(req, res));
router.get('/control/pd-campanas', requireAuth, requirePermission(VER), (req, res) => c.pdCampanas(req, res));
router.get('/control/cuentas', requireAuth, requirePermission(VER), (req, res) => c.cuentas(req, res));
router.get('/control/indicadores', requireAuth, requirePermission(VER), (req, res) => c.indicadores(req, res));
router.get('/control/pendientes', requireAuth, requirePermission(VER), (req, res) => c.pendientes(req, res));
router.get('/control/resumen-operativo', requireAuth, requirePermission(VER), (req, res) => c.resumenOperativo(req, res));

// Calidad de Gestión
router.get('/control/calidad/gestores', requireAuth, requirePermission(CAL_VER), (req, res) => c.calidadGestores(req, res));
router.get('/control/calidad/resumen', requireAuth, requirePermission(CAL_VER), (req, res) => c.calidadResumen(req, res));
router.get('/control/calidad', requireAuth, requirePermission(CAL_VER), (req, res) => c.calidadListar(req, res));
router.post('/control/calidad', requireAuth, requirePermission(CAL_EDIT), (req, res) => c.calidadCrear(req, res));

export default router;
