import * as XLSX from 'xlsx';

export const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const escapeCsvCell = (value: string | number) => `"${String(value ?? '').replace(/"/g, '""')}"`;

export const exportRowsToCsv = (fileName: string, headers: string[], rows: Array<Array<string | number>>) => {
  const csv = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
  downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), fileName);
};

/** Nombre de hoja válido para OOXML: máx. 31 caracteres, sin los caracteres
 *  que Excel prohíbe en un nombre de hoja ( \ / ? * [ ] : ), nunca vacío. */
const safeSheetName = (name: string): string => {
  const cleaned = (name || '').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31);
  return cleaned || 'Datos';
};

/** `fileName` normalizado para terminar SIEMPRE en `.xlsx`, sin importar lo
 *  que pase cada llamador (algunos pasaban `.xls`, que tampoco coincide con
 *  el contenido real que `buildXlsxWorkbookBytes` genera). */
export const normalizeXlsxFileName = (fileName: string): string => fileName.replace(/\.(xlsx?|xml)$/i, '') + '.xlsx';

/**
 * Construye los bytes REALES de un paquete OOXML/ZIP (.xlsx vía SheetJS) —
 * NUNCA un XML de "SpreadsheetML 2003" disfrazado con extensión .xlsx (lo
 * que había antes: Excel moderno rechaza esos archivos con "el formato o la
 * extensión no son válidos", porque valida que el contenido sea realmente
 * un ZIP). Pura (sin tocar `document`/`URL`): así se puede probar en Node
 * sin DOM, inspeccionando los bytes exactos que `exportRowsToExcel` empaqueta.
 */
export const buildXlsxWorkbookBytes = (sheetName: string, headers: string[], rows: Array<Array<string | number>>): ArrayBuffer => {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName(sheetName));
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
};

export const exportRowsToExcel = (
  fileName: string,
  sheetName: string,
  headers: string[],
  rows: Array<Array<string | number>>
) => {
  const bytes = buildXlsxWorkbookBytes(sheetName, headers, rows);
  downloadBlob(
    new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    normalizeXlsxFileName(fileName)
  );
};

export const copyRowsToClipboard = async (headers: string[], rows: Array<Array<string | number>>) => {
  const text = [headers, ...rows].map((row) => row.join('\t')).join('\n');

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall through to legacy method below
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
};
