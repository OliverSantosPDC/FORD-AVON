import { Request, Response } from 'express';
import {
  listarUsuarios,
  obtenerUsuario,
  obtenerCatalogos,
  crearUsuario,
  actualizarUsuario,
  eliminarUsuario,
  validarImportacion,
  aplicarImportacion,
  UsuariosError,
  type CrearUsuarioInput,
  type ActualizarUsuarioInput
} from '../services/UsuariosService';
import { generarPlantilla, parsearUsuarios } from '../utils/usuariosExcel';
import { registrarAuditoria } from '../services/AuditoriaService';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Controlador del módulo Usuarios (administración global). Requiere que el
 * middleware requireAuth + requirePermission('usuarios.administrar_global')
 * ya hayan autorizado la petición.
 */
export class UsuariosController {
  async list(_req: Request, res: Response): Promise<Response> {
    try {
      return res.json(await listarUsuarios());
    } catch (error) {
      return this.fail(res, error, 'No se pudieron listar los usuarios.');
    }
  }

  async catalogos(_req: Request, res: Response): Promise<Response> {
    try {
      return res.json(await obtenerCatalogos());
    } catch (error) {
      return this.fail(res, error, 'No se pudieron obtener los catálogos.');
    }
  }

  async detail(req: Request, res: Response): Promise<Response> {
    try {
      const usuario = await obtenerUsuario(req.params.id);
      if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });
      return res.json(usuario);
    } catch (error) {
      return this.fail(res, error, 'No se pudo obtener el usuario.');
    }
  }

  async create(req: Request, res: Response): Promise<Response> {
    try {
      const body = (req.body ?? {}) as CrearUsuarioInput;
      if (!body.email || !body.nombre || !body.roleId) {
        return res.status(400).json({ error: 'Correo, nombre y rol son obligatorios.' });
      }
      const result = await crearUsuario(body);
      // Auditoría SIN contraseña.
      await registrarAuditoria(req.auth?.userId ?? null, 'CREAR_USUARIO', 'usuarios', result.id, {
        email: body.email,
        roleId: body.roleId
      });
      return res.status(201).json(result);
    } catch (error) {
      return this.fail(res, error, 'No se pudo crear el usuario.');
    }
  }

  async update(req: Request, res: Response): Promise<Response> {
    try {
      const body = (req.body ?? {}) as ActualizarUsuarioInput;
      await actualizarUsuario(req.params.id, body);
      return res.json({ ok: true });
    } catch (error) {
      return this.fail(res, error, 'No se pudo actualizar el usuario.');
    }
  }

  async remove(req: Request, res: Response): Promise<Response> {
    try {
      const actorId = req.auth?.userId ?? null;
      const { email, roleClave } = await eliminarUsuario(req.params.id, actorId);
      await registrarAuditoria(actorId, 'ELIMINAR_USUARIO', 'usuarios', req.params.id, { email, rol: roleClave });
      return res.json({ ok: true });
    } catch (error) {
      return this.fail(res, error, 'No se pudo eliminar el usuario.');
    }
  }

  /** GET /api/usuarios/plantilla — descarga la plantilla oficial .xlsx. */
  async plantilla(_req: Request, res: Response): Promise<void> {
    try {
      const buffer = await generarPlantilla();
      res.setHeader('Content-Type', XLSX_MIME);
      res.setHeader('Content-Disposition', 'attachment; filename="plantilla_usuarios.xlsx"');
      res.send(buffer);
    } catch (error) {
      console.error('[USUARIOS] plantilla', error);
      res.status(500).json({ error: 'No se pudo generar la plantilla.' });
    }
  }

  /** POST /api/usuarios/importar/validar — valida el archivo SIN modificar la BD. */
  async importarValidar(req: Request, res: Response): Promise<Response> {
    try {
      if (!req.file?.buffer) return res.status(400).json({ error: 'Debes adjuntar un archivo .xlsx.' });
      const filas = await parsearUsuarios(req.file.buffer);
      if (filas.length === 0) return res.status(400).json({ error: 'El archivo no contiene filas para procesar.' });
      return res.json(await validarImportacion(filas));
    } catch (error) {
      return this.fail(res, error, 'No se pudo validar el archivo.');
    }
  }

  /** POST /api/usuarios/importar/aplicar — procesa las filas (reutiliza UsuariosService). */
  async importarAplicar(req: Request, res: Response): Promise<Response> {
    try {
      if (!req.file?.buffer) return res.status(400).json({ error: 'Debes adjuntar un archivo .xlsx.' });
      const soloValidas = String((req.body as { soloValidas?: string } | undefined)?.soloValidas ?? 'true') !== 'false';
      const filas = await parsearUsuarios(req.file.buffer);
      if (filas.length === 0) return res.status(400).json({ error: 'El archivo no contiene filas para procesar.' });
      const actorId = req.auth?.userId ?? null;
      return res.json(await aplicarImportacion(filas, soloValidas, actorId));
    } catch (error) {
      return this.fail(res, error, 'No se pudo procesar el archivo.');
    }
  }

  private fail(res: Response, error: unknown, fallback: string): Response {
    const message = error instanceof UsuariosError ? error.message : fallback;
    console.error('[USUARIOS]', error);
    return res.status(400).json({ error: message });
  }
}
