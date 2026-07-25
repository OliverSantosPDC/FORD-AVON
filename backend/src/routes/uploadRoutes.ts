import { Router } from 'express';
import { UploadController } from '../controllers/UploadController';

const router = Router();
const controller = new UploadController();

// El archivo se sube directo a Supabase Storage desde el frontend.
// Estos endpoints (sin multer) disparan y consultan el procesamiento asíncrono.
router.post('/cartera/process', (req, res) => controller.startProcessCartera(req, res));
router.get('/cartera/process/:jobId', (req, res) => controller.getProcessStatus(req, res));

export default router;
