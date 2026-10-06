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

router.get('/configuracion/tasas-conversion', requireAuth, requirePermission(VER), (req, res) => c.tasasConversion(req, res));
router.patch('/configuracion/tasas-conversion/:id', requireAuth, requirePermission(EDIT), (req, res) => c.actualizarTasaConversion(req, res));

router.get('/configuracion/metas', requireAuth, requirePermission(VER), (req, res) => c.metaGlobal(req, res));
router.put('/configuracion/metas', requireAuth, requirePermission(EDIT), (req, res) => c.guardarMetaGlobal(req, res));

router.get('/configuracion/roles', requireAuth, requirePermission(VER), (req, res) => c.rolesPermisos(req, res));
router.put('/configuracion/roles/:roleId/permisos', requireAuth, requirePermission(EDIT), (req, res) => c.guardarRolPermisos(req, res));

router.get('/configuracion/plantillas', requireAuth, requirePermission(VER), (req, res) => c.plantillas(req, res));
router.get('/configuracion/plantillas/:clave/descargar', requireAuth, requirePermission(VER), (req, res) => c.descargarPlantilla(req, res));
router.post('/configuracion/plantillas/:clave', requireAuth, requirePermission(EDIT), upload.single('file'), (req, res) => c.subirPlantilla(req, res));

// Plantillas de carta de cobro por PD (PD1-PD3 comparten una, PD4-PD7 cada una la suya; PD0 no tiene carta).
router.get('/configuracion/plantillas-carta', requireAuth, requirePermission(VER), (req, res) => c.plantillasCarta(req, res));
router.put('/configuracion/plantillas-carta/:clave', requireAuth, requirePermission(EDIT), (req, res) => c.actualizarPlantillaCarta(req, res));
router.get('/configuracion/plantillas-carta/:clave/preview', requireAuth, requirePermission(VER), (req, res) => c.previsualizarPlantillaCarta(req, res));
router.post('/configuracion/plantillas-carta/:clave/preview-borrador', requireAuth, requirePermission(EDIT), (req, res) => c.previsualizarBorradorPlantillaCarta(req, res));

// Firma de carta, configurable POR SUPERVISOR real (nunca hardcodeada ni global).
router.get('/configuracion/supervisores-firma', requireAuth, requirePermission(VER), (req, res) => c.supervisoresFirma(req, res));
router.post('/configuracion/supervisores-firma/:supervisorId', requireAuth, requirePermission(EDIT), upload.single('file'), (req, res) => c.subirFirmaSupervisor(req, res));
router.get('/configuracion/supervisores-firma/:supervisorId/url', requireAuth, requirePermission(VER), (req, res) => c.urlFirmaSupervisor(req, res));

// Sin requirePermission(VER) a propósito: logo_principal se resuelve desde el
// Sidebar/Header para CUALQUIER usuario autenticado (no solo quienes tienen
// acceso al módulo Configuración) — mostrar un logo ya configurado no es una
// operación sensible; solo cambiarlo (POST más abajo) sigue exigiendo EDIT.
router.get('/configuracion/assets/:clave/url', requireAuth, (req, res) => c.urlAsset(req, res));
router.post('/configuracion/assets/:clave', requireAuth, requirePermission(EDIT), upload.single('file'), (req, res) => c.subirAsset(req, res));

export default router;
