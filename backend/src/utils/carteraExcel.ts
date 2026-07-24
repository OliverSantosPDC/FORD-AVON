import ExcelJS from 'exceljs';

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

/** Verifica que existan todas las columnas requeridas (insensible a mayúsculas). */
export const validateHeaders = (headers: string[]): { ok: boolean; missing: string[] } => {
  const present = new Set(headers.map((h) => h.toLowerCase()));
  const missing = REQUIRED_CARTERA_COLUMNS.filter((col) => !present.has(col.toLowerCase()));
  return { ok: missing.length === 0, missing };
};

/** Convierte una hoja en filas normalizadas (fechas a YYYY-MM-DD, resto intacto). */
export const worksheetToRows = (worksheet: ExcelJS.Worksheet, limit: number | null = null): Record<string, unknown>[] => {
  const headers = readHeaders(worksheet);
  const records: Record<string, unknown>[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    if (limit !== null && records.length >= limit) return;

    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      const cellValue = row.getCell(index + 1).value;
      record[header] = isDateField(header) ? toISODate(cellValue) : normalizeCell(cellValue);
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
