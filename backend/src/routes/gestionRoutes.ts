import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { GestionController } from '../controllers/GestionController';

const router = Router();
const c = new GestionController();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Lecturas (scope aplicado en servicio).
router.get('/gestion/dashboard', requireAuth, requirePermission('gestion.ver'), (req, res) => c.dashboard(req, res));
router.get('/gestion/cuentas', requireAuth, requirePermission('gestion.ver'), (req, res) => c.cuentas(req, res));
router.get('/gestion/zonas-pd', requireAuth, requirePermission('gestion.ver'), (req, res) => c.zonasPd(req, res));
router.get('/gestion/pd-campanas', requireAuth, requirePermission('gestion.ver'), (req, res) => c.pdCampanas(req, res));
router.post('/gestion/estado', requireAuth, requirePermission('gestion.ver'), (req, res) => c.estado(req, res));
router.get('/gestion/cuentas/:codigo/detalle', requireAuth, requirePermission('gestion.ver'), (req, res) => c.detalle(req, res));
router.get('/gestion/cartas', requireAuth, requirePermission('gestion.ver'), (req, res) => c.listarCartas(req, res));

// Escrituras.
router.post('/gestion/cuentas/:codigo/tipificacion', requireAuth, requirePermission('gestion.gestionar'), (req, res) => c.tipificar(req, res));
router.post('/gestion/cuentas/:codigo/promesa', requireAuth, requirePermission('gestion.promesa.crear'), (req, res) => c.crearPromesa(req, res));
router.patch('/gestion/promesas/:id', requireAuth, requirePermission('gestion.promesa.editar'), (req, res) => c.actualizarPromesa(req, res));
router.post('/gestion/cuentas/:codigo/adjuntos', requireAuth, requirePermission('gestion.adjunto.subir'), upload.single('file'), (req, res) => c.subirAdjunto(req, res));
router.delete('/gestion/adjuntos/:id', requireAuth, requirePermission('gestion.adjunto.subir'), (req, res) => c.eliminarAdjunto(req, res));
router.post('/gestion/cuentas/:codigo/cartas', requireAuth, requirePermission('gestion.carta.crear'), (req, res) => c.crearCarta(req, res));
router.patch('/gestion/cartas/:id/aprobar', requireAuth, requirePermission('gestion.carta.aprobar'), (req, res) => c.aprobarCarta(req, res));
router.patch('/gestion/cartas/:id/rechazar', requireAuth, requirePermission('gestion.carta.aprobar'), (req, res) => c.rechazarCarta(req, res));

export default router;
