import { Request, Response } from 'express';
import { SUPABASE_CARTERA_OBJECT } from '../config/env';
import { downloadAndReplaceCartera } from '../services/CarteraImportService';

/**
 * Controlador de procesamiento de cartera (nueva arquitectura).
 * El frontend sube el .xlsx DIRECTO a Supabase Storage; este endpoint sólo
 * dispara la descarga desde Storage y la actualización de la tabla `cartera`.
 * Render NO recibe el archivo por HTTP. NO modifica /api/dashboard.
 */
export class UploadController {
  async processCartera(_req: Request, res: Response): Promise<Response> {
    try {
      console.log('[UPLOAD] proceso solicitado: descargar de Storage y reemplazar tabla');
      const { count } = await downloadAndReplaceCartera();

      console.log(`[UPLOAD] OK: ${count} registros`);
      return res.json({
        success: true,
        count,
        message: `Cartera actualizada correctamente con ${count} registros desde "${SUPABASE_CARTERA_OBJECT}".`
      });
    } catch (error) {
      // La cartera anterior queda intacta si la validación/parseo falla antes del truncate.
      console.error('[UPLOAD] fallo en procesamiento:', error);
      const message = error instanceof Error ? error.message : 'Error desconocido al procesar el archivo.';
      return res.status(422).json({
        success: false,
        message: `No se pudo procesar el archivo. ${message}`
      });
    }
  }
}
