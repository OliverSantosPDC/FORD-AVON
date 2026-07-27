import os from 'os';
import path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { unlink } from 'fs/promises';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
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
  validateRecordDates,
  streamWorkbookRows
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

const rssMB = () => Math.round(process.memoryUsage().rss / 1024 / 1024);

/**
 * NUEVA ARQUITECTURA (eficiente en memoria). Descarga "Cartera.xlsx" de Supabase
 * Storage por STREAMING a un archivo temporal en disco (sin bufferizar todo el
 * archivo), y luego lo procesa en DOS pasadas por streaming:
 *   Pasada 1 (validación): valida encabezados y fechas fila por fila, cuenta el
 *     total. NO acumula filas. Si es inválido, la cartera actual queda intacta.
 *   Pasada 2 (reemplazo): trunca la tabla e inserta por lotes de 500, vaciando
 *     el lote tras cada inserción. Nunca mantiene todas las filas en memoria.
 * Render nunca recibe el archivo por HTTP/multer.
 */
export const downloadAndReplaceCartera = async (onProgress?: ProgressCallback): Promise<ReplaceCarteraResult> => {
  console.log(`[UPLOAD] inicio | memoria RSS: ${rssMB()} MB`);
  onProgress?.({ message: 'Descargando archivo...' });

  // Liberar la caché del dashboard (libera ~decenas de MB) antes de procesar.
  getCarteraDataSource().clearCache?.();

  const client = getSupabaseClient();
  const { data: signed, error: signError } = await client.storage
    .from(SUPABASE_CARTERA_BUCKET)
    .createSignedUrl(SUPABASE_CARTERA_OBJECT, 300);

  if (signError || !signed?.signedUrl) {
    throw new Error(
      `No se pudo obtener "${SUPABASE_CARTERA_OBJECT}" del bucket "${SUPABASE_CARTERA_BUCKET}": ${signError?.message ?? 'sin URL firmada'}`
    );
  }

  const tmpPath = path.join(os.tmpdir(), `cartera-${randomUUID()}.xlsx`);

  try {
    // 1) Descargar por STREAMING a disco (sin cargar todo el archivo en un Buffer).
    const response = await fetch(signed.signedUrl);
    if (!response.ok || !response.body) {
      throw new Error(`Descarga del archivo fallida (HTTP ${response.status}).`);
    }
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(tmpPath));
    console.log(`[UPLOAD] stream iniciado | memoria RSS: ${rssMB()} MB`);

    // 2) PASADA 1 - validación por streaming (sin acumular filas).
    onProgress?.({ message: 'Validando archivo...' });
    let headersValidated = false;
    let total = 0;
    await streamWorkbookRows(createReadStream(tmpPath), {
      onHeaders: (_dbColumns, rawHeaders) => {
        const { ok, missing } = validateHeaders(rawHeaders);
        if (!ok) {
          throw new Error(`El archivo no tiene las columnas requeridas. Faltan: ${missing.join(', ')}`);
        }
        headersValidated = true;
      },
      onRow: (record, rowNumber) => {
        validateRecordDates(record, rowNumber);
        total += 1;
        if (total % 5000 === 0) console.log(`[UPLOAD] filas procesadas: ${total} | memoria RSS: ${rssMB()} MB`);
      }
    });

    if (!headersValidated) throw new Error('El archivo no tiene fila de encabezados.');
    if (total === 0) throw new Error('El archivo no contiene filas de datos.');
    console.log(`[UPLOAD] validación OK, total filas: ${total} | memoria RSS: ${rssMB()} MB`);
    onProgress?.({ processed: 0, total, message: 'Procesando registros...' });

    // 3) PASADA 2 - reemplazo: truncate + insert por lotes (streaming, sin acumular).
    onProgress?.({ processed: 0, total, message: 'Actualizando cartera...' });
    await truncateTable();

    let batch: Record<string, unknown>[] = [];
    let inserted = 0;

    const flush = async () => {
      if (batch.length === 0) return;
      const size = batch.length;
      const { error } = await client.from(SUPABASE_CARTERA_TABLE).insert(batch);
      if (error) {
        throw new Error(
          `Fallo al insertar el lote que termina en la fila ${inserted + size}: ${error.message}` +
            (error.details ? ` | detalles: ${error.details}` : '')
        );
      }
      inserted += size;
      batch = []; // vaciar el lote inmediatamente
      console.log(`[UPLOAD] lote insertado: ${inserted}/${total} | memoria RSS: ${rssMB()} MB`);
      onProgress?.({ processed: inserted, total, message: 'Actualizando cartera...' });
    };

    await streamWorkbookRows(createReadStream(tmpPath), {
      onRow: async (record) => {
        batch.push(record);
        if (batch.length >= BATCH_SIZE) await flush();
      }
    });
    await flush();

    // 4) Invalidar la caché del dashboard para que lea los datos nuevos.
    getCarteraDataSource().clearCache?.();
    console.log(`[UPLOAD] proceso completado (${inserted} filas) | memoria RSS: ${rssMB()} MB`);

    return { count: inserted };
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
};
