import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { AuthController } from '../controllers/AuthController';

const router = Router();
const controller = new AuthController();

// Ambos endpoints exigen JWT válido. NO se protege aún dashboard/cartera/inteligencia.
router.get('/auth/me', requireAuth, (req, res) => controller.me(req, res));
router.post('/auth/event', requireAuth, (req, res) => controller.event(req, res));

export default router;
