import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { ConfigController } from '../controllers/ConfigController';

const router = Router();
const c = new ConfigController();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const VER = 'configuracion.ver';
const EDIT = 'configuracion.editar';

router.get('/configuracion/general', requireAuth, requirePermission(VER), (req, res) => c.general(req, res));
router.put('/configuracion/general', requireAuth, requirePermission(EDIT), (req, res) => c.guardarGeneral(req, res));

router.get('/configuracion/catalogos', requireAuth, requirePermission(VER), (req, res) => c.catalogos(req, res));
router.post('/configuracion/catalogos', requireAuth, requirePermission(EDIT), (req, res) => c.crearCatalogo(req, res));
router.patch('/configuracion/catalogos/:id', requireAuth, requirePermission(EDIT), (req, res) => c.actualizarCatalogo(req, res));
router.delete('/configuracion/catalogos/:id', requireAuth, requirePermission(EDIT), (req, res) => c.eliminarCatalogo(req, res));

router.get('/configuracion/variables', requireAuth, requirePermission(VER), (req, res) => c.variables(req, res));
router.post('/configuracion/variables', requireAuth, requirePermission(EDIT), (req, res) => c.crearVariable(req, res));
router.patch('/configuracion/variables/:id', requireAuth, requirePermission(EDIT), (req, res) => c.actualizarVariable(req, res));

router.get('/configuracion/roles', requireAuth, requirePermission(VER), (req, res) => c.rolesPermisos(req, res));
router.put('/configuracion/roles/:roleId/permisos', requireAuth, requirePermission(EDIT), (req, res) => c.guardarRolPermisos(req, res));

router.get('/configuracion/plantillas', requireAuth, requirePermission(VER), (req, res) => c.plantillas(req, res));
router.get('/configuracion/plantillas/:clave/descargar', requireAuth, requirePermission(VER), (req, res) => c.descargarPlantilla(req, res));
router.post('/configuracion/plantillas/:clave', requireAuth, requirePermission(EDIT), upload.single('file'), (req, res) => c.subirPlantilla(req, res));

router.get('/configuracion/auditoria', requireAuth, requirePermission(VER), (req, res) => c.auditoria(req, res));
router.post('/configuracion/assets/:clave', requireAuth, requirePermission(EDIT), upload.single('file'), (req, res) => c.subirAsset(req, res));

export default router;
