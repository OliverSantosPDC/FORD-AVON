import path from 'path';
import ExcelJS from 'exceljs';
import { getSupabaseClient } from '../config/supabaseClient';
import { SUPABASE_CARTERA_TABLE, SUPABASE_URL } from '../config/env';
import { pickCarteraWorksheet, worksheetToRows, validateDateFields } from '../utils/carteraExcel';

/**
 * Importador por lotes de Cartera.xlsx hacia la tabla `cartera` de Supabase.
 *
 * Uso:
 *   node dist/scripts/importCartera.js                 -> importa TODO el archivo
 *   node dist/scripts/importCartera.js --limit=100     -> importa sólo 100 filas
 *   node dist/scripts/importCartera.js --test          -> modo prueba seguro:
 *                                                          inserta sólo si la tabla está vacía,
 *                                                          nunca borra datos
 *   node dist/scripts/importCartera.js --truncate      -> vacía la tabla antes de importar
 *   node dist/scripts/importCartera.js --batch=500     -> tamaño de lote (por defecto 500)
 *
 * El Excel se mantiene como fuente de carga; el dashboard consulta Supabase.
 */

const EXCEL_PATH = path.join(__dirname, '../../data/excel/Cartera.xlsx');
const SHEET_NAME = 'Cartera';

interface CliOptions {
  limit: number | null;
  truncate: boolean;
  test: boolean;
  batchSize: number;
}

const parseArgs = (): CliOptions => {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let truncate = false;
  let test = false;
  let batchSize = 500;

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      const value = Number(arg.split('=')[1]);
      limit = Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
    } else if (arg === '--truncate') {
      truncate = true;
    } else if (arg === '--test') {
      test = true;
    } else if (arg.startsWith('--batch=')) {
      const value = Number(arg.split('=')[1]);
      if (Number.isFinite(value) && value > 0) batchSize = Math.floor(value);
    }
  }

  return { limit, truncate, test, batchSize };
};

/** Cuenta las filas actuales de la tabla (operación de sólo lectura). */
const countRows = async (): Promise<number> => {
  const client = getSupabaseClient();
  const { count, error } = await client
    .from(SUPABASE_CARTERA_TABLE)
    .select('*', { count: 'exact', head: true });

  if (error) {
    throw new Error(`No se pudo contar las filas de "${SUPABASE_CARTERA_TABLE}": ${error.message}`);
  }

  return count ?? 0;
};

// Lectura y normalización reutilizando los helpers compartidos de carteraExcel.
const readExcelRows = async (limit: number | null): Promise<Record<string, unknown>[]> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);
  const worksheet = pickCarteraWorksheet(workbook);
  return worksheetToRows(worksheet, limit);
};

const truncateTable = async (): Promise<void> => {
  const client = getSupabaseClient();
  console.log(`Vaciando tabla "${SUPABASE_CARTERA_TABLE}"...`);

  // Borrado por lotes usando la clave de negocio `codigo` y el filtro `.in()`,
  // que es el más estable en PostgREST/Supabase. Se leen los códigos en páginas
  // y se eliminan por conjuntos, hasta que la tabla queda vacía.
  let totalDeleted = 0;

  for (;;) {
    const { data, error: readError } = await client
      .from(SUPABASE_CARTERA_TABLE)
      .select('codigo')
      .not('codigo', 'is', null)
      .limit(500);

    if (readError) {
      throw new Error(`No se pudieron leer códigos para vaciar la tabla: ${readError.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    const codigos = data.map((row) => (row as { codigo: unknown }).codigo).filter((c): c is string | number => c !== null && c !== undefined);

    if (codigos.length === 0) {
      break;
    }

    const { error: deleteError } = await client.from(SUPABASE_CARTERA_TABLE).delete().in('codigo', codigos);

    if (deleteError) {
      throw new Error(`No se pudo vaciar la tabla: ${deleteError.message}`);
    }

    totalDeleted += codigos.length;
    console.log(`  Eliminadas ${totalDeleted} filas...`);
  }

  console.log('Tabla vaciada.');
};


const insertInBatches = async (rows: Record<string, unknown>[], batchSize: number): Promise<number> => {
  const client = getSupabaseClient();
  let inserted = 0;

  // Red de seguridad: valida las fechas antes de enviar nada a Supabase.
  validateDateFields(rows);

  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const { error } = await client.from(SUPABASE_CARTERA_TABLE).insert(batch);

    if (error) {
      throw new Error(
        `Fallo al insertar el lote ${start}-${start + batch.length - 1}: ${error.message}` +
          (error.details ? ` | detalles: ${error.details}` : '') +
          (error.hint ? ` | pista: ${error.hint}` : '')
      );
    }

    inserted += batch.length;
    console.log(`  Insertadas ${inserted}/${rows.length} filas...`);
  }

  return inserted;
};

const main = async (): Promise<void> => {
  const { limit, truncate, test, batchSize } = parseArgs();

  console.log('=== Importación Cartera.xlsx -> Supabase ===');
  console.log(`Tabla destino : ${SUPABASE_CARTERA_TABLE}`);
  console.log(`Modo          : ${test ? 'prueba (--test)' : 'normal'}`);
  console.log(`Límite        : ${limit === null ? 'archivo completo' : limit}`);
  console.log(`Truncar antes : ${truncate ? 'sí' : 'no'}`);
  console.log(`Tamaño de lote: ${batchSize}`);
  // Diagnóstico seguro (NUNCA imprime la Service Role Key).
  console.log(`SUPABASE_URL normalizada : ${SUPABASE_URL}`);
  console.log(`Tabla usada (SELECT/INSERT): ${SUPABASE_CARTERA_TABLE}`);
  console.log('');

  console.log('Leyendo Excel...');
  const rows = await readExcelRows(limit);
  console.log(`Filas leídas del Excel: ${rows.length}`);

  if (rows.length === 0) {
    console.log('No hay filas para importar. Fin.');
    return;
  }

  // Modo prueba: NO borra datos. Sólo inserta si la tabla está vacía.
  if (test) {
    const existentes = await countRows();
    console.log(`Filas actuales en la tabla: ${existentes}`);

    if (existentes > 0) {
      console.log('');
      console.log('=== Prueba detenida ===');
      console.log(
        `La tabla "${SUPABASE_CARTERA_TABLE}" ya contiene ${existentes} registro(s). ` +
          'El modo de prueba no borra datos automáticamente.'
      );
      console.log(
        'Para recargar desde cero ejecuta la importación con la bandera --truncate ' +
          '(p. ej. la carga completa "npm run import:cartera").'
      );
      return;
    }

    console.log('Tabla vacía: se omite el truncate y se procede a insertar.');
  } else if (truncate) {
    await truncateTable();
  }

  console.log('Insertando en Supabase...');
  const inserted = await insertInBatches(rows, batchSize);

  // Verificación: contar filas realmente almacenadas.
  const client = getSupabaseClient();
  const { count, error } = await client
    .from(SUPABASE_CARTERA_TABLE)
    .select('*', { count: 'exact', head: true });

  if (error) {
    throw new Error(`Importación hecha pero falló la verificación de conteo: ${error.message}`);
  }

  console.log('');
  console.log('=== Resultado ===');
  console.log(`Filas insertadas en esta corrida: ${inserted}`);
  console.log(`Filas totales en la tabla        : ${count}`);
  console.log('Importación finalizada correctamente.');
};

main().catch((err) => {
  console.error('');
  console.error('ERROR EN LA IMPORTACIÓN:');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
