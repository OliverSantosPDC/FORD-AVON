import { Router } from 'express';
import { CarteraController } from '../controllers/CarteraController';
import { CarteraService } from '../services/CarteraService';
import { CarteraRepository } from '../repositories/CarteraRepository';
import { ExcelAdapter } from '../adapters/excel/ExcelAdapter';
import path from 'path';

const router = Router();
const excelBasePath = path.join(__dirname, '../../data/excel');
const adapter = new ExcelAdapter(excelBasePath);
const repository = new CarteraRepository(adapter);
const service = new CarteraService(repository);
const controller = new CarteraController(service);

router.get('/cartera', (req, res) => controller.getCartera(req, res));

export default router;
