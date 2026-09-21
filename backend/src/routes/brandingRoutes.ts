import { Router, Request, Response } from 'express';
import { urlAsset } from '../services/ConfigService';

const router = Router();

/**
 * Branding público — SIN requireAuth, igual que /auth/password-change-request:
 * el Login se renderiza ANTES de que exista una sesión, así que no puede
 * llamar a ningún endpoint autenticado para resolver su propio logo. El
 * favicon del navegador también debe fijarse antes de iniciar sesión.
 *
 * Expone ÚNICAMENTE las 3 claves que de verdad se necesitan sin sesión
 * (logo_login, favicon, fondo_login — este último se agregó al conectar
 * Configuración > Apariencia > Fondos, mismo motivo: el fondo del Login se
 * pinta antes de que exista sesión) — nunca una clave arbitraria ni el
 * resto de Configuración (nombre del sistema, tasas, catálogos, fondo
 * principal/dashboard, etc. siguen exigiendo requireAuth como hasta ahora).
 * "No configurado" nunca es un error: el frontend cae a su fallback estático
 * si algo viene null.
 */
router.get('/branding', async (_req: Request, res: Response) => {
  const [logoLogin, favicon, fondoLogin] = await Promise.all([
    urlAsset('logo_login').catch(() => null),
    urlAsset('favicon').catch(() => null),
    urlAsset('fondo_login').catch(() => null)
  ]);
  return res.json({ logoLogin, favicon, fondoLogin });
});

export default router;
