/**
 * FORD-AVON — Regresión del bug "Excel no puede abrir el archivo porque el
 * formato o la extensión no son válidos" en TODOS los botones "Descargar
 * Excel" de la app (Gestión > Tipificaciones/Operación, Control Operativo,
 * Configuración, Calendario, Asignación, Repositorio, Dashboard — todos
 * comparten `exportRowsToExcel`/`buildXlsxWorkbookBytes` en tableExport.ts).
 *
 * CAUSA ORIGINAL: `exportRowsToExcel` generaba un XML "SpreadsheetML 2003"
 * (texto plano, nunca un ZIP) y lo descargaba con extensión `.xlsx` — Excel
 * moderno valida que un `.xlsx` sea realmente un paquete OOXML/ZIP y lo
 * rechaza. Este archivo prueba, contra el código REAL ya compilado por
 * Node (vía --experimental-strip-types, sin reimplementar nada), que el
 * reemplazo (SheetJS `xlsx`, `bookType: 'xlsx'`) genera bytes que SON un
 * ZIP válido, nunca texto/XML/JSON.
 *
 * Ejecutar: node --experimental-strip-types --test test/tableExport.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildXlsxWorkbookBytes, normalizeXlsxFileName } from '../src/utils/tableExport.ts';

const HEADERS = ['Código', 'Nombre / Razón Social', 'Tipificación', 'Saldo Actual', 'Monto Promesa'];
const ROWS: Array<Array<string | number>> = [
  ['785583', 'LIGIA PETRONA BERMUDEZ', 'PROMESA DE PAGO', 1953.49, 1000],
  ['531872', 'ANY BERCELY REYES ROMERO', 'RECADO', 311.73, '']
];

const toBuffer = (bytes: ArrayBuffer) => Buffer.from(bytes);

test('buildXlsxWorkbookBytes: los bytes son un ZIP real (firma PK\\x03\\x04), NUNCA XML/JSON/CSV disfrazado', () => {
  const bytes = buildXlsxWorkbookBytes('Cuentas', HEADERS, ROWS);
  const buf = toBuffer(bytes);
  assert.equal(buf.length > 2000, true, 'un XLSX real con estilos/tema nunca pesa unos pocos bytes');
  assert.equal(buf.subarray(0, 4).toString('latin1'), 'PK\u0003\u0004', 'firma ZIP local-file-header ausente: no es un XLSX real');
  // Guardas explícitas contra las 3 formas en las que el bug se manifestaba:
  assert.notEqual(buf.subarray(0, 1).toString('latin1'), '<', 'NUNCA debe ser XML/SpreadsheetML 2003 (el bug original)');
  assert.notEqual(buf.subarray(0, 1).toString('latin1'), '{', 'NUNCA debe ser JSON crudo descargado como .xlsx');
  assert.notEqual(buf.subarray(0, 1).toString('latin1'), '[', 'NUNCA debe ser JSON (array) crudo descargado como .xlsx');
});

test('buildXlsxWorkbookBytes: contiene las partes OOXML obligatorias ([Content_Types].xml, xl/workbook.xml, xl/worksheets/, _rels/)', () => {
  const bytes = buildXlsxWorkbookBytes('Cuentas', HEADERS, ROWS);
  // Los nombres de entrada de un ZIP están en texto plano dentro del propio
  // archivo (local file headers) — basta con buscarlos en los bytes crudos,
  // sin necesitar un parser ZIP aparte.
  const text = toBuffer(bytes).toString('latin1');
  for (const required of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/', '_rels/']) {
    assert.equal(text.includes(required), true, `falta la parte OOXML obligatoria: ${required}`);
  }
});

test('buildXlsxWorkbookBytes: se puede RELEER con una librería XLSX real y los encabezados/valores coinciden exactamente', () => {
  const bytes = buildXlsxWorkbookBytes('Cuentas', HEADERS, ROWS);
  const workbook = XLSX.read(bytes, { type: 'array' });
  assert.deepEqual(workbook.SheetNames, ['Cuentas']);
  const sheet = workbook.Sheets['Cuentas'];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as Array<Array<string | number>>;
  assert.deepEqual(data[0], HEADERS);
  assert.equal(data[1][0], '785583');
  assert.equal(data[1][2], 'PROMESA DE PAGO');
  assert.equal(data[1][3], 1953.49);
  assert.equal(data[1][4], 1000);
  assert.equal(data[2][0], '531872');
  assert.equal(data[2][2], 'RECADO');
});

test('buildXlsxWorkbookBytes: nombre de hoja largo/con caracteres inválidos se sanea (nunca rompe el workbook)', () => {
  const bytes = buildXlsxWorkbookBytes('Tipificación: Promesa/Pago [2026]*?', HEADERS, ROWS);
  const workbook = XLSX.read(bytes, { type: 'array' });
  assert.equal(workbook.SheetNames.length, 1);
  assert.equal(workbook.SheetNames[0].length <= 31, true);
  assert.equal(/[\\/?*[\]:]/.test(workbook.SheetNames[0]), false);
});

test('buildXlsxWorkbookBytes: filas vacías (0 cuentas) siguen produciendo un XLSX válido con solo encabezados — nunca un archivo corrupto', () => {
  const bytes = buildXlsxWorkbookBytes('Cuentas', HEADERS, []);
  const buf = toBuffer(bytes);
  assert.equal(buf.subarray(0, 4).toString('latin1'), 'PK\u0003\u0004');
  const workbook = XLSX.read(bytes, { type: 'array' });
  const data = XLSX.utils.sheet_to_json(workbook.Sheets['Cuentas'], { header: 1 }) as Array<Array<string | number>>;
  assert.deepEqual(data[0], HEADERS);
  assert.equal(data.length, 1);
});

test('normalizeXlsxFileName: SIEMPRE termina en .xlsx, incluso si el llamador pasó .xls/.xlsx/.xml o sin extensión', () => {
  assert.equal(normalizeXlsxFileName('gestion_tipificaciones_cuentas.xlsx'), 'gestion_tipificaciones_cuentas.xlsx');
  assert.equal(normalizeXlsxFileName('resumen-pd.xls'), 'resumen-pd.xlsx');
  assert.equal(normalizeXlsxFileName('reporte.xml'), 'reporte.xlsx');
  assert.equal(normalizeXlsxFileName('sin_extension'), 'sin_extension.xlsx');
});
