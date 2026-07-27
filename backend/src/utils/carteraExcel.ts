import ExcelJS from 'exceljs';
import { Readable } from 'stream';

/**
 * Utilidades compartidas de lectura/normalización de Cartera.xlsx.
 * Fuente única usada por el script de importación (CLI) y por la carga desde
 * la plataforma (POST /api/upload/cartera), para evitar duplicación.
 */

export const CARTERA_SHEET_NAME = 'Cartera';

/**
 * Columnas mínimas que el dashboard y las agregaciones necesitan. Si alguna
 * falta, el archivo se rechaza ANTES de tocar la base de datos.
 */
export const REQUIRED_CARTERA_COLUMNS = [
  'codigo',
  'pais',
  'campania_adeuda',
  'nombre',
  'zona',
  'sector',
  'saldo_inicial',
  'saldo_actual',
  'saldo_inicial_usd',
  'saldo_actual_usd',
  'pd_actual',
  'gestor',
  'gerente_zona'
];

/**
 * Columnas reales de la tabla `cartera`. Se usan como destino canónico al mapear
 * los encabezados del Excel (que pueden venir con mayúsculas, acentos, espacios,
 * guiones, etc.). NO se cambia la estructura de la tabla; sólo se detecta la
 * columna equivalente.
 */
export const CARTERA_DB_COLUMNS = [
  'cod_pais_cam',
  'codigo',
  'pais',
  'campania_adeuda',
  'nombre',
  'zona',
  'sector',
  'los',
  'loa',
  'saldo_inicial',
  'pd_inicial',
  'dias_mora_actual',
  'fecha_de_nacimiento',
  'departamento',
  'municipio',
  'telefono_celular',
  'telefono_casa',
  'telefono_trabajo',
  'telefono_ext_tel_trabajo',
  'ref_nombre',
  'ref_tel_1',
  'ref_tel_2',
  'saldo_actual',
  'pd_actual',
  'saldo_inicial_usd',
  'saldo_actual_usd',
  'gestor',
  'gerente_zona',
  'contacto_gerente'
];

/**
 * Normaliza un encabezado a una forma canónica comparable:
 * quita acentos/diacríticos, pasa a minúsculas, recorta y convierte cualquier
 * separador (espacios, guiones, especiales) en "_", sin "_" al inicio/fin.
 * Ej: "Código" -> "codigo", "Saldo Inicial USD" -> "saldo_inicial_usd",
 *     "PD Actual" -> "pd_actual", "Gerente Zona" -> "gerente_zona".
 */
