import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { UsuariosController } from '../controllers/UsuariosController';

const router = Router();
const controller = new UsuariosController();

// Subida de la plantilla en memoria (archivos pequeños de usuarios).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Módulo Usuarios: administración GLOBAL. Todas las rutas exigen JWT válido +
// permiso `usuarios.administrar_global` (reutiliza el sistema de permisos existente).
// El orden importa: rutas específicas antes de `/usuarios/:id`.
const ADMIN = 'usuarios.administrar_global';

router.get('/usuarios/plantilla', requireAuth, requirePermission(ADMIN), (req, res) => controller.plantilla(req, res));
router.post('/usuarios/importar/validar', requireAuth, requirePermission(ADMIN), upload.single('file'), (req, res) => controller.importarValidar(req, res));
router.post('/usuarios/importar/aplicar', requireAuth, requirePermission(ADMIN), upload.single('file'), (req, res) => controller.importarAplicar(req, res));

router.get('/usuarios/catalogos', requireAuth, requirePermission(ADMIN), (req, res) => controller.catalogos(req, res));
router.get('/usuarios', requireAuth, requirePermission(ADMIN), (req, res) => controller.list(req, res));
router.get('/usuarios/:id', requireAuth, requirePermission(ADMIN), (req, res) => controller.detail(req, res));
router.post('/usuarios', requireAuth, requirePermission(ADMIN), (req, res) => controller.create(req, res));
router.patch('/usuarios/:id', requireAuth, requirePermission(ADMIN), (req, res) => controller.update(req, res));

export default router;
