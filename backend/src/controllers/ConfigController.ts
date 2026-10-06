import { Request, Response } from 'express';
import {
  getGeneral, setGeneral, listCatalogos, crearCatalogo, actualizarCatalogo, eliminarCatalogo,
  getRolesPermisos, setRolPermisos,
  listPlantillas, subirPlantilla, subirAsset, urlAsset, urlPlantilla,
  leerPlantillaCarta, guardarPlantillaCarta, getTasasPorMoneda,
  listTasasConversion, actualizarTasaConversion, ConfigError
} from '../services/ConfigService';
import { getMetaGlobalComputada, guardarMetaGlobal } from '../services/MetasService';
import { registrarAuditoria } from '../services/AuditoriaService';
import {
  PLANTILLAS_CARTA_INFO, VARIABLES_CARTA, normalizarPd, fixtureParaBanda, buscarCuentaParaPreview, renderizarCarta,
  previsualizarContenidoCarta
} from '../services/CartaPdService';

export class ConfigController {
  async general(_req: Request, res: Response) { try { return res.json(await getGeneral()); } catch (e) { return this.fail(res, e); } }
  async guardarGeneral(req: Request, res: Response) {
    try {
      const actor = req.auth?.userId ?? null;
      await setGeneral((req.body?.general ?? {}) as Record<string, string>, actor);
      await registrarAuditoria(actor, 'CONFIG_GENERAL', 'configuracion', null, { claves: Object.keys(req.body?.general ?? {}) });
      return res.json({ ok: true });
    } catch (e) { return this.fail(res, e); }
  }

  async catalogos(req: Request, res: Response) { try { return res.json(await listCatalogos(req.query.catalogo as string)); } catch (e) { return this.fail(res, e); } }
  async crearCatalogo(req: Request, res: Response) { try { const r = await crearCatalogo(req.body ?? {}); await this.audit(req, 'CONFIG_CATALOGO_CREAR', r.id); return res.status(201).json(r); } catch (e) { return this.fail(res, e); } }
  async actualizarCatalogo(req: Request, res: Response) { try { await actualizarCatalogo(req.params.id, req.body ?? {}); await this.audit(req, 'CONFIG_CATALOGO_EDITAR', req.params.id); return res.json({ ok: true }); } catch (e) { return this.fail(res, e); } }
  async eliminarCatalogo(req: Request, res: Response) { try { await eliminarCatalogo(req.params.id); await this.audit(req, 'CONFIG_CATALOGO_ELIMINAR', req.params.id); return res.json({ ok: true }); } catch (e) { return this.fail(res, e); } }

  async tasasConversion(_req: Request, res: Response) {
    try {
      const tasas = await listTasasConversion();
      console.log('[TASAS] GET /configuracion/tasas-conversion ->', JSON.stringify((tasas as Array<{ codigo: string; tasa: number }>).map((t) => ({ codigo: t.codigo, tasa: t.tasa }))));
      return res.json(tasas);
    } catch (e) { return this.fail(res, e); }
  }
  async actualizarTasaConversion(req: Request, res: Response) {
    try {
      console.log('[TASAS] PATCH /configuracion/tasas-conversion/' + req.params.id + ' body=', JSON.stringify(req.body ?? {}));
      await actualizarTasaConversion(req.params.id, req.body ?? {}, req.auth?.userId ?? null);
      await this.audit(req, 'CONFIG_TASA_CONVERSION_EDITAR', req.params.id);
      console.log('[TASAS] PATCH /configuracion/tasas-conversion/' + req.params.id + ' -> ok');
      return res.json({ ok: true });
    } catch (e) {
      console.log('[TASAS] PATCH /configuracion/tasas-conversion/' + req.params.id + ' -> error', e instanceof Error ? e.message : e);
      return this.fail(res, e);
    }
  }

