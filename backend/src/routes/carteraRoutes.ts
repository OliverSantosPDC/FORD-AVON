import { Router } from 'express';
import { CarteraController } from '../controllers/CarteraController';
import { CarteraService } from '../services/CarteraService';
import { CarteraRepository } from '../repositories/CarteraRepository';
import { getCarteraDataSource } from '../config/dataSource';
import { requireAuth } from '../middleware/auth';

const router = Router();
const repository = new CarteraRepository(getCarteraDataSource());
const service = new CarteraService(repository);
const controller = new CarteraController(service);

// FASE 3.2 (cierre de perímetro): exige usuario autenticado. Todavía SIN scope
// de datos (país/zona/gestor): eso llega en FASE 3.3.
router.get('/cartera', requireAuth, (req, res) => controller.getCartera(req, res));

export default router;
