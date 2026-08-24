import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { InteligenciaController } from '../controllers/InteligenciaController';

const router = Router();
const c = new InteligenciaController();

// Centro de Inteligencia consolidado (una sola carga). Protegido por sesión + permiso de módulo.
router.get('/inteligencia/centro', requireAuth, requirePermission('modulo.centro_inteligencia'), (req, res) => c.centro(req, res));

export default router;
