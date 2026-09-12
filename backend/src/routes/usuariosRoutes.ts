import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { requirePermission, requireAnyPermission } from '../middleware/requirePermission';
import { UsuariosController } from '../controllers/UsuariosController';
import { PasswordRequestController } from '../controllers/PasswordRequestController';

const router = Router();
const controller = new UsuariosController();
const passwordRequests = new PasswordRequestController();

// Subida de la plantilla en memoria (archivos pequeños de usuarios).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Módulo Usuarios. Las acciones DESTRUCTIVAS/GLOBALES (crear, editar, eliminar,
// restablecer contraseña, importación masiva) exigen `usuarios.administrar_global`
// exclusivamente (sin cambios respecto al comportamiento anterior). Las acciones
// de SOLO LECTURA (listar, ver detalle, catálogos, resumen de alcance) además
// aceptan `usuarios.administrar_alcance` (p. ej. supervisor), que hasta ahora
// existía como permiso asignado pero nunca se comprobaba en ningún endpoint —
// esto NO relaja ningún control: solo habilita lectura para quien YA tenía ese
// permiso otorgado en Supabase. El orden importa: rutas específicas antes de
// `/usuarios/:id`.
const ADMIN = 'usuarios.administrar_global';
const ALCANCE = 'usuarios.administrar_alcance';
const lectura = requireAnyPermission(ADMIN, ALCANCE);

router.get('/usuarios/plantilla', requireAuth, requirePermission(ADMIN), (req, res) => controller.plantilla(req, res));
router.post('/usuarios/importar/validar', requireAuth, requirePermission(ADMIN), upload.single('file'), (req, res) => controller.importarValidar(req, res));
router.post('/usuarios/importar/aplicar', requireAuth, requirePermission(ADMIN), upload.single('file'), (req, res) => controller.importarAplicar(req, res));

// Solicitudes de cambio de contraseña (antes de '/usuarios/:id' para evitar colisión de rutas).
router.get('/usuarios/password-requests', requireAuth, requirePermission(ADMIN), (req, res) => passwordRequests.listar(req, res));
router.post('/usuarios/password-requests/:id/resolver', requireAuth, requirePermission(ADMIN), (req, res) => passwordRequests.resolver(req, res));

router.get('/usuarios/resumen-alcance', requireAuth, lectura, (req, res) => controller.resumenAlcance(req, res));
router.get('/usuarios/catalogos', requireAuth, lectura, (req, res) => controller.catalogos(req, res));
router.get('/usuarios', requireAuth, lectura, (req, res) => controller.list(req, res));
router.get('/usuarios/:id', requireAuth, lectura, (req, res) => controller.detail(req, res));
router.post('/usuarios', requireAuth, requirePermission(ADMIN), (req, res) => controller.create(req, res));
router.patch('/usuarios/:id/password', requireAuth, requirePermission(ADMIN), (req, res) => controller.resetPassword(req, res));
router.patch('/usuarios/:id', requireAuth, requirePermission(ADMIN), (req, res) => controller.update(req, res));
router.delete('/usuarios/:id', requireAuth, requirePermission(ADMIN), (req, res) => controller.remove(req, res));

export default router;
