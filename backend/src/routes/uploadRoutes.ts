import { Router } from 'express';
import { UploadController } from '../controllers/UploadController';

const router = Router();
const controller = new UploadController();

// Nueva arquitectura: el archivo se sube directo a Supabase Storage desde el
// frontend. Este endpoint (sin multer, sin recibir el archivo) sólo dispara el
// procesamiento: descargar de Storage y reemplazar la tabla `cartera`.
router.post('/cartera/process', (req, res) => controller.processCartera(req, res));

export default router;
