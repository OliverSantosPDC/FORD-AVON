import { Router } from 'express';
import { DashboardController } from '../controllers/DashboardController';
import { CarteraService } from '../services/CarteraService';
import { CarteraRepository } from '../repositories/CarteraRepository';
import { getCarteraDataSource } from '../config/dataSource';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';

const router = Router();
const repository = new CarteraRepository(getCarteraDataSource());
const service = new CarteraService(repository);
const controller = new DashboardController(service);

// FASE 3.2 (cierre de perímetro): exigen usuario autenticado. Todavía SIN scope
// de datos (país/zona/gestor): eso llega en FASE 3.3.
//
// Corrección de visibilidad por rol: el frontend ya gatea el módulo Análisis
// (Sidebar + ruta /dashboard) con 'modulo.dashboard'/'modulo.centro_inteligencia'
// (ver config/navigation.tsx y routes/AppRoutes.tsx), pero estos dos endpoints
// solo exigían requireAuth — cualquier usuario autenticado (p. ej. Gerente o
// Gestor, a quienes se les retiró 'modulo.dashboard') podía seguir llamándolos
// directamente. Se agrega el mismo permiso real que ya usa el frontend, mismo
// mecanismo que /api/inteligencia/centro (inteligenciaRoutes.ts) ya aplicaba.
router.get('/dashboard', requireAuth, requirePermission('modulo.dashboard'), (req, res) => controller.getDashboard(req, res));
router.get('/inteligencia', requireAuth, requirePermission('modulo.centro_inteligencia'), (req, res) => controller.getInteligencia(req, res));

export default router;
