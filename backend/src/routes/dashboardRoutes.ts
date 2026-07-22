import { Router } from 'express';
import { DashboardController } from '../controllers/DashboardController';
import { CarteraService } from '../services/CarteraService';
import { CarteraRepository } from '../repositories/CarteraRepository';
import { ExcelAdapter } from '../adapters/excel/ExcelAdapter';
import path from 'path';

const router = Router();
const excelBasePath = path.join(__dirname, '../../data/excel');
const adapter = new ExcelAdapter(excelBasePath);
const repository = new CarteraRepository(adapter);
const service = new CarteraService(repository);
const controller = new DashboardController(service);

router.get('/dashboard', (req, res) => controller.getDashboard(req, res));
router.get('/inteligencia', (req, res) => controller.getInteligencia(req, res));

export default router;
