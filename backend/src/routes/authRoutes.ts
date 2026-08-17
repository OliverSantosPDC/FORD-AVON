import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { AuthController } from '../controllers/AuthController';
import { PasswordRequestController } from '../controllers/PasswordRequestController';

const router = Router();
const controller = new AuthController();
const passwordRequests = new PasswordRequestController();

// Ambos endpoints exigen JWT válido. NO se protege aún dashboard/cartera/inteligencia.
router.get('/auth/me', requireAuth, (req, res) => controller.me(req, res));
router.post('/auth/event', requireAuth, (req, res) => controller.event(req, res));

// Público: solicitud de cambio de contraseña desde el Login (sin sesión).
router.post('/auth/password-change-request', (req, res) => passwordRequests.crear(req, res));

export default router;
