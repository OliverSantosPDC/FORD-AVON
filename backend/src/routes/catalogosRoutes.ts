import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { listCatalogoActivo, ConfigError } from '../services/ConfigService';

/**
 * Catálogos activos para consumo transversal (Gestión, Control Operativo).
 * Solo lectura de valores no sensibles; requiere sesión válida (requireAuth),
 * sin exigir permiso de Configuración para que cualquier gestor autorizado
 * pueda ver las tipificaciones/canales activos definidos por el administrador.
 */
const router = Router();

router.get('/catalogos/:catalogo', requireAuth, async (req: Request, res: Response) => {
  try {
    return res.json(await listCatalogoActivo(String(req.params.catalogo)));
  } catch (e) {
    return res.status(400).json({ error: e instanceof ConfigError ? e.message : 'No se pudo cargar el catálogo.' });
  }
});

export default router;