  async metaGlobal(_req: Request, res: Response) {
    try { return res.json(await getMetaGlobalComputada()); } catch (e) { return this.fail(res, e); }
  }
  async guardarMetaGlobal(req: Request, res: Response) {
    try {
      await guardarMetaGlobal(req.body ?? {}, req.auth?.userId ?? null);
      await this.audit(req, 'CONFIG_META_EDITAR', null);
      return res.json({ ok: true });
    } catch (e) { return this.fail(res, e); }
  }

  async rolesPermisos(_req: Request, res: Response) { try { return res.json(await getRolesPermisos()); } catch (e) { return this.fail(res, e); } }
  async guardarRolPermisos(req: Request, res: Response) {
    try {
      const ids = Array.isArray(req.body?.permissionIds) ? (req.body.permissionIds as unknown[]).map((x) => String(x)) : [];
      await setRolPermisos(req.params.roleId, ids);
      await this.audit(req, 'CONFIG_ROL_PERMISOS', req.params.roleId);
      return res.json({ ok: true });
    } catch (e) { return this.fail(res, e); }
  }

  async plantillas(_req: Request, res: Response) { try { return res.json(await listPlantillas()); } catch (e) { return this.fail(res, e); } }
  async subirPlantilla(req: Request, res: Response) {
    try {
      if (!req.file?.buffer) return res.status(400).json({ error: 'Adjunta un archivo.' });
      const r = await subirPlantilla(req.params.clave, req.file.originalname, req.file.buffer, req.file.mimetype || 'application/octet-stream', req.auth?.userId ?? null);
      await this.audit(req, 'CONFIG_PLANTILLA', req.params.clave);
      return res.status(201).json(r);
    } catch (e) { return this.fail(res, e); }
  }
  async subirAsset(req: Request, res: Response) {
    try {
      if (!req.file?.buffer) return res.status(400).json({ error: 'Adjunta un archivo.' });
      const r = await subirAsset(req.params.clave, req.file.originalname, req.file.buffer, req.file.mimetype || 'application/octet-stream', req.auth?.userId ?? null);
      await this.audit(req, 'CONFIG_ASSET', req.params.clave);
      return res.status(201).json(r);
    } catch (e) { return this.fail(res, e); }
  }
  async urlAsset(req: Request, res: Response) {
    try { return res.json({ url: await urlAsset(req.params.clave) }); } catch (e) { return this.fail(res, e); }
  }

  async descargarPlantilla(req: Request, res: Response) {
    try { return res.json({ url: await urlPlantilla(req.params.clave) }); } catch (e) { return this.fail(res, e); }
  }

  /** Las 5 plantillas de carta de cobro por PD (PD0 no tiene carta), con su
   *  contenido actual y el catálogo de variables disponibles — para
   *  Configuración > Plantillas (visualizar/editar/ver variables). */
  async plantillasCarta(_req: Request, res: Response) {
    try {
      const items = await Promise.all(PLANTILLAS_CARTA_INFO.map(async (info) => {
        const row = await leerPlantillaCarta(info.clave);
        return {
          ...info,
          contenido: row?.contenido ?? null,
          asunto: row?.asunto ?? null,
          activo: row?.activo ?? true,
          version: row?.version ?? null,
          updatedAt: row?.updated_at ?? null,
          updatedBy: row?.updated_by ?? null
        };
      }));
      return res.json({ items, variables: VARIABLES_CARTA });
    } catch (e) { return this.fail(res, e); }
  }

  /** Solo las 5 claves reales (PLANTILLAS_CARTA_INFO) pueden editarse — nunca
   *  se crea una plantilla nueva/independiente para PD2 o PD3 (comparten
   *  carta_pd1) ni para ninguna clave arbitraria del body/params. La firma
   *  NO se configura aquí: se resuelve automáticamente al autorizar la carta
   *  (ver Operación > Control Operativo / GestionService.resolverCarta). */
  async actualizarPlantillaCarta(req: Request, res: Response) {
    try {
      if (!PLANTILLAS_CARTA_INFO.some((p) => p.clave === req.params.clave)) {
        return res.status(404).json({ error: 'Plantilla no encontrada.' });
      }
      const contenido = String(req.body?.contenido ?? '');
      const asunto = String(req.body?.asunto ?? '');
      const activo = req.body?.activo !== false;
      if (!contenido.trim()) return res.status(400).json({ error: 'El contenido no puede estar vacío.' });
      if (!asunto.trim()) return res.status(400).json({ error: 'El asunto no puede estar vacío.' });
      const r = await guardarPlantillaCarta(req.params.clave, { contenido, asunto, activo }, req.auth?.userId ?? null);
      await this.audit(req, 'CONFIG_PLANTILLA_CARTA_EDITAR', req.params.clave);
      return res.json(r);
    } catch (e) { return this.fail(res, e); }
  }

