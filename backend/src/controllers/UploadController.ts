import { Request, Response } from 'express';
import { getSupabaseClient } from '../config/supabaseClient';
import { SUPABASE_CARTERA_BUCKET, SUPABASE_CARTERA_OBJECT } from '../config/env';
import { processAndReplaceCartera } from '../services/CarteraImportService';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Controlador de carga de cartera (Fase 2).
 * Flujo: recibe .xlsx en memoria -> valida columnas y filas -> guarda/reemplaza
 * "Cartera.xlsx" en Supabase Storage -> reemplaza los registros de la tabla
 * `cartera` -> invalida la caché del dashboard. Si la validación falla, la
 * cartera actual queda intacta. NO modifica /api/dashboard.
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

      // 1) Validar + procesar EN MEMORIA (si falla, no se toca nada).
      let count: number;
      try {
        ({ count } = await processAndReplaceCartera(file.buffer));
      } catch (validationError) {
        const message =
          validationError instanceof Error ? validationError.message : 'El archivo no pudo procesarse.';
        return res.status(422).json({
          success: false,
          message: `Archivo inválido o no procesable. La cartera actual no se modificó. ${message}`
        });
      }

      // 2) Persistir/reemplazar el archivo en Supabase Storage.
      const client = getSupabaseClient();
      const { error: storageError } = await client.storage
        .from(SUPABASE_CARTERA_BUCKET)
        .upload(SUPABASE_CARTERA_OBJECT, file.buffer, {
          contentType: file.mimetype || XLSX_MIME,
          upsert: true
        });

      if (storageError) {
        // La tabla ya se actualizó; sólo falló el guardado del archivo.
        return res.status(200).json({
          success: true,
          filename: file.originalname,
          size: file.size,
          count,
          message:
            `Cartera actualizada con ${count} registros, pero no se pudo guardar el archivo en Storage ` +
            `(bucket "${SUPABASE_CARTERA_BUCKET}"): ${storageError.message}`
        });
      }

      return res.json({
        success: true,
        filename: file.originalname,
        size: file.size,
        count,
        message: `Cartera actualizada correctamente con ${count} registros y archivo guardado como "${SUPABASE_CARTERA_OBJECT}".`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido al procesar el archivo.';
      return res.status(500).json({ success: false, message });
    }
  }
}
