import { Readable } from 'stream';
import { getSupabaseClient } from '../config/supabaseClient';
import { SUPABASE_CARTERA_TABLE, SUPABASE_CARTERA_BUCKET, SUPABASE_CARTERA_OBJECT } from '../config/env';
import { getCarteraDataSource } from '../config/dataSource';
import {
  loadWorkbookFromBuffer,
  pickCarteraWorksheet,
  readHeaders,
  validateHeaders,
  worksheetToRows,
  validateDateFields,
  streamRowsFromNodeStream
} from '../utils/carteraExcel';

/**
 * Procesa un Excel de cartera recibido en memoria y REEMPLAZA la tabla `cartera`.
 * Estrategia segura: primero parsea y valida TODO en memoria; sólo si es válido
 * vacía la tabla y reinserta. Si la validación/parseo falla, la cartera actual
 * queda intacta. No procesa contenido más allá de lo necesario ni toca /api/dashboard.
 */

const BATCH_SIZE = 500;

const truncateTable = async (): Promise<void> => {
  const client = getSupabaseClient();
  let totalDeleted = 0;
  for (;;) {
    const { data, error } = await client.from(SUPABASE_CARTERA_TABLE).select('codigo').limit(BATCH_SIZE);
    if (error) throw new Error(`No se pudieron leer códigos para vaciar la tabla: ${error.message}`);
    if (!data || data.length === 0) break;

    const codigos = data
      .map((row) => (row as { codigo: unknown }).codigo)
      .filter((codigo): codigo is string | number => codigo !== null && codigo !== undefined);
    if (codigos.length === 0) break;

    const { error: deleteError } = await client.from(SUPABASE_CARTERA_TABLE).delete().in('codigo', codigos);
    if (deleteError) throw new Error(`No se pudo vaciar la tabla: ${deleteError.message}`);
    totalDeleted += codigos.length;
    console.log(`[UPLOAD]   truncate progreso: ${totalDeleted} filas eliminadas`);
  }
};

const insertInBatches = async (
  rows: Record<string, unknown>[],
  onProgress?: ProgressCallback
): Promise<number> => {
  const client = getSupabaseClient();
  let inserted = 0;

  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    const { error } = await client.from(SUPABASE_CARTERA_TABLE).insert(batch);
    if (error) {
      throw new Error(
        `Fallo al insertar el lote ${start}-${start + batch.length - 1}: ${error.message}` +
          (error.details ? ` | detalles: ${error.details}` : '')
      );
    }
    inserted += batch.length;
    console.log(`[UPLOAD]   insert progreso: ${inserted}/${rows.length} filas`);
    onProgress?.({ processed: inserted, total: rows.length, message: 'Actualizando cartera...' });
  }

  return inserted;
};

export interface ReplaceCarteraResult {
  count: number;
}

/** Callback de progreso del procesamiento (registros procesados / totales). */
export type ProgressCallback = (update: { processed?: number; total?: number; message?: string }) => void;

// === LOGGING TEMPORAL (remover tras diagnosticar el 502 en Render) ===
const mem = () => `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB rss`;
const logStage = (msg: string) => console.log(`[UPLOAD] ${msg} | mem=${mem()}`);

/**
 * Valida encabezados+filas y, SÓLO si todo es válido, reemplaza la tabla.
 * Si la validación falla, la cartera anterior queda intacta (no se trunca).
 * Lógica reutilizada por el flujo de buffer y por el de Storage.
 */
const replaceCarteraWithRows = async (
  headers: string[],
  rows: Record<string, unknown>[],
  onProgress?: ProgressCallback
): Promise<number> => {
  const { ok, missing } = validateHeaders(headers);
  if (!ok) {
    throw new Error(`El archivo no tiene las columnas requeridas. Faltan: ${missing.join(', ')}`);
  }
  logStage(`columnas validadas (${headers.length} columnas)`);

  if (rows.length === 0) {
    throw new Error('El archivo no contiene filas de datos.');
  }
  logStage(`filas parseadas: ${rows.length}`);
  onProgress?.({ processed: 0, total: rows.length, message: 'Procesando registros...' });

  validateDateFields(rows);
  logStage('fechas validadas');

  // Reemplazo de la tabla (sólo tras validar correctamente).
  logStage('truncate: inicio');
  onProgress?.({ message: 'Actualizando cartera...' });
  await truncateTable();
  logStage('truncate: fin');

  logStage('insert: inicio');
  const count = await insertInBatches(rows, onProgress);
  logStage(`insert: fin (${count} filas)`);

  // Invalidar la caché del dashboard para que lea los datos nuevos.
  getCarteraDataSource().clearCache?.();
  logStage('cache invalidada');

  return count;
};

/** Flujo por buffer (compatibilidad; usado en pruebas/CLI). */
export const processAndReplaceCartera = async (buffer: Buffer): Promise<ReplaceCarteraResult> => {
  logStage(`inicio processAndReplaceCartera (buffer ${Math.round(buffer.length / 1024)}KB)`);
  const workbook = await loadWorkbookFromBuffer(buffer);
  const worksheet = pickCarteraWorksheet(workbook);
  const headers = readHeaders(worksheet);
  const rows = worksheetToRows(worksheet);
  const count = await replaceCarteraWithRows(headers, rows);
  return { count };
};

/**
 * NUEVA ARQUITECTURA: descarga "Cartera.xlsx" desde Supabase Storage, lo parsea
 * por STREAMING (sin cargar el workbook completo en memoria) y reemplaza la
 * tabla `cartera`. Render nunca recibe el archivo por HTTP/multer.
 * Informa el progreso (registros procesados / totales) vía onProgress.
 */
export const downloadAndReplaceCartera = async (onProgress?: ProgressCallback): Promise<ReplaceCarteraResult> => {
  logStage(`descargando "${SUPABASE_CARTERA_OBJECT}" del bucket "${SUPABASE_CARTERA_BUCKET}"`);
  onProgress?.({ message: 'Descargando archivo...' });
  const client = getSupabaseClient();
  const { data, error } = await client.storage.from(SUPABASE_CARTERA_BUCKET).download(SUPABASE_CARTERA_OBJECT);

  if (error || !data) {
    throw new Error(
      `No se pudo descargar "${SUPABASE_CARTERA_OBJECT}" del bucket "${SUPABASE_CARTERA_BUCKET}": ${error?.message ?? 'archivo no encontrado'}`
    );
  }

  // Blob -> Buffer -> stream de Node para el lector por streaming de ExcelJS.
  const arrayBuffer = await data.arrayBuffer();
  const nodeStream = Readable.from(Buffer.from(arrayBuffer));
  logStage(`archivo descargado (${Math.round(arrayBuffer.byteLength / 1024)}KB), parseando por streaming`);
  onProgress?.({ message: 'Procesando registros...' });

  const { headers, rows } = await streamRowsFromNodeStream(nodeStream);
  const count = await replaceCarteraWithRows(headers, rows, onProgress);
  return { count };
};
