import { Router } from 'express';
import multer from 'multer';
import { UploadController } from '../controllers/UploadController';

const router = Router();
const controller = new UploadController();

// Almacenamiento EN MEMORIA: no se persiste el archivo en disco (Fase 2, paso 1).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB
});

router.post('/upload/cartera', upload.single('file'), (req, res) => controller.uploadCartera(req, res));

export default router;
