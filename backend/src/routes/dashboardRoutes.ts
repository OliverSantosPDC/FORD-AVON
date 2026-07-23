import { Router } from 'express';
import { DashboardController } from '../controllers/DashboardController';
import { CarteraService } from '../services/CarteraService';
import { CarteraRepository } from '../repositories/CarteraRepository';
import { getCarteraDataSource } from '../config/dataSource';

const router = Router();
const repository = new CarteraRepository(getCarteraDataSource());
const service = new CarteraService(repository);
const controller = new DashboardController(service);

router.get('/dashboard', (req, res) => controller.getDashboard(req, res));
router.get('/inteligencia', (req, res) => controller.getInteligencia(req, res));

export default router;
