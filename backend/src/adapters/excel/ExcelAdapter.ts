import path from 'path';
import ExcelJS from 'exceljs';

export class ExcelAdapter {
  private readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async readSheet(fileName: string, sheetName: string): Promise<Record<string, unknown>[]> {
    const filePath = path.join(this.basePath, fileName);
    const workbook = new ExcelJS.Workbook();

    try {
      await workbook.xlsx.readFile(filePath);
    } catch (error) {
      throw new Error(`Archivo no encontrado o no se pudo abrir: ${fileName}`);
    }

    const normalizedSheetName = sheetName.toUpperCase();
    const worksheet = workbook.worksheets.find((sheet) => sheet.name.toUpperCase() === normalizedSheetName);

    if (!worksheet) {
      const availableSheets = workbook.worksheets.map((sheet) => sheet.name).join(', ');
      throw new Error(`Hoja no encontrada: ${sheetName}. Hojas disponibles: ${availableSheets}`);
    }

    const headerRow = worksheet.getRow(1);
    const headerValues = Array.isArray(headerRow.values) ? headerRow.values : [];
    const headers: string[] = headerValues
      .slice(1)
      .map((value) => (value === null || value === undefined ? '' : String(value)));

    if (headers.length === 0) {
      throw new Error(`Hoja vacía o sin encabezados: ${sheetName}`);
    }

    const records: Record<string, unknown>[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) {
        return;
      }

      const rowData: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        const cell = row.getCell(index + 1);
        const value = cell.value;
        rowData[header] = value === null || value === undefined ? null : this.serializeCellValue(value);
      });
      records.push(rowData);
    });

    return records;
  }

  private serializeCellValue(value: ExcelJS.CellValue): unknown {
    if (value === null) {
      return null;
    }

    if (typeof value === 'object') {
      if ('text' in value && typeof value.text === 'string') {
        return value.text;
      }
      if ('richText' in value) {
        return value.richText?.map((part) => part.text).join('') ?? null;
      }
      return JSON.stringify(value);
    }

    return value;
  }
}
