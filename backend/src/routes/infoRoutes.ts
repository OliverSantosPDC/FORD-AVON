import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { InfoController } from '../controllers/InfoController';

const router = Router();
const controller = new InfoController();

// Lectura: cualquier usuario con informacion.ver. Escritura: informacion.editar.
router.get('/informacion', requireAuth, requirePermission('informacion.ver'), (req, res) => controller.contenido(req, res));
router.put('/informacion', requireAuth, requirePermission('informacion.editar'), (req, res) => controller.actualizarContenido(req, res));
router.post('/informacion/enlaces', requireAuth, requirePermission('informacion.editar'), (req, res) => controller.crearEnlace(req, res));
router.patch('/informacion/enlaces/:id', requireAuth, requirePermission('informacion.editar'), (req, res) => controller.actualizarEnlace(req, res));
router.delete('/informacion/enlaces/:id', requireAuth, requirePermission('informacion.editar'), (req, res) => controller.eliminarEnlace(req, res));

export default router;