  /** Previsualiza una plantilla de carta con una cuenta real (?codigo=) o,
   *  si no se indica, con una cuenta de prueba (fixture) representativa de
   *  la banda de PD de esa plantilla. Nunca genera ni guarda ninguna carta
   *  real; la firma NO se resuelve aquí (Configuración no la conoce — se
   *  asigna automáticamente al autorizar), el frontend la muestra como "se
   *  aplicará al autorizar". El texto es exactamente el mismo motor usado
   *  por Gestión. */
  async previsualizarPlantillaCarta(req: Request, res: Response) {
    try {
      const info = PLANTILLAS_CARTA_INFO.find((p) => p.clave === req.params.clave);
      if (!info) return res.status(404).json({ error: 'Plantilla no encontrada.' });
      const codigo = typeof req.query.codigo === 'string' ? req.query.codigo.trim() : '';
      let datos = codigo ? await buscarCuentaParaPreview(codigo) : null;
      if (codigo && !datos) return res.status(404).json({ error: 'Cuenta no encontrada.' });
      if (!datos) {
        const pdQuery = normalizarPd(req.query.pd);
        datos = fixtureParaBanda(pdQuery && info.bandas.includes(pdQuery) ? pdQuery : info.bandas[0]);
      }
      const tasas = await getTasasPorMoneda();
      return res.json(await renderizarCarta(datos, tasas));
    } catch (e) { return this.fail(res, e); }
  }

  /** Previsualiza un BORRADOR (contenido/asunto aún sin guardar, tal como
   *  está en el textarea del editor) — usa el MISMO motor de sustitución
   *  que el resto de las previsualizaciones, pero nunca lee ni modifica lo
   *  que hay guardado en config_plantillas. Con `?codigo=` usa una cuenta
   *  real; si no, una cuenta de prueba representativa de la banda de PD. */
  async previsualizarBorradorPlantillaCarta(req: Request, res: Response) {
    try {
      const info = PLANTILLAS_CARTA_INFO.find((p) => p.clave === req.params.clave);
      if (!info) return res.status(404).json({ error: 'Plantilla no encontrada.' });
      const contenido = String(req.body?.contenido ?? '');
      const asunto = String(req.body?.asunto ?? '');
      if (!contenido.trim()) return res.status(400).json({ error: 'El contenido no puede estar vacío.' });
      const codigo = typeof req.body?.codigo === 'string' ? req.body.codigo.trim() : '';
      let datos = codigo ? await buscarCuentaParaPreview(codigo) : null;
      if (codigo && !datos) return res.status(404).json({ error: 'Cuenta no encontrada.' });
      if (!datos) {
        const pdQuery = normalizarPd(req.body?.pd);
        datos = fixtureParaBanda(pdQuery && info.bandas.includes(pdQuery) ? pdQuery : info.bandas[0]);
      }
      const [general, tasas] = await Promise.all([getGeneral(), getTasasPorMoneda()]);
      return res.json(previsualizarContenidoCarta(datos.pdActual, contenido, asunto, datos, general, tasas));
    } catch (e) { return this.fail(res, e); }
  }

  private async audit(req: Request, accion: string, id: string | null) {
    await registrarAuditoria(req.auth?.userId ?? null, accion, 'configuracion', id, null);
  }
  private fail(res: Response, error: unknown) {
    const message = error instanceof ConfigError ? error.message : 'Error de configuración.';
    console.error('[CONFIG]', error);
    return res.status(400).json({ error: message });
  }
}
