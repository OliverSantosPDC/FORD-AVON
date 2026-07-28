import { Router } from 'express';
import { UploadController } from '../controllers/UploadController';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';

const router = Router();
const controller = new UploadController();

// El archivo se sube directo a Supabase Storage desde el frontend.
// Estos endpoints (sin multer) disparan y consultan el procesamiento asíncrono.
//
// FASE 3.2 (importación): ambos exigen usuario autenticado + permiso
// `cartera.importar`. La autorización es por PERMISO, no por rol, de modo que
// Administrador y Supervisor (que lo tienen asignado) pueden importar; el resto no.
// NO se modifica el flujo de importación (Storage → Render → streaming → reemplazo → invalidación).
const CARTERA_IMPORT = 'cartera.importar';

router.post('/cartera/process', requireAuth, requirePermission(CARTERA_IMPORT), (req, res) =>
  controller.startProcessCartera(req, res)
);
router.get('/cartera/process/:jobId', requireAuth, requirePermission(CARTERA_IMPORT), (req, res) =>
  controller.getProcessStatus(req, res)
);

export default router;
