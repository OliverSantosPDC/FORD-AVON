import { Request, Response } from 'express';
import { CarteraService } from '../services/CarteraService';
import { CarteraRepository } from '../repositories/CarteraRepository';
import { getCarteraDataSource } from '../config/dataSource';
import {
  registrarTipificacion, detalleCuenta, crearPromesa, actualizarPromesa,
  registrarAdjunto, eliminarAdjunto, subirArchivoStorage,
  crearCarta, listarCartas, resolverCarta,
  aggregarZonasPd, aggregarPdCampanas, estadoCuentas, GestionError
} from '../services/GestionService';
import { registrarAuditoria } from '../services/AuditoriaService';

const carteraService = new CarteraService(new CarteraRepository(getCarteraDataSource()));

const parseFilter = (v: unknown): string[] | undefined => {
  if (typeof v === 'string') { const a = v.split(',').map((x) => x.trim()).filter(Boolean); return a.length ? a : undefined; }
  if (Array.isArray(v)) { const a = v.flatMap((x) => (typeof x === 'string' ? x.split(',') : [])).map((x) => x.trim()).filter(Boolean); return a.length ? a : undefined; }
  return undefined;
};
const extractFilters = (q: Record<string, unknown>) => ({
  pais: parseFilter(q.pais), gestor: parseFilter(q.gestor), gerente: parseFilter(q.gerente),
  zona: parseFilter(q.zona), pd: parseFilter(q.pd), campania: parseFilter(q.campania)
});

export class GestionController {
  private scope(req: Request, res: Response) {
    const ctx = req.auth?.scopeContext;
    if (!ctx) { res.status(403).json({ error: 'Alcance de acceso no disponible.' }); return null; }
    return ctx;
  }

