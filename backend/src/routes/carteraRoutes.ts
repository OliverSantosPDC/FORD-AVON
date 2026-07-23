import { Router } from 'express';
import { CarteraController } from '../controllers/CarteraController';
import { CarteraService } from '../services/CarteraService';
import { CarteraRepository } from '../repositories/CarteraRepository';
import { getCarteraDataSource } from '../config/dataSource';

const router = Router();
const repository = new CarteraRepository(getCarteraDataSource());
const service = new CarteraService(repository);
const controller = new CarteraController(service);

router.get('/cartera', (req, res) => controller.getCartera(req, res));

export default router;
