import { Request, Response } from 'express';
import { getSupabaseClient } from '../config/supabaseClient';
import { SUPABASE_CARTERA_BUCKET, SUPABASE_CARTERA_OBJECT } from '../config/env';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Controlador de carga de cartera (Fase 2 - paso 2).
 * Persiste el archivo recibido en Supabase Storage como un único objeto activo
 * "Cartera.xlsx" (se reemplaza si ya existe). NO procesa el contenido del Excel
 * ni modifica la tabla `cartera` ni /api/dashboard.
 */
export class UploadController {
  async uploadCartera(req: Request, res: Response): Promise<Response> {
    try {
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          success: false,
          message: 'No se recibió ningún archivo. Envíe un .xlsx en el campo "file".'
        });
      }

      const client = getSupabaseClient();
      const { error } = await client.storage
        .from(SUPABASE_CARTERA_BUCKET)
        .upload(SUPABASE_CARTERA_OBJECT, file.buffer, {
          contentType: file.mimetype || XLSX_MIME,
          upsert: true // reemplaza el "Cartera.xlsx" existente
        });

      if (error) {
        return res.status(502).json({
          success: false,
          message: `No se pudo guardar el archivo en Supabase Storage (bucket "${SUPABASE_CARTERA_BUCKET}"): ${error.message}`
        });
      }

      return res.json({
        success: true,
        filename: file.originalname,
        size: file.size,
        message: `Archivo guardado en Supabase Storage como "${SUPABASE_CARTERA_OBJECT}". La cartera aún no se actualiza.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido al recibir el archivo.';
      return res.status(500).json({ success: false, message });
    }
  }
}
