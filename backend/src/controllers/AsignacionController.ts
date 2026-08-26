import { Request, Response } from 'express';
import { CarteraService } from '../services/CarteraService';
import { CarteraRepository } from '../repositories/CarteraRepository';
import { getCarteraDataSource } from '../config/dataSource';
import { simular, aplicar, reasignarManual, listarHistorial, AsignacionError, type ReglaAsignacion } from '../services/AsignacionService';
import { gestoresParaCalidad } from '../services/ControlService';

const carteraService = new CarteraService(new CarteraRepository(getCarteraDataSource()));

const parseFilter = (v: unknown): string[] | undefined => {
  if (typeof v === 'string') { const a = v.split(',').map((x) => x.trim()).filter(Boolean); return a.length ? a : undefined; }
  if (Array.isArray(v)) { const a = v.flatMap((x) => (typeof x === 'string' ? x.split(',') : [])).map((x) => x.trim()).filter(Boolean); return a.length ? a : undefined; }
  return undefined;
};
const filtros = (q: Record<string, unknown>) => ({ pais: parseFilter(q.pais), gestor: parseFilter(q.gestor), gerente: parseFilter(q.gerente), zona: parseFilter(q.zona), pd: parseFilter(q.pd), campania: parseFilter(q.campania) });
const reglaDeBody = (b: Record<string, unknown>): ReglaAsignacion => ({
  ambito: (b.ambito as ReglaAsignacion['ambito']) ?? 'GLOBAL',
  grupoPrioritarioPct: Number(b.grupoPrioritarioPct ?? 80),
  criterio: (b.criterio === 'cuentas' ? 'cuentas' : 'saldo'),
  gestoresPrioritario: Array.isArray(b.gestoresPrioritario) ? (b.gestoresPrioritario as string[]) : [],
  gestoresResto: Array.isArray(b.gestoresResto) ? (b.gestoresResto as string[]) : []
});

export class AsignacionController {
  private scope(req: Request, res: Response) { const ctx = req.auth?.scopeContext; if (!ctx) { res.status(403).json({ error: 'Alcance de acceso no disponible.' }); return null; } return ctx; }

  async gestores(req: Request, res: Response): Promise<Response | void> {
    try { const ctx = this.scope(req, res); if (!ctx) return; return res.json(await gestoresParaCalidad(ctx)); } catch (e) { return this.fail(res, e); }
  }
  async simular(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const b = (req.body ?? {}) as Record<string, unknown>;
      const rows = await carteraService.listCartera(filtros((b.filtros as Record<string, unknown>) ?? {}), 1000000, ctx);
      return res.json(simular(rows, reglaDeBody(b)));
    } catch (e) { return this.fail(res, e); }
  }
  async aplicar(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const b = (req.body ?? {}) as Record<string, unknown>;
      const rows = await carteraService.listCartera(filtros((b.filtros as Record<string, unknown>) ?? {}), 1000000, ctx);
      return res.json(await aplicar(ctx, rows, reglaDeBody(b)));
    } catch (e) { return this.fail(res, e); }
  }
  async reasignar(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const b = (req.body ?? {}) as { codigo?: string; gestorNuevo?: string; motivo?: string };
      const codigo = String(b.codigo ?? '');
      // Verifica que la cuenta esté dentro del alcance del usuario.
      const scoped = await carteraService.listCartera({}, 1000000, ctx);
      const cuenta = scoped.find((r) => String(r.codigo ?? r.code ?? '') === codigo);
      if (!cuenta) return res.status(403).json({ error: 'La cuenta no está dentro de tu alcance.' });
      const result = await reasignarManual(ctx, {
        codigo, gestorNuevo: String(b.gestorNuevo ?? ''), motivo: String(b.motivo ?? ''),
        gestorAnterior: String(cuenta.gestor ?? '') || null, pais: String(cuenta.pais ?? '') || null
      });
      return res.json(result);
    } catch (e) { return this.fail(res, e); }
  }
  async historial(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const q = req.query as Record<string, unknown>;
      return res.json(await listarHistorial(ctx, {
        desde: q.desde ? String(q.desde) : undefined, hasta: q.hasta ? String(q.hasta) : undefined,
        pais: q.pais ? String(q.pais) : undefined, gestorAnterior: q.gestorAnterior ? String(q.gestorAnterior) : undefined,
        gestorNuevo: q.gestorNuevo ? String(q.gestorNuevo) : undefined, tipo: q.tipo ? String(q.tipo) : undefined
      }));
    } catch (e) { return this.fail(res, e); }
  }

  private fail(res: Response, error: unknown): Response {
    const message = error instanceof AsignacionError ? error.message : 'Error en asignación.';
    console.error('[ASIGNACION]', error);
    return res.status(400).json({ error: message });
  }
}
