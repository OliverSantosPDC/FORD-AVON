import { Request, Response } from 'express';
import { getSupabaseClient } from '../config/supabaseClient';
import { SUPABASE_CARTERA_BUCKET, SUPABASE_CARTERA_OBJECT } from '../config/env';
import { processAndReplaceCartera } from '../services/CarteraImportService';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Controlador de carga de cartera (Fase 2).
 * Flujo: recibe .xlsx en memoria -> valida columnas y filas -> reemplaza la
 * tabla `cartera` -> guarda/reemplaza "Cartera.xlsx" en Supabase Storage ->
 * invalida la caché del dashboard. NO modifica /api/dashboard.
 */
export class UploadController {
  async uploadCartera(req: Request, res: Response): Promise<Response> {
    try {
      const file = req.file;

      if (!file) {
        console.log('[UPLOAD] 400: no se recibió archivo');
        return res.status(400).json({
          success: false,
          message: 'No se recibió ningún archivo. Envíe un .xlsx en el campo "file".'
        });
      }

      console.log(`[UPLOAD] archivo recibido: "${file.originalname}" (${Math.round(file.size / 1024)}KB, ${file.mimetype})`);

      // 1) Validar + procesar + reemplazar tabla (si falla, no se toca nada).
      let count: number;
      try {
        ({ count } = await processAndReplaceCartera(file.buffer));
      } catch (validationError) {
        const message =
          validationError instanceof Error ? validationError.message : 'El archivo no pudo procesarse.';
        console.error('[UPLOAD] fallo en validación/procesamiento/reemplazo:', validationError);
        return res.status(422).json({
          success: false,
          message: `Archivo inválido o no procesable. La cartera actual no se modificó. ${message}`
        });
      }

      // 2) Persistir/reemplazar el archivo en Supabase Storage.
      console.log(`[UPLOAD] storage: subiendo a bucket "${SUPABASE_CARTERA_BUCKET}" como "${SUPABASE_CARTERA_OBJECT}"`);
      const client = getSupabaseClient();
      const { error: storageError } = await client.storage
        .from(SUPABASE_CARTERA_BUCKET)
        .upload(SUPABASE_CARTERA_OBJECT, file.buffer, {
          contentType: file.mimetype || XLSX_MIME,
          upsert: true
        });

      if (storageError) {
        console.error('[UPLOAD] storage error:', storageError);
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

      console.log(`[UPLOAD] OK: ${count} registros, archivo guardado`);
      return res.json({
        success: true,
        filename: file.originalname,
        size: file.size,
        count,
        message: `Cartera actualizada correctamente con ${count} registros y archivo guardado como "${SUPABASE_CARTERA_OBJECT}".`
      });
    } catch (error) {
      console.error('[UPLOAD] error no controlado:', error);
      const message = error instanceof Error ? error.message : 'Error desconocido al procesar el archivo.';
      return res.status(500).json({ success: false, message });
    }
  }
}
