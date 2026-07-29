import ExcelJS from 'exceljs';

export const CALENDAR_TEMPLATE_COLUMNS = [
  'ACCION',
  'ID_EVENTO',
  'FECHA_INICIO',
  'FECHA_FIN',
  'TIPO_EVENTO',
  'PAIS',
  'ZONA',
  'TITULO',
  'DESCRIPCION',
  'USUARIO_EMAIL',
  'ACTIVO'
] as const;

export interface FilaCalendario {
  fila: number;
  accion: string;
  idEvento: string;
  fechaInicio: string;
  fechaFin: string;
  tipoEvento: string;
  pais: string;
  zona: string;
  titulo: string;
  descripcion: string;
  usuarioEmail: string;
  activo: string;
}

const cellText = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const any = value as { text?: unknown; result?: unknown };
    if (typeof any.text === 'string') return any.text;
    if (any.result !== undefined && any.result !== null) return String(any.result);
    return '';
  }
  return String(value);
};

export const generarPlantillaCalendario = async (): Promise<Buffer> => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FORD-AVON';
  const ws = wb.addWorksheet('Calendario');
  ws.columns = CALENDAR_TEMPLATE_COLUMNS.map((c) => ({ header: c, key: c, width: c === 'DESCRIPCION' ? 40 : 18 }));
  ws.getRow(1).font = { bold: true };
  ws.addRow(['CREAR', '', '2026-01-01', '2026-01-01', 'FERIADO_ASUETO', 'El Salvador', '', 'Año Nuevo', 'Fuente oficial', '', 'SI']);
  ws.addRow(['ACTUALIZAR', '<uuid>', '2026-01-01', '2026-01-01', 'FERIADO_ASUETO', 'El Salvador', '', 'Año Nuevo', '', '', 'SI']);
  ws.addRow(['ELIMINAR', '<uuid>', '', '', '', '', '', '', '', '', '']);

  const help = wb.addWorksheet('INSTRUCCIONES');
  help.columns = [{ header: 'Campo', key: 'c', width: 18 }, { header: 'Descripción', key: 'd', width: 90 }];
  help.getRow(1).font = { bold: true };
  ([
    ['ACCION', 'CREAR | ACTUALIZAR | ELIMINAR | ACTIVAR | DESACTIVAR'],
    ['ID_EVENTO', 'Obligatorio para ACTUALIZAR/ELIMINAR/ACTIVAR/DESACTIVAR (uuid del evento).'],
    ['FECHA_INICIO', 'YYYY-MM-DD. Obligatoria al CREAR.'],
    ['FECHA_FIN', 'YYYY-MM-DD. Si se omite, se usa FECHA_INICIO. No puede ser menor que FECHA_INICIO.'],
    ['TIPO_EVENTO', 'Código de event_types (p. ej. FERIADO_ASUETO, VACACIONES, FERIADO_LOCAL, OTRO).'],
    ['PAIS', 'Opcional. Alcance por país.'],
    ['ZONA', 'Opcional. Nombre o código de zona existente.'],
    ['TITULO', 'Obligatorio al CREAR.'],
    ['DESCRIPCION', 'Opcional. Indica la fuente/referencia de la fecha.'],
    ['USUARIO_EMAIL', 'Opcional. Alcance por usuario (debe existir).'],
    ['ACTIVO', 'SI | NO']
  ] as Array<[string, string]>).forEach((r) => help.addRow(r));

  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
};

export const parsearCalendario = async (buffer: Buffer): Promise<FilaCalendario[]> => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('El archivo no contiene ninguna hoja.');

  const index: Record<string, number> = {};
  ws.getRow(1).eachCell((cell, col) => {
    const key = cellText(cell.value).trim().toUpperCase().replace(/\s+/g, '_');
    if (key) index[key] = col;
  });
  const g = (row: ExcelJS.Row, col: string): string => (index[col] ? cellText(row.getCell(index[col]).value).trim() : '');

  const filas: FilaCalendario[] = [];
  for (let r = 2; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const accion = g(row, 'ACCION').toUpperCase();
    const titulo = g(row, 'TITULO');
    const idEvento = g(row, 'ID_EVENTO');
    if (!accion && !titulo && !idEvento) continue;
    filas.push({
      fila: r,
      accion,
      idEvento,
      fechaInicio: g(row, 'FECHA_INICIO'),
      fechaFin: g(row, 'FECHA_FIN'),
      tipoEvento: g(row, 'TIPO_EVENTO').toUpperCase(),
      pais: g(row, 'PAIS'),
      zona: g(row, 'ZONA'),
      titulo,
      descripcion: g(row, 'DESCRIPCION'),
      usuarioEmail: g(row, 'USUARIO_EMAIL'),
      activo: g(row, 'ACTIVO').toUpperCase()
    });
  }
  return filas;
};
