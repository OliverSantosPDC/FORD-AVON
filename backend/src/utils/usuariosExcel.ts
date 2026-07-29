import ExcelJS from 'exceljs';

/**
 * Plantilla y parseo de la carga masiva de usuarios (módulo Repositorio).
 * Reutiliza ExcelJS (ya usado por la importación de cartera).
 */

export const TEMPLATE_COLUMNS = [
  'ACCION',
  'EMAIL',
  'NOMBRE',
  'APELLIDO',
  'ROL',
  'NOMBRE_CARTERA',
  'ZONA',
  'ACTIVO'
] as const;

export interface FilaImport {
  fila: number;
  accion: string;
  email: string;
  nombre: string;
  apellido: string;
  rol: string;
  nombreCartera: string;
  zona: string;
  activo: string;
}

const cellText = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const any = value as { text?: unknown; result?: unknown };
    if (typeof any.text === 'string') return any.text;
    if (any.result !== undefined && any.result !== null) return String(any.result);
    return '';
  }
  return String(value);
};

/** Genera la plantilla oficial .xlsx (encabezados + ejemplos + instrucciones). */
export const generarPlantilla = async (): Promise<Buffer> => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FORD-AVON';

  const ws = wb.addWorksheet('Usuarios');
  ws.columns = TEMPLATE_COLUMNS.map((c) => ({ header: c, key: c, width: c === 'NOMBRE_CARTERA' ? 26 : 18 }));
  ws.getRow(1).font = { bold: true };

  // Ejemplos (no se procesan si el usuario los borra; son guía).
  ws.addRow(['CREAR', 'gestor1@empresa.com', 'Juan', 'Pérez', 'gestor', 'GESTOR 01', '', 'SI']);
  ws.addRow(['CREAR', 'super1@empresa.com', 'Ana', 'López', 'supervisor', 'GESTOR 01;GESTOR 02', '', 'SI']);
  ws.addRow(['CREAR', 'gerente1@empresa.com', 'Luis', 'Gómez', 'gerente_zona', '', 'ZONA NORTE;ZONA CENTRO', 'SI']);
  ws.addRow(['ACTUALIZAR', 'gestor1@empresa.com', 'Juan', 'Pérez', 'gestor', 'GESTOR 03', '', 'SI']);
  ws.addRow(['DESACTIVAR', 'gestor1@empresa.com', '', '', '', '', '', 'NO']);

  const help = wb.addWorksheet('Instrucciones');
  help.columns = [{ header: 'Campo', key: 'campo', width: 20 }, { header: 'Descripción', key: 'desc', width: 90 }];
  help.getRow(1).font = { bold: true };
  const rows: Array<[string, string]> = [
    ['ACCION', 'CREAR | ACTUALIZAR | ACTIVAR | DESACTIVAR'],
    ['EMAIL', 'Identificador del usuario. Obligatorio. Se compara sin distinguir mayúsculas.'],
    ['NOMBRE', 'Obligatorio al CREAR.'],
    ['APELLIDO', 'Obligatorio al CREAR.'],
    ['ROL', 'administrador | liderazgo | supervisor | gerente_zona | gestor'],
    ['NOMBRE_CARTERA', 'Gestor: 1 valor existente en cartera.gestor. Supervisor: varios separados por ; (sus gestores).'],
    ['ZONA', 'Gerente de zona: uno o varios nombres/códigos de zona separados por ;'],
    ['ACTIVO', 'SI | NO'],
    ['', ''],
    ['Notas', 'ADMINISTRADOR y LIDERAZGO no requieren NOMBRE_CARTERA ni ZONA (alcance global).'],
    ['Notas', 'La validación no modifica datos; la aplicación crea invitaciones por correo (sin contraseñas).']
  ];
  rows.forEach((r) => help.addRow(r));

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
};

/** Parsea el archivo subido a filas normalizadas (mapeo por encabezado). */
export const parsearUsuarios = async (buffer: Buffer): Promise<FilaImport[]> => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('El archivo no contiene ninguna hoja.');

  // Índice de columnas por encabezado normalizado.
  const headerRow = ws.getRow(1);
  const index: Record<string, number> = {};
  headerRow.eachCell((cell, colNumber) => {
    const key = cellText(cell.value).trim().toUpperCase().replace(/\s+/g, '_');
    if (key) index[key] = colNumber;
  });

  const get = (row: ExcelJS.Row, col: string): string => {
    const c = index[col];
    return c ? cellText(row.getCell(c).value).trim() : '';
  };

  const filas: FilaImport[] = [];
  for (let r = 2; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const accion = get(row, 'ACCION').toUpperCase();
    const email = get(row, 'EMAIL');
    // Salta filas totalmente vacías.
    if (!accion && !email && !get(row, 'NOMBRE')) continue;
    filas.push({
      fila: r,
      accion,
      email,
      nombre: get(row, 'NOMBRE'),
      apellido: get(row, 'APELLIDO'),
      rol: get(row, 'ROL').toLowerCase(),
      nombreCartera: get(row, 'NOMBRE_CARTERA'),
      zona: get(row, 'ZONA'),
      activo: get(row, 'ACTIVO').toUpperCase()
    });
  }
  return filas;
};