  async dashboard(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      return res.json(await carteraService.getDashboard(extractFilters(req.query), ctx));
    } catch (e) { return this.fail(res, e, 'No se pudo cargar la gestión.'); }
  }

  async cuentas(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const limit = Number(req.query.limit) || 500;
      return res.json(await carteraService.listCartera(extractFilters(req.query), limit, ctx));
    } catch (e) { return this.fail(res, e, 'No se pudieron cargar las cuentas.'); }
  }

  async zonasPd(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const rows = await carteraService.listCartera(extractFilters(req.query), 1000000, ctx);
      return res.json(aggregarZonasPd(rows));
    } catch (e) { return this.fail(res, e, 'No se pudieron cargar las zonas.'); }
  }

  async pdCampanas(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const rows = await carteraService.listCartera(extractFilters(req.query), 1000000, ctx);
      return res.json(aggregarPdCampanas(rows));
    } catch (e) { return this.fail(res, e, 'No se pudieron cargar los PD/campañas.'); }
  }

  async estado(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const codigos = Array.isArray(req.body?.codigos) ? (req.body.codigos as unknown[]).map((c) => String(c)) : [];
      return res.json(await estadoCuentas(codigos));
    } catch (e) { return this.fail(res, e, 'No se pudo cargar el estado de cuentas.'); }
  }

  async detalle(req: Request, res: Response): Promise<Response> {
    try { return res.json(await detalleCuenta(req.params.codigo)); }
    catch (e) { return this.fail(res, e, 'No se pudo cargar el detalle.'); }
  }

  async tipificar(req: Request, res: Response): Promise<Response> {
    try {
      const actor = req.auth?.userId ?? null;
      await registrarTipificacion(req.params.codigo, req.body?.tipificacion, req.body?.comentario ?? null, actor);
      await registrarAuditoria(actor, 'GESTION_TIPIFICACION', 'gestion', req.params.codigo, { tipificacion: req.body?.tipificacion });
      return res.status(201).json({ ok: true });
    } catch (e) { return this.fail(res, e, 'No se pudo tipificar la cuenta.'); }
  }

  async crearPromesa(req: Request, res: Response): Promise<Response> {
    try {
      const actor = req.auth?.userId ?? null;
      const r = await crearPromesa(req.params.codigo, req.body ?? {}, actor);
      await registrarAuditoria(actor, 'GESTION_PROMESA_CREAR', 'gestion', req.params.codigo, { promesaId: r.id });
      return res.status(201).json(r);
    } catch (e) { return this.fail(res, e, 'No se pudo crear la promesa.'); }
  }

  async actualizarPromesa(req: Request, res: Response): Promise<Response> {
    try {
      const actor = req.auth?.userId ?? null;
      await actualizarPromesa(req.params.id, req.body ?? {});
      await registrarAuditoria(actor, 'GESTION_PROMESA_EDITAR', 'gestion', req.params.id, null);
      return res.json({ ok: true });
    } catch (e) { return this.fail(res, e, 'No se pudo actualizar la promesa.'); }
  }

  async subirAdjunto(req: Request, res: Response): Promise<Response> {
    try {
      const actor = req.auth?.userId ?? null;
      if (!req.file?.buffer) return res.status(400).json({ error: 'Debes adjuntar un archivo.' });
      const path = await subirArchivoStorage(req.file.originalname, req.file.buffer, req.file.mimetype || 'application/octet-stream');
      const r = await registrarAdjunto(req.params.codigo, (req.body?.tipo as string) ?? null, req.file.originalname, path, actor);
      await registrarAuditoria(actor, 'GESTION_ADJUNTO_SUBIR', 'gestion', req.params.codigo, { adjuntoId: r.id });
      return res.status(201).json(r);
    } catch (e) { return this.fail(res, e, 'No se pudo subir el adjunto.'); }
  }

  async eliminarAdjunto(req: Request, res: Response): Promise<Response> {
    try {
      const actor = req.auth?.userId ?? null;
      await eliminarAdjunto(req.params.id);
      await registrarAuditoria(actor, 'GESTION_ADJUNTO_ELIMINAR', 'gestion', req.params.id, null);
      return res.json({ ok: true });
    } catch (e) { return this.fail(res, e, 'No se pudo eliminar el adjunto.'); }
  }

  async crearCarta(req: Request, res: Response): Promise<Response> {
    try {
      const actor = req.auth?.userId ?? null;
      const r = await crearCarta(req.params.codigo, req.body?.tipo, req.body?.comentario ?? null, actor);
      await registrarAuditoria(actor, 'GESTION_CARTA_CREAR', 'gestion', r.id, { codigo: req.params.codigo });
      return res.status(201).json(r);
    } catch (e) { return this.fail(res, e, 'No se pudo crear la carta.'); }
  }

  async listarCartas(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      return res.json(await listarCartas(ctx, { estado: req.query.estado as string, codigo: req.query.codigo as string }));
    } catch (e) { return this.fail(res, e, 'No se pudieron cargar las cartas.'); }
  }

  async aprobarCarta(req: Request, res: Response): Promise<Response> {
    try {
      const actor = req.auth?.userId ?? null;
      await resolverCarta(req.params.id, true, req.body?.comentario ?? null, actor);
      await registrarAuditoria(actor, 'GESTION_CARTA_APROBAR', 'gestion', req.params.id, null);
      return res.json({ ok: true });
    } catch (e) { return this.fail(res, e, 'No se pudo aprobar la carta.'); }
  }

  async rechazarCarta(req: Request, res: Response): Promise<Response> {
    try {
      const actor = req.auth?.userId ?? null;
      await resolverCarta(req.params.id, false, req.body?.comentario ?? null, actor);
      await registrarAuditoria(actor, 'GESTION_CARTA_RECHAZAR', 'gestion', req.params.id, null);
      return res.json({ ok: true });
    } catch (e) { return this.fail(res, e, 'No se pudo rechazar la carta.'); }
  }

  private fail(res: Response, error: unknown, fallback: string): Response {
    const message = error instanceof GestionError ? error.message : fallback;
    console.error('[GESTION]', error);
    return res.status(400).json({ error: message });
  }
}
