import { Request, Response } from 'express';
import {
  listarTipos,
  listarEventos,
  obtenerEvento,
  crearEvento,
  actualizarEvento,
  eliminarEvento,
  CalendarError,
  type CalendarEventInput,
  type CalendarFiltros
} from '../services/CalendarService';
import { registrarAuditoria } from '../services/AuditoriaService';

export class CalendarController {
  async tipos(_req: Request, res: Response): Promise<Response> {
    try {
      return res.json(await listarTipos());
    } catch (error) {
      return this.fail(res, error, 'No se pudieron obtener los tipos de evento.');
    }
  }

  async list(req: Request, res: Response): Promise<Response> {
    try {
      const ctx = req.auth?.scopeContext;
      if (!ctx) return res.status(403).json({ error: 'Alcance de acceso no disponible.' });
      const filtros: CalendarFiltros = {
        tipoEventoId: str(req.query.tipoEventoId),
        pais: str(req.query.pais),
        zonaId: str(req.query.zonaId),
        usuarioId: str(req.query.usuarioId),
        desde: str(req.query.desde),
        hasta: str(req.query.hasta)
      };
      return res.json(await listarEventos(ctx, filtros));
    } catch (error) {
      return this.fail(res, error, 'No se pudieron obtener los eventos.');
    }
  }

  async detail(req: Request, res: Response): Promise<Response> {
    try {
      const ctx = req.auth?.scopeContext;
      if (!ctx) return res.status(403).json({ error: 'Alcance de acceso no disponible.' });
      const ev = await obtenerEvento(req.params.id, ctx);
      if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });
      return res.json(ev);
    } catch (error) {
      return this.fail(res, error, 'No se pudo obtener el evento.');
    }
  }

  async create(req: Request, res: Response): Promise<Response> {
    try {
      const actorId = req.auth?.userId ?? null;
      const result = await crearEvento(req.body as CalendarEventInput, actorId);
      await registrarAuditoria(actorId, 'CREAR_EVENTO_CALENDARIO', 'calendario', result.id, { titulo: (req.body as CalendarEventInput)?.titulo });
      return res.status(201).json(result);
    } catch (error) {
      return this.fail(res, error, 'No se pudo crear el evento.');
    }
  }

  async update(req: Request, res: Response): Promise<Response> {
    try {
      const actorId = req.auth?.userId ?? null;
      await actualizarEvento(req.params.id, req.body as CalendarEventInput);
      await registrarAuditoria(actorId, 'EDITAR_EVENTO_CALENDARIO', 'calendario', req.params.id, null);
      return res.json({ ok: true });
    } catch (error) {
      return this.fail(res, error, 'No se pudo actualizar el evento.');
    }
  }

  async remove(req: Request, res: Response): Promise<Response> {
    try {
      const actorId = req.auth?.userId ?? null;
      await eliminarEvento(req.params.id);
      await registrarAuditoria(actorId, 'ELIMINAR_EVENTO_CALENDARIO', 'calendario', req.params.id, null);
      return res.json({ ok: true });
    } catch (error) {
      return this.fail(res, error, 'No se pudo eliminar el evento.');
    }
  }

  private fail(res: Response, error: unknown, fallback: string): Response {
    const message = error instanceof CalendarError ? error.message : fallback;
    console.error('[CALENDARIO]', error);
    return res.status(400).json({ error: message });
  }
}

const str = (v: unknown): string | undefined => {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return undefined;
};
