import { Router, Request, Response } from 'express';
import { urlAsset } from '../services/ConfigService';

const router = Router();

/**
 * Branding público — SIN requireAuth, igual que /auth/password-change-request:
 * el Login se renderiza ANTES de que exista una sesión, así que no puede
 * llamar a ningún endpoint autenticado para resolver su propio logo. El
 * favicon del navegador también debe fijarse antes de iniciar sesión.
 *
 * Expone ÚNICAMENTE las 2 claves que de verdad se necesitan sin sesión
 * (logo_login, favicon) — nunca una clave arbitraria ni el resto de
 * Configuración (nombre del sistema, tasas, catálogos, etc. siguen exigiendo
 * requireAuth como hasta ahora). "No configurado" nunca es un error: el
 * frontend cae a su fallback estático si algo viene null.
 */
router.get('/branding', async (_req: Request, res: Response) => {
  const [logoLogin, favicon] = await Promise.all([
    urlAsset('logo_login').catch(() => null),
    urlAsset('favicon').catch(() => null)
  ]);
  return res.json({ logoLogin, favicon });
});

export default router;
