import { Router } from 'express';
import { DashboardController } from '../controllers/DashboardController';
import { CarteraService } from '../services/CarteraService';
import { CarteraRepository } from '../repositories/CarteraRepository';
import { getCarteraDataSource } from '../config/dataSource';
import { requireAuth } from '../middleware/auth';

const router = Router();
const repository = new CarteraRepository(getCarteraDataSource());
const service = new CarteraService(repository);
const controller = new DashboardController(service);

// FASE 3.2 (cierre de perímetro): exigen usuario autenticado. Todavía SIN scope
// de datos (país/zona/gestor): eso llega en FASE 3.3.
router.get('/dashboard', requireAuth, (req, res) => controller.getDashboard(req, res));
router.get('/inteligencia', requireAuth, (req, res) => controller.getInteligencia(req, res));

export default router;
