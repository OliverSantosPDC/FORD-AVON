import { Request, Response } from 'express';
import {
  listarUsuarios,
  obtenerUsuario,
  obtenerCatalogos,
  crearUsuario,
  actualizarUsuario,
  restablecerPassword,
  eliminarUsuario,
  validarEliminacionMasiva,
  eliminarUsuariosMasivo,
  validarWorkbook,
  aplicarWorkbook,
  obtenerResumenAlcance,
  UsuariosError,
  UsuariosForbiddenError,
  type CrearUsuarioInput,
  type ActualizarUsuarioInput
} from '../services/UsuariosService';
import { generarPlantilla, parsearWorkbook } from '../utils/usuariosExcel';
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

  /** GET /api/usuarios/resumen-alcance — visuales de Grupos y Niveles (Sección 10). */
  async resumenAlcance(_req: Request, res: Response): Promise<Response> {
    try {
      return res.json(await obtenerResumenAlcance());
    } catch (error) {
      return this.fail(res, error, 'No se pudo calcular el resumen de alcance.');
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

  async resetPassword(req: Request, res: Response): Promise<Response> {
    try {
      const { password } = (req.body ?? {}) as { password?: string };
      await restablecerPassword(req.params.id, String(password ?? ''));
      // Auditoría SIN contraseña.
      await registrarAuditoria(req.auth?.userId ?? null, 'RESET_PASSWORD_USUARIO', 'usuarios', req.params.id, {});
      return res.json({ ok: true });
    } catch (error) {
      return this.fail(res, error, 'No se pudo restablecer la contraseña.');
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
      const actorRoleClave = req.auth?.role?.clave ?? null;
      const { email, roleClave } = await eliminarUsuario(req.params.id, actorId, actorRoleClave);
      await registrarAuditoria(actorId, 'ELIMINAR_USUARIO', 'usuarios', req.params.id, { email, rol: roleClave });
      return res.json({ ok: true });
    } catch (error) {
      return this.fail(res, error, 'No se pudo eliminar el usuario.');
    }
  }

  /** POST /api/usuarios/eliminar-masivo/validar — separa permitidos/bloqueados SIN eliminar nada (Sección 8-9). */
  async validarEliminarMasivo(req: Request, res: Response): Promise<Response> {
    try {
      const { ids } = (req.body ?? {}) as { ids?: unknown };
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Debes seleccionar al menos un usuario.' });
      }
      const actorId = req.auth?.userId ?? null;
      const actorRoleClave = req.auth?.role?.clave ?? null;
      return res.json(await validarEliminacionMasiva(ids.map(String), actorId, actorRoleClave));
    } catch (error) {
      return this.fail(res, error, 'No se pudo validar la selección.');
    }
  }

  /** DELETE /api/usuarios/eliminar-masivo — re-valida TODO en el servidor y elimina solo los permitidos. */
  async eliminarMasivo(req: Request, res: Response): Promise<Response> {
    try {
      const { ids } = (req.body ?? {}) as { ids?: unknown };
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Debes seleccionar al menos un usuario.' });
      }
      const actorId = req.auth?.userId ?? null;
      const actorRoleClave = req.auth?.role?.clave ?? null;
      const resultado = await eliminarUsuariosMasivo(ids.map(String), actorId, actorRoleClave);
      await registrarAuditoria(actorId, 'ELIMINAR_USUARIOS_MASIVO', 'usuarios', null, {
        eliminados: resultado.eliminados.map((u) => ({ id: u.id, email: u.email, rol: u.rol })),
        bloqueados: resultado.bloqueados.map((u) => ({ id: u.id, email: u.email, motivo: u.motivo })),
        errores: resultado.errores.map((u) => ({ id: u.id, email: u.email, motivo: u.motivo }))
      });
      return res.json(resultado);
    } catch (error) {
      return this.fail(res, error, 'No se pudo completar la eliminación masiva.');
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

  /** POST /api/usuarios/importar/validar — valida el archivo (todas las hojas) SIN modificar la BD. */
  async importarValidar(req: Request, res: Response): Promise<Response> {
    try {
      if (!req.file?.buffer) return res.status(400).json({ error: 'Debes adjuntar un archivo .xlsx.' });
      const parsed = await parsearWorkbook(req.file.buffer);
      if (parsed.usuarios.length === 0) return res.status(400).json({ error: 'El archivo no contiene filas para procesar en la hoja USUARIOS.' });
      return res.json(await validarWorkbook(parsed));
    } catch (error) {
      return this.fail(res, error, 'No se pudo validar el archivo.');
    }
  }

  /** POST /api/usuarios/importar/aplicar — procesa el workbook completo (usuarios + relaciones). */
  async importarAplicar(req: Request, res: Response): Promise<Response> {
    try {
      if (!req.file?.buffer) return res.status(400).json({ error: 'Debes adjuntar un archivo .xlsx.' });
      const soloValidas = String((req.body as { soloValidas?: string } | undefined)?.soloValidas ?? 'true') !== 'false';
      const parsed = await parsearWorkbook(req.file.buffer);
      if (parsed.usuarios.length === 0) return res.status(400).json({ error: 'El archivo no contiene filas para procesar en la hoja USUARIOS.' });
      const actorId = req.auth?.userId ?? null;
      return res.json(await aplicarWorkbook(parsed, soloValidas, actorId));
    } catch (error) {
      return this.fail(res, error, 'No se pudo procesar el archivo.');
    }
  }

  private fail(res: Response, error: unknown, fallback: string): Response {
    if (error instanceof UsuariosForbiddenError) {
      console.error('[USUARIOS] 403', error.message);
      return res.status(403).json({ error: error.message });
    }
    const message = error instanceof UsuariosError ? error.message : fallback;
    console.error('[USUARIOS]', error);
    return res.status(400).json({ error: message });
  }
}
