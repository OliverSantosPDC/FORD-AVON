import { Request, Response } from 'express';
import {
  getContenido,
  actualizarContenido,
  listarEnlaces,
  crearEnlace,
  actualizarEnlace,
  eliminarEnlace,
  InfoError,
  type CorporateLink
} from '../services/InfoService';
import { registrarAuditoria } from '../services/AuditoriaService';

export class InfoController {
  async contenido(_req: Request, res: Response): Promise<Response> {
    try {
      const [contenido, enlaces] = await Promise.all([getContenido(), listarEnlaces()]);
      return res.json({ contenido, enlaces });
    } catch (error) {
      return this.fail(res, error, 'No se pudo obtener la información.');
    }
  }

  async actualizarContenido(req: Request, res: Response): Promise<Response> {
    try {
      const actorId = req.auth?.userId ?? null;
      const patch = (req.body?.contenido ?? {}) as Record<string, string>;
      await actualizarContenido(patch, actorId);
      const entidad = Object.keys(patch).some((k) => k.startsWith('cvd_')) ? 'EDITAR_COBROS_VENTA_DIRECTA' : 'EDITAR_IDENTIDAD_EMPRESA';
      await registrarAuditoria(actorId, entidad, 'informacion', null, { claves: Object.keys(patch) });
      return res.json({ ok: true });
    } catch (error) {
      return this.fail(res, error, 'No se pudo actualizar la información.');
    }
  }

  async crearEnlace(req: Request, res: Response): Promise<Response> {
    try {
      const actorId = req.auth?.userId ?? null;
      const result = await crearEnlace(req.body as CorporateLink);
      await registrarAuditoria(actorId, 'EDITAR_ENLACE_CORPORATIVO', 'informacion', result.id, { accion: 'crear' });
      return res.status(201).json(result);
    } catch (error) {
      return this.fail(res, error, 'No se pudo crear el enlace.');
    }
  }

  async actualizarEnlace(req: Request, res: Response): Promise<Response> {
    try {
      const actorId = req.auth?.userId ?? null;
      await actualizarEnlace(req.params.id, req.body as CorporateLink);
      await registrarAuditoria(actorId, 'EDITAR_ENLACE_CORPORATIVO', 'informacion', req.params.id, { accion: 'actualizar' });
      return res.json({ ok: true });
    } catch (error) {
      return this.fail(res, error, 'No se pudo actualizar el enlace.');
    }
  }

  async eliminarEnlace(req: Request, res: Response): Promise<Response> {
    try {
      const actorId = req.auth?.userId ?? null;
      await eliminarEnlace(req.params.id);
      await registrarAuditoria(actorId, 'EDITAR_ENLACE_CORPORATIVO', 'informacion', req.params.id, { accion: 'eliminar' });
      return res.json({ ok: true });
    } catch (error) {
      return this.fail(res, error, 'No se pudo eliminar el enlace.');
    }
  }

  private fail(res: Response, error: unknown, fallback: string): Response {
    const message = error instanceof InfoError ? error.message : fallback;
    console.error('[INFO]', error);
    return res.status(400).json({ error: message });
  }
}
