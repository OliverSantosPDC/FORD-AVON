import { Request, Response } from 'express';
import { CarteraService } from '../services/CarteraService';
import { CarteraRepository } from '../repositories/CarteraRepository';
import { getCarteraDataSource } from '../config/dataSource';
import {
  registrarTipificacion, detalleCuenta, crearPromesa, actualizarPromesa,
  registrarAdjunto, eliminarAdjunto, subirArchivoStorage,
  crearCarta, listarCartas, resolverCarta, resolverCartasMasivo, previsualizarCarta, obtenerCarta,
  aggregarZonasPd, aggregarPdCampanas, estadoCuentas, infoCuenta, GestionError,
  filtrarCodigosEnAlcance, codigoDePromesa, codigoDeAdjunto, gestorDeCarta, gestorEnAlcance,
  tipificacionesCuentas
} from '../services/GestionService';
import { registrarAuditoria } from '../services/AuditoriaService';
import { getTasasPorMoneda, subirFirmaSupervisor, urlFirmaSupervisor } from '../services/ConfigService';

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
      const limit = Number(req.query.limit) || 100000;
      return res.json(await carteraService.listCartera(extractFilters(req.query), limit, ctx));
    } catch (e) { return this.fail(res, e, 'No se pudieron cargar las cuentas.'); }
  }

  async zonasPd(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const [rows, tasas] = await Promise.all([
        carteraService.listCartera(extractFilters(req.query), 1000000, ctx),
        getTasasPorMoneda()
      ]);
      return res.json(aggregarZonasPd(rows, tasas));
    } catch (e) { return this.fail(res, e, 'No se pudieron cargar las zonas.'); }
  }

  async pdCampanas(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const [rows, tasas] = await Promise.all([
        carteraService.listCartera(extractFilters(req.query), 1000000, ctx),
        getTasasPorMoneda()
      ]);
      return res.json(aggregarPdCampanas(rows, tasas));
    } catch (e) { return this.fail(res, e, 'No se pudieron cargar los PD/campañas.'); }
  }

  /** Gestión > Tipificaciones: cada cuenta DENTRO DEL ALCANCE/FILTROS del
   *  actor (misma consulta ya escalada que `cuentas()`), clasificada por su
   *  última gestión registrada y enriquecida con su promesa más reciente —
   *  una sola consulta de cartera + dos lecturas completas de
   *  gestion_log/gestion_promesas, nunca una consulta por tipificación. */
  async tipificaciones(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const limit = Number(req.query.limit) || 1000000;
      const cuentas = await carteraService.listCartera(extractFilters(req.query), limit, ctx);
      return res.json(await tipificacionesCuentas(cuentas));
    } catch (e) { return this.fail(res, e, 'No se pudieron cargar las tipificaciones.'); }
  }

  async estado(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const codigos = Array.isArray(req.body?.codigos) ? (req.body.codigos as unknown[]).map((c) => String(c)) : [];
      const codigosPermitidos = await filtrarCodigosEnAlcance(codigos, ctx);
      return res.json(await estadoCuentas(codigosPermitidos));
    } catch (e) { return this.fail(res, e, 'No se pudo cargar el estado de cuentas.'); }
  }

  async detalle(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const row = await infoCuenta(req.params.codigo, ctx);
      if (!row) return res.status(404).json({ error: 'Cuenta no encontrada en tu alcance.' });
      return res.json(await detalleCuenta(req.params.codigo));
    } catch (e) { return this.fail(res, e, 'No se pudo cargar el detalle.'); }
  }

  async info(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const row = await infoCuenta(req.params.codigo, ctx);
      if (!row) return res.status(404).json({ error: 'Cuenta no encontrada en tu alcance.' });
      return res.json(row);
    } catch (e) { return this.fail(res, e, 'No se pudo cargar la información.'); }
  }

  async tipificar(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const row = await infoCuenta(req.params.codigo, ctx);
      if (!row) return res.status(404).json({ error: 'Cuenta no encontrada en tu alcance.' });
      const actor = req.auth?.userId ?? null;
      await registrarTipificacion(req.params.codigo, req.body?.tipificacion, req.body?.comentario ?? null, req.body?.tipoContacto ?? null, req.body?.canal ?? null, actor);
      await registrarAuditoria(actor, 'GESTION_TIPIFICACION', 'gestion', req.params.codigo, { tipificacion: req.body?.tipificacion });
      return res.status(201).json({ ok: true });
    } catch (e) { return this.fail(res, e, 'No se pudo tipificar la cuenta.'); }
  }

  async crearPromesa(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const row = await infoCuenta(req.params.codigo, ctx);
      if (!row) return res.status(404).json({ error: 'Cuenta no encontrada en tu alcance.' });
      const actor = req.auth?.userId ?? null;
      const r = await crearPromesa(req.params.codigo, req.body ?? {}, actor);
      await registrarAuditoria(actor, 'GESTION_PROMESA_CREAR', 'gestion', req.params.codigo, { promesaId: r.id });
      return res.status(201).json(r);
    } catch (e) { return this.fail(res, e, 'No se pudo crear la promesa.'); }
  }

  async actualizarPromesa(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const codigo = await codigoDePromesa(req.params.id);
      if (!codigo) return res.status(404).json({ error: 'Promesa no encontrada.' });
      const row = await infoCuenta(codigo, ctx);
      if (!row) return res.status(404).json({ error: 'Promesa no encontrada en tu alcance.' });
      const actor = req.auth?.userId ?? null;
      await actualizarPromesa(req.params.id, req.body ?? {});
      await registrarAuditoria(actor, 'GESTION_PROMESA_EDITAR', 'gestion', req.params.id, null);
      return res.json({ ok: true });
    } catch (e) { return this.fail(res, e, 'No se pudo actualizar la promesa.'); }
  }

  async subirAdjunto(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const row = await infoCuenta(req.params.codigo, ctx);
      if (!row) return res.status(404).json({ error: 'Cuenta no encontrada en tu alcance.' });
      const actor = req.auth?.userId ?? null;
      if (!req.file?.buffer) return res.status(400).json({ error: 'Debes adjuntar un archivo.' });
      const path = await subirArchivoStorage(req.file.originalname, req.file.buffer, req.file.mimetype || 'application/octet-stream');
      const r = await registrarAdjunto(req.params.codigo, (req.body?.tipo as string) ?? null, req.file.originalname, path, actor);
      await registrarAuditoria(actor, 'GESTION_ADJUNTO_SUBIR', 'gestion', req.params.codigo, { adjuntoId: r.id });
      return res.status(201).json(r);
    } catch (e) { return this.fail(res, e, 'No se pudo subir el adjunto.'); }
  }

  async eliminarAdjunto(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const codigo = await codigoDeAdjunto(req.params.id);
      if (!codigo) return res.status(404).json({ error: 'Adjunto no encontrado.' });
      const row = await infoCuenta(codigo, ctx);
      if (!row) return res.status(404).json({ error: 'Adjunto no encontrado en tu alcance.' });
      const actor = req.auth?.userId ?? null;
      await eliminarAdjunto(req.params.id);
      await registrarAuditoria(actor, 'GESTION_ADJUNTO_ELIMINAR', 'gestion', req.params.id, null);
      return res.json({ ok: true });
    } catch (e) { return this.fail(res, e, 'No se pudo eliminar el adjunto.'); }
  }

  /** Vista previa en vivo (sin guardar nada), bloqueada al PD ACTUAL de la
   *  cuenta — el cliente nunca elige la plantilla. */
  async previsualizarCarta(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const row = await infoCuenta(req.params.codigo, ctx);
      if (!row) return res.status(404).json({ error: 'Cuenta no encontrada en tu alcance.' });
      const tasas = await getTasasPorMoneda();
      return res.json(await previsualizarCarta(row, tasas));
    } catch (e) { return this.fail(res, e, 'No se pudo generar la vista previa de la carta.'); }
  }

  async crearCarta(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const row = await infoCuenta(req.params.codigo, ctx);
      if (!row) return res.status(404).json({ error: 'Cuenta no encontrada en tu alcance.' });
      const actor = req.auth?.userId ?? null;
      const tasas = await getTasasPorMoneda();
      const r = await crearCarta(row, tasas, req.body?.comentario ?? null, actor);
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

  /** Detalle de una carta puntual, con logo/firma SOLO si ya está autorizada
   *  (ver GestionService.obtenerCarta) — ni un Gestor sin permiso de aprobar,
   *  ni una llamada directa a este endpoint, pueden obtenerlos antes. */
  async obtenerCarta(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const carta = await gestorDeCarta(req.params.id);
      if (!carta) return res.status(404).json({ error: 'Carta no encontrada.' });
      if (!(await gestorEnAlcance(carta.gestorId, ctx))) return res.status(404).json({ error: 'Carta no encontrada en tu alcance.' });
      const detalle = await obtenerCarta(req.params.id);
      if (!detalle) return res.status(404).json({ error: 'Carta no encontrada.' });
      return res.json(detalle);
    } catch (e) { return this.fail(res, e, 'No se pudo cargar la carta.'); }
  }

  async aprobarCarta(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const carta = await gestorDeCarta(req.params.id);
      if (!carta) return res.status(404).json({ error: 'Carta no encontrada.' });
      if (!(await gestorEnAlcance(carta.gestorId, ctx))) return res.status(404).json({ error: 'Carta no encontrada en tu alcance.' });
      const actor = req.auth?.userId ?? null;
      await resolverCarta(req.params.id, true, req.body?.comentario ?? null, actor);
      await registrarAuditoria(actor, 'GESTION_CARTA_APROBAR', 'gestion', req.params.id, null);
      return res.json({ ok: true });
    } catch (e) { return this.fail(res, e, 'No se pudo aprobar la carta.'); }
  }

  async rechazarCarta(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const carta = await gestorDeCarta(req.params.id);
      if (!carta) return res.status(404).json({ error: 'Carta no encontrada.' });
      if (!(await gestorEnAlcance(carta.gestorId, ctx))) return res.status(404).json({ error: 'Carta no encontrada en tu alcance.' });
      const actor = req.auth?.userId ?? null;
      await resolverCarta(req.params.id, false, req.body?.comentario ?? null, actor);
      await registrarAuditoria(actor, 'GESTION_CARTA_RECHAZAR', 'gestion', req.params.id, null);
      return res.json({ ok: true });
    } catch (e) { return this.fail(res, e, 'No se pudo rechazar la carta.'); }
  }

  /** "Mi firma de autorización" (autoservicio): devuelve la firma predeterminada
   *  del usuario AUTENTICADO — nunca de otro usuario, nunca elegible desde
   *  el cliente. La ruta ya exige gestion.carta.aprobar. */
  async miFirmaAutorizacion(req: Request, res: Response): Promise<Response | void> {
    try {
      const actor = req.auth?.userId ?? null;
      if (!actor) return res.status(401).json({ error: 'No autenticado.' });
      const url = await urlFirmaSupervisor(actor);
      return res.json({ configurada: Boolean(url), url });
    } catch (e) { return this.fail(res, e, 'No se pudo cargar tu firma de autorización.'); }
  }

  /** Sube/reemplaza la firma de autorización del usuario AUTENTICADO. */
  async subirMiFirmaAutorizacion(req: Request, res: Response): Promise<Response | void> {
    try {
      const actor = req.auth?.userId ?? null;
      if (!actor) return res.status(401).json({ error: 'No autenticado.' });
      if (!req.file?.buffer) return res.status(400).json({ error: 'Adjunta un archivo.' });
      const r = await subirFirmaSupervisor(actor, req.file.originalname, req.file.buffer, req.file.mimetype || 'application/octet-stream', actor);
      await registrarAuditoria(actor, 'GESTION_FIRMA_AUTORIZACION_SUBIR', 'gestion', actor, null);
      return res.status(201).json(r);
    } catch (e) { return this.fail(res, e, 'No se pudo subir tu firma de autorización.'); }
  }

  /** Autoriza en lote una selección de cartas pendientes, dentro del alcance
   *  del actor — ver GestionService.resolverCartasMasivo (firma + alcance +
   *  condición de carrera validados server-side, nunca solo en frontend). */
  async autorizarCartasMasivo(req: Request, res: Response): Promise<Response | void> {
    try {
      const ctx = this.scope(req, res); if (!ctx) return;
      const actor = req.auth?.userId ?? null;
      if (!actor) return res.status(401).json({ error: 'No autenticado.' });
      const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map((x) => String(x)) : [];
      const comentario = typeof req.body?.comentario === 'string' && req.body.comentario.trim() ? req.body.comentario : null;
      const r = await resolverCartasMasivo(ids, comentario, actor, ctx);
      await registrarAuditoria(actor, 'GESTION_CARTA_APROBAR_MASIVO', 'gestion', null, { solicitadas: ids.length, autorizadas: r.autorizadas.length, omitidas: r.omitidas.length });
      return res.json(r);
    } catch (e) { return this.fail(res, e, 'No se pudieron autorizar las cartas.'); }
  }

  private fail(res: Response, error: unknown, fallback: string): Response {
    const message = error instanceof GestionError ? error.message : fallback;
    console.error('[GESTION]', error);
    return res.status(400).json({ error: message });
  }
}
