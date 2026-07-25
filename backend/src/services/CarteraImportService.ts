import { getSupabaseClient } from '../config/supabaseClient';
import { SUPABASE_CARTERA_TABLE } from '../config/env';
import { getCarteraDataSource } from '../config/dataSource';
import {
  loadWorkbookFromBuffer,
  pickCarteraWorksheet,
  readHeaders,
  validateHeaders,
  worksheetToRows,
  validateDateFields
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

const insertInBatches = async (rows: Record<string, unknown>[]): Promise<number> => {
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
  }

  return inserted;
};

export interface ReplaceCarteraResult {
  count: number;
}

// === LOGGING TEMPORAL (remover tras diagnosticar el 502 en Render) ===
const mem = () => `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB rss`;
const logStage = (msg: string) => console.log(`[UPLOAD] ${msg} | mem=${mem()}`);

export const processAndReplaceCartera = async (buffer: Buffer): Promise<ReplaceCarteraResult> => {
  // 1) Parseo y validación EN MEMORIA (sin tocar la base de datos todavía).
  logStage(`inicio processAndReplaceCartera (buffer ${Math.round(buffer.length / 1024)}KB)`);

  const workbook = await loadWorkbookFromBuffer(buffer);
  logStage('workbook cargado desde buffer');

  const worksheet = pickCarteraWorksheet(workbook);

  const headers = readHeaders(worksheet);
  const { ok, missing } = validateHeaders(headers);
  if (!ok) {
    throw new Error(`El archivo no tiene las columnas requeridas. Faltan: ${missing.join(', ')}`);
  }
  logStage(`columnas validadas (${headers.length} columnas)`);

  const rows = worksheetToRows(worksheet);
  if (rows.length === 0) {
    throw new Error('El archivo no contiene filas de datos.');
  }
  logStage(`filas parseadas: ${rows.length}`);

  validateDateFields(rows);
  logStage('fechas validadas');

  // 2) Reemplazo de la tabla (sólo tras validar correctamente).
  logStage('truncate: inicio');
  await truncateTable();
  logStage('truncate: fin');

  logStage('insert: inicio');
  const count = await insertInBatches(rows);
  logStage(`insert: fin (${count} filas)`);

  // 3) Invalidar la caché del dashboard para que lea los datos nuevos.
  getCarteraDataSource().clearCache?.();
  logStage('cache invalidada');

  return { count };
};