export const canonicalizeHeader = (raw: unknown): string =>
  String(raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/**
 * Alias adicionales cuya forma canónica NO coincide con el nombre de la columna
 * (p. ej. "Campaña" -> canónico "campana", pero la columna es "campania_adeuda").
 * clave: forma canónica del encabezado -> valor: columna real de la tabla.
 */
const EXTRA_HEADER_ALIASES: Record<string, string> = {
  campana_adeuda: 'campania_adeuda',
  campania: 'campania_adeuda',
  campana: 'campania_adeuda',
  campania_que_adeuda: 'campania_adeuda',
  campana_que_adeuda: 'campania_adeuda'
};

// Mapa: forma canónica -> columna real de la tabla.
const CANON_TO_DB_COLUMN = new Map<string, string>();
CARTERA_DB_COLUMNS.forEach((col) => CANON_TO_DB_COLUMN.set(canonicalizeHeader(col), col));
Object.entries(EXTRA_HEADER_ALIASES).forEach(([alias, col]) => CANON_TO_DB_COLUMN.set(canonicalizeHeader(alias), col));

/** Resuelve un encabezado del Excel a la columna real de la tabla, o null si no corresponde. */
export const resolveDbColumn = (rawHeader: unknown): string | null => {
  const canon = canonicalizeHeader(rawHeader);
  if (!canon) return null;
  return CANON_TO_DB_COLUMN.get(canon) ?? null;
};

/** Un campo se trata como fecha si su nombre empieza por "fecha". */
export const isDateField = (name: string): boolean => /^fecha/i.test(name);

/** Convierte un número serial de Excel a fecha ISO (YYYY-MM-DD) o null. */
export const excelSerialToISO = (serial: number): string | null => {
  if (!Number.isFinite(serial)) return null;
  const days = Math.floor(serial);
  if (days < 1 || days > 2958465) return null; // 1900-01-01 .. 9999-12-31
  const ms = Date.UTC(1899, 11, 30) + days * 86400000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

/** Normaliza un valor de fecha de Excel a YYYY-MM-DD o null. */
export const toISODate = (value: ExcelJS.CellValue): string | null => {
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
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    if (/^\d+(\.\d+)?$/.test(trimmed)) return excelSerialToISO(Number(trimmed));
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
export const normalizeCell = (value: ExcelJS.CellValue): unknown => {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'object') {
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

/** Selecciona la hoja "Cartera" (insensible a mayúsculas) o la primera hoja. */
export const pickCarteraWorksheet = (workbook: ExcelJS.Workbook): ExcelJS.Worksheet => {
  const worksheet =
    workbook.worksheets.find((sheet) => sheet.name.toUpperCase() === CARTERA_SHEET_NAME.toUpperCase()) ??
    workbook.worksheets[0];

  if (!worksheet) {
    throw new Error(`No se encontró la hoja "${CARTERA_SHEET_NAME}" en el archivo.`);
  }

  return worksheet;
};

/** Lee los encabezados (fila 1) de una hoja. */
export const readHeaders = (worksheet: ExcelJS.Worksheet): string[] => {
  const headerValues = worksheet.getRow(1).values;
  const list = Array.isArray(headerValues) ? headerValues : [];
  return list.slice(1).map((value) => (value === null || value === undefined ? '' : String(value).trim()));
};

/**
 * Verifica que existan todas las columnas requeridas mapeando cada encabezado
 * del Excel a su columna real (insensible a mayúsculas/acentos/espacios/guiones).
 */
export const validateHeaders = (headers: string[]): { ok: boolean; missing: string[] } => {
  const present = new Set<string>();
  headers.forEach((header) => {
    const dbColumn = resolveDbColumn(header);
    if (dbColumn) present.add(dbColumn);
  });
  const missing = REQUIRED_CARTERA_COLUMNS.filter((col) => !present.has(col));
  return { ok: missing.length === 0, missing };
};

/** Convierte una hoja en filas normalizadas (fechas a YYYY-MM-DD, resto intacto). */
export const worksheetToRows = (worksheet: ExcelJS.Worksheet, limit: number | null = null): Record<string, unknown>[] => {
  const headers = readHeaders(worksheet);
  // Cada encabezado se resuelve UNA sola vez a su columna real de la tabla.
  const dbColumns = headers.map((header) => resolveDbColumn(header));
  const records: Record<string, unknown>[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    if (limit !== null && records.length >= limit) return;

    const record: Record<string, unknown> = {};
    dbColumns.forEach((dbColumn, index) => {
      if (!dbColumn) return; // encabezado que no corresponde a una columna de la tabla
      const cellValue = row.getCell(index + 1).value;
      record[dbColumn] = isDateField(dbColumn) ? toISODate(cellValue) : normalizeCell(cellValue);
    });
    records.push(record);
  });

  return limit !== null ? records.slice(0, limit) : records;
};

/**
 * Valida que todos los campos de fecha sean null o YYYY-MM-DD válido.
 * Lanza un error claro identificando campo/fila/valor si algo se cuela.
 */
export const validateDateFields = (rows: Record<string, unknown>[]): void => {
  const isValidIsoDate = (v: unknown) =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v).getTime());

  const offenders: string[] = [];

  rows.forEach((row, index) => {
    Object.keys(row).forEach((key) => {
      if (!isDateField(key)) return;
      const value = row[key];
      if (value === null) return;
      if (!isValidIsoDate(value)) {
        offenders.push(`  fila ${index}: campo "${key}" = ${JSON.stringify(value)} (tipo ${typeof value})`);
      }
    });
  });

  if (offenders.length) {
    throw new Error(
      'Se detectaron valores de fecha no convertibles ' +
        `(${offenders.length} caso(s)):\n` +
        offenders.slice(0, 20).join('\n') +
        (offenders.length > 20 ? `\n  ... y ${offenders.length - 20} más` : '')
    );
  }
};

/** Carga un workbook de ExcelJS desde un buffer en memoria. */
export const loadWorkbookFromBuffer = async (buffer: Buffer): Promise<ExcelJS.Workbook> => {
  const workbook = new ExcelJS.Workbook();
  // Cast por diferencias de tipado entre el Buffer de Node y el que espera ExcelJS.
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return workbook;
};

/**
 * Valida los campos de fecha de UN registro (streaming, sin acumular filas).
 * Lanza un error claro indicando la fila y el campo si algo no es válido.
 */
export const validateRecordDates = (record: Record<string, unknown>, rowNumber: number): void => {
  const isValidIsoDate = (v: unknown) =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v).getTime());

  for (const key of Object.keys(record)) {
    if (!isDateField(key)) continue;
    const value = record[key];
    if (value === null) continue;
    if (!isValidIsoDate(value)) {
      throw new Error(`Valor de fecha inválido en la fila ${rowNumber}, campo "${key}": ${JSON.stringify(value)}`);
    }
  }
};

export interface StreamRowHandlers {
  onHeaders?: (dbColumns: (string | null)[], rawHeaders: string[]) => void;
  onRow: (record: Record<string, unknown>, rowNumber: number) => Promise<void> | void;
}

/**
 * Recorre un XLSX por STREAMING (ExcelJS WorkbookReader) fila por fila, sin
 * acumular todas las filas en memoria. Mapea cada encabezado a su columna real
 * y entrega cada registro normalizado al handler (que puede ser asíncrono, lo
 * que permite aplicar backpressure al insertar por lotes). Reutiliza la misma
 * normalización (resolveDbColumn/isDateField/toISODate/normalizeCell).
 */
export const streamWorkbookRows = async (readStream: Readable, handlers: StreamRowHandlers): Promise<void> => {
  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(readStream, {
    worksheets: 'emit',
    sharedStrings: 'cache',
    styles: 'ignore',
    hyperlinks: 'ignore'
  });

  let dbColumns: (string | null)[] = [];
  let headerSeen = false;

  for await (const worksheet of workbookReader) {
    for await (const row of worksheet) {
      if (!headerSeen && row.number === 1) {
        const values = Array.isArray(row.values) ? row.values : [];
        const rawHeaders = values.slice(1).map((value) => (value === null || value === undefined ? '' : String(value).trim()));
        dbColumns = rawHeaders.map((header) => resolveDbColumn(header));
        headerSeen = true;
        handlers.onHeaders?.(dbColumns, rawHeaders);
        continue;
      }

      if (!headerSeen) continue;

      const record: Record<string, unknown> = {};
      dbColumns.forEach((dbColumn, index) => {
        if (!dbColumn) return; // encabezado que no corresponde a una columna de la tabla
        const cellValue = row.getCell(index + 1).value as ExcelJS.CellValue;
        record[dbColumn] = isDateField(dbColumn) ? toISODate(cellValue) : normalizeCell(cellValue);
      });
      await handlers.onRow(record, row.number);
    }
  }
};
