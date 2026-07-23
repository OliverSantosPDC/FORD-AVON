import path from 'path';
import ExcelJS from 'exceljs';
import { getSupabaseClient } from '../config/supabaseClient';
import { SUPABASE_CARTERA_TABLE, SUPABASE_URL } from '../config/env';

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

/**
 * Un campo se trata como fecha si su nombre empieza por "fecha"
 * (fecha_de_nacimiento, fecha_asignacion, fecha_vencimiento, ...).
 * Así NO se tocan campos numéricos como codigo, zona, sector, los, loa,
 * saldo_*, dias_mora_actual, etc.
 */
const isDateField = (name: string): boolean => /^fecha/i.test(name);

/**
 * Convierte un número serial de Excel a una fecha ISO (YYYY-MM-DD).
 * Excel cuenta los días desde 1899-12-30 (epoch que compensa el bug del año
 * bisiesto 1900). Se descartan valores fuera del rango de fechas válidas.
 */
const excelSerialToISO = (serial: number): string | null => {
  if (!Number.isFinite(serial)) return null;
  const days = Math.floor(serial);
  if (days < 1 || days > 2958465) return null; // 1900-01-01 .. 9999-12-31
  const ms = Date.UTC(1899, 11, 30) + days * 86400000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

/**
 * Normaliza un valor de fecha proveniente de Excel a YYYY-MM-DD o null.
 * Acepta: número serial (38566), Date, string (ISO o serial), null/undefined,
 * y objetos de ExcelJS (fórmula/texto enriquecido).
 */
const toISODate = (value: ExcelJS.CellValue): string | null => {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }

  if (typeof value === 'number') {
    return excelSerialToISO(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    // Ya viene como fecha ISO/fecha con hora -> tomar YYYY-MM-DD.
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    // Serial de Excel representado como texto ("38566").
    if (/^\d+(\.\d+)?$/.test(trimmed)) return excelSerialToISO(Number(trimmed));
    // Cualquier otra fecha parseable.
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }

  if (typeof value === 'object') {
    const anyValue = value as unknown as Record<string, unknown>;
    if ('result' in anyValue) return toISODate(anyValue.result as ExcelJS.CellValue);
    if (typeof anyValue.text === 'string') return toISODate(anyValue.text as ExcelJS.CellValue);
    return null;
  }

  return null;
};

/** Convierte un valor de celda de ExcelJS a un valor plano apto para PostgreSQL. */
const normalizeCell = (value: ExcelJS.CellValue): unknown => {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    // Fecha en formato ISO (YYYY-MM-DD) compatible con columnas date/text.
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'object') {
    // Hipervínculos, texto enriquecido y fórmulas: extraer el texto legible.
    const anyValue = value as unknown as Record<string, unknown>;
    if (typeof anyValue.text === 'string') return anyValue.text;
    if (Array.isArray(anyValue.richText)) {
      return (anyValue.richText as Array<{ text?: string }>).map((part) => part.text ?? '').join('');
    }
    if ('result' in anyValue) return (anyValue.result as unknown) ?? null;
    if ('hyperlink' in anyValue) return (anyValue.hyperlink as unknown) ?? null;
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }

  return value;
};

const readExcelRows = async (limit: number | null): Promise<Record<string, unknown>[]> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);

  const worksheet =
    workbook.worksheets.find((sheet) => sheet.name.toUpperCase() === SHEET_NAME.toUpperCase()) ??
    workbook.worksheets[0];

  if (!worksheet) {
    throw new Error(`No se encontró la hoja "${SHEET_NAME}" en ${EXCEL_PATH}`);
  }

  const headerRow = worksheet.getRow(1);
  const headers: string[] = (Array.isArray(headerRow.values) ? headerRow.values : [])
    .slice(1)
    .map((value) => (value === null || value === undefined ? '' : String(value).trim()));

  const records: Record<string, unknown>[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // encabezados
    if (limit !== null && records.length >= limit) return;

    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      const cellValue = row.getCell(index + 1).value;
      // Los campos de fecha se convierten a YYYY-MM-DD; el resto se deja intacto.
      record[header] = isDateField(header) ? toISODate(cellValue) : normalizeCell(cellValue);
    });
    records.push(record);
  });

  return limit !== null ? records.slice(0, limit) : records;
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

/**
 * Validación segura previa al INSERT: revisa que TODOS los campos de fecha
 * sean null o una cadena YYYY-MM-DD válida. Si algo se cuela, identifica el
 * campo, la fila y el valor problemático y lanza un error claro (en vez del
 * mensaje opaco de PostgreSQL). No expone credenciales.
 */
const validateDateFields = (rows: Record<string, unknown>[]): void => {
  const isValidIsoDate = (v: unknown) =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v).getTime());

  const offenders: string[] = [];

  rows.forEach((row, index) => {
    Object.keys(row).forEach((key) => {
      if (!isDateField(key)) return;
      const value = row[key];
      if (value === null) return; // null es válido para columnas DATE
      if (!isValidIsoDate(value)) {
        offenders.push(`  fila ${index}: campo "${key}" = ${JSON.stringify(value)} (tipo ${typeof value})`);
      }
    });
  });

  if (offenders.length) {
    throw new Error(
      'Se detectaron valores de fecha no convertibles antes del INSERT ' +
        `(${offenders.length} caso(s)). Revisa estas celdas del Excel:\n` +
        offenders.slice(0, 20).join('\n') +
        (offenders.length > 20 ? `\n  ... y ${offenders.length - 20} más` : '')
    );
  }
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
