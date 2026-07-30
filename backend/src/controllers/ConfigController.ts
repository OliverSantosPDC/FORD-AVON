import { Request, Response } from 'express';
import {
  getGeneral, setGeneral, listCatalogos, crearCatalogo, actualizarCatalogo, eliminarCatalogo,
  listVariables, crearVariable, actualizarVariable, getRolesPermisos, setRolPermisos,
  listPlantillas, subirPlantilla, subirAsset, urlPlantilla, listAuditoria, ConfigError
} from '../services/ConfigService';
import { registrarAuditoria } from '../services/AuditoriaService';

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

  async variables(_req: Request, res: Response) { try { return res.json(await listVariables()); } catch (e) { return this.fail(res, e); } }
  async crearVariable(req: Request, res: Response) { try { const r = await crearVariable(req.body ?? {}); await this.audit(req, 'CONFIG_VARIABLE_CREAR', r.id); return res.status(201).json(r); } catch (e) { return this.fail(res, e); } }
  async actualizarVariable(req: Request, res: Response) { try { await actualizarVariable(req.params.id, req.body ?? {}); await this.audit(req, 'CONFIG_VARIABLE_EDITAR', req.params.id); return res.json({ ok: true }); } catch (e) { return this.fail(res, e); } }

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

  async descargarPlantilla(req: Request, res: Response) {
    try { return res.json({ url: await urlPlantilla(req.params.clave) }); } catch (e) { return this.fail(res, e); }
  }

  async auditoria(req: Request, res: Response) {
    try {
      const q = req.query;
      return res.json(await listAuditoria({
        usuario: q.usuario as string, entidad: q.entidad as string, accion: q.accion as string,
        desde: q.desde as string, hasta: q.hasta as string, search: q.search as string,
        limit: Number(q.limit) || 50, offset: Number(q.offset) || 0
      }));
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
