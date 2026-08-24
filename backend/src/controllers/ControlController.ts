import { Request, Response } from 'express';
import { CarteraService } from '../services/CarteraService';
import { CarteraRepository } from '../repositories/CarteraRepository';
import { getCarteraDataSource } from '../config/dataSource';
import { aggGestores, aggZonasGestores, aggPdCampanas, contadores, indicadores, pendientes, ControlError, crearEvaluacionCalidad, listarEvaluacionesCalidad, resumenCalidad, gestoresParaCalidad, type CalidadInput } from '../services/ControlService';

const carteraService = new CarteraService(new CarteraRepository(getCarteraDataSource()));

const parseFilter = (v: unknown): string[] | undefined => {
  if (typeof v === 'string') { const a = v.split(',').map((x) => x.trim()).filter(Boolean); return a.length ? a : undefined; }
  if (Array.isArray(v)) { const a = v.flatMap((x) => (typeof x === 'string' ? x.split(',') : [])).map((x) => x.trim()).filter(Boolean); return a.length ? a : undefined; }
  return undefined;
};
const filtros = (q: Record<string, unknown>) => ({ pais: parseFilter(q.pais), gestor: parseFilter(q.gestor), gerente: parseFilter(q.gerente), zona: parseFilter(q.zona), pd: parseFilter(q.pd), campania: parseFilter(q.campania) });

export class ControlController {
  private scope(req: Request, res: Response) { const ctx = req.auth?.scopeContext; if (!ctx) { res.status(403).json({ error: 'Alcance de acceso no disponible.' }); return null; } return ctx; }

  async dashboard(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const d = await carteraService.getDashboard(filtros(req.query), ctx);
      const rows = await carteraService.listCartera(filtros(req.query), 1000000, ctx);
      return res.json({ ...d, contadores: contadores(rows) });
    } catch (e) { return this.fail(res, e); }
  }
  async gestores(req: Request, res: Response): Promise<Response | void> {
    try { const ctx = this.scope(req, res); if (!ctx) return; const rows = await carteraService.listCartera(filtros(req.query), 1000000, ctx); return res.json(aggGestores(rows)); } catch (e) { return this.fail(res, e); }
  }
  async zonas(req: Request, res: Response): Promise<Response | void> {
    try { const ctx = this.scope(req, res); if (!ctx) return; const rows = await carteraService.listCartera(filtros(req.query), 1000000, ctx); return res.json(aggZonasGestores(rows)); } catch (e) { return this.fail(res, e); }
  }
  async pdCampanas(req: Request, res: Response): Promise<Response | void> {
    try { const ctx = this.scope(req, res); if (!ctx) return; const rows = await carteraService.listCartera(filtros(req.query), 1000000, ctx); return res.json(aggPdCampanas(rows)); } catch (e) { return this.fail(res, e); }
  }
  async cuentas(req: Request, res: Response): Promise<Response | void> {
    try { const ctx = this.scope(req, res); if (!ctx) return; return res.json(await carteraService.listCartera(filtros(req.query), 100000, ctx)); } catch (e) { return this.fail(res, e); }
  }
  async indicadores(req: Request, res: Response): Promise<Response | void> {
    try { const ctx = this.scope(req, res); if (!ctx) return; return res.json(await indicadores(ctx)); } catch (e) { return this.fail(res, e); }
  }
  async pendientes(req: Request, res: Response): Promise<Response | void> {
    try { const ctx = this.scope(req, res); if (!ctx) return; return res.json(await pendientes(ctx)); } catch (e) { return this.fail(res, e); }
  }

  // ===== Calidad de Gestión =====
  async calidadGestores(req: Request, res: Response): Promise<Response | void> {
    try { const ctx = this.scope(req, res); if (!ctx) return; return res.json(await gestoresParaCalidad(ctx)); } catch (e) { return this.fail(res, e); }
  }
  async calidadListar(req: Request, res: Response): Promise<Response | void> {
    try { const ctx = this.scope(req, res); if (!ctx) return; const f = filtros(req.query); return res.json(await listarEvaluacionesCalidad(ctx, { pais: f.pais, zona: f.zona, gestor: f.gestor })); } catch (e) { return this.fail(res, e); }
  }
  async calidadResumen(req: Request, res: Response): Promise<Response | void> {
    try { const ctx = this.scope(req, res); if (!ctx) return; const f = filtros(req.query); return res.json(await resumenCalidad(ctx, { pais: f.pais, zona: f.zona, gestor: f.gestor })); } catch (e) { return this.fail(res, e); }
  }
  async calidadCrear(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const b = (req.body ?? {}) as Partial<CalidadInput>;
      if (!b.gestorNombre) return res.status(400).json({ error: 'El gestor evaluado es obligatorio.' });
      const input: CalidadInput = {
        gestorId: b.gestorId ?? null,
        gestorNombre: String(b.gestorNombre),
        pais: b.pais ?? null,
        zona: b.zona ?? null,
        cuenta: b.cuenta ?? null,
        tipificacion: b.tipificacion ?? null,
        criterios: (b.criterios ?? {}) as Record<string, number>,
        penalizaciones: (b.penalizaciones ?? {}) as Record<string, number>,
        observaciones: b.observaciones ?? null
      };
      return res.json(await crearEvaluacionCalidad(ctx, input));
    } catch (e) { return this.fail(res, e); }
  }

  private fail(res: Response, error: unknown): Response {
    const message = error instanceof ControlError ? error.message : 'Error de control operativo.';
    console.error('[CONTROL]', error);
    return res.status(400).json({ error: message });
  }
}
