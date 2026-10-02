import { Request, Response } from 'express';
import {
  getGeneral, setGeneral, listCatalogos, crearCatalogo, actualizarCatalogo, eliminarCatalogo,
  getRolesPermisos, setRolPermisos,
  listPlantillas, subirPlantilla, subirAsset, urlAsset, urlPlantilla,
  leerContenidoPlantilla, actualizarContenidoPlantilla, getTasasPorMoneda,
  listTasasConversion, actualizarTasaConversion, ConfigError
} from '../services/ConfigService';
import { getMetaGlobalComputada, guardarMetaGlobal } from '../services/MetasService';
import { registrarAuditoria } from '../services/AuditoriaService';
import {
  PLANTILLAS_CARTA_INFO, VARIABLES_CARTA, normalizarPd, fixtureParaBanda, buscarCuentaParaPreview, renderizarCarta
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
        const contenido = await leerContenidoPlantilla(info.clave);
        return { ...info, contenido };
      }));
      return res.json({ items, variables: VARIABLES_CARTA });
    } catch (e) { return this.fail(res, e); }
  }

  async actualizarPlantillaCarta(req: Request, res: Response) {
    try {
      const contenido = String(req.body?.contenido ?? '');
      if (!contenido.trim()) return res.status(400).json({ error: 'El contenido no puede estar vacío.' });
      const r = await actualizarContenidoPlantilla(req.params.clave, contenido, req.auth?.userId ?? null);
      await this.audit(req, 'CONFIG_PLANTILLA_CARTA_EDITAR', req.params.clave);
      return res.json(r);
    } catch (e) { return this.fail(res, e); }
  }

  /** Previsualiza una plantilla de carta con una cuenta real (?codigo=) o,
   *  si no se indica, con una cuenta de prueba (fixture) representativa de
   *  la banda de PD de esa plantilla. No gatea logo/firma por autorización
   *  (aquí no se genera ni se guarda ninguna carta real), pero el texto es
   *  exactamente el mismo motor usado por Gestión. */
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

  private async audit(req: Request, accion: string, id: string | null) {
    await registrarAuditoria(req.auth?.userId ?? null, accion, 'configuracion', id, null);
  }
  private fail(res: Response, error: unknown) {
    const message = error instanceof ConfigError ? error.message : 'Error de configuración.';
    console.error('[CONFIG]', error);
    return res.status(400).json({ error: message });
  }
}
