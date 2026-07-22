import path from 'path';
import ExcelJS from 'exceljs';

export class ExcelAdapter {
  private readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async readSheet(
    fileName: string,
    sheetName: string
  ): Promise<Record<string, unknown>[]> {
    const filePath = path.join(this.basePath, fileName);

    const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
      worksheets: 'emit',
      sharedStrings: 'cache',
      hyperlinks: 'ignore',
      styles: 'ignore',
      entries: 'ignore',
    });

    const normalizedSheetName = sheetName.toUpperCase();
    const records: Record<string, unknown>[] = [];

    for await (const worksheetReader of workbookReader) {
      if (worksheetReader.name.toUpperCase() !== normalizedSheetName) {
        continue;
      }

      let headers: string[] = [];

      for await (const row of worksheetReader) {
        const values = row.values as ExcelJS.CellValue[];

        if (row.number === 1) {
          headers = values
            .slice(1)
            .map((value) =>
              value === null || value === undefined
                ? ''
                : String(this.serializeCellValue(value))
            );

          continue;
        }

        if (headers.length === 0) {
          continue;
        }

        const rowData: Record<string, unknown> = {};

        headers.forEach((header, index) => {
          if (!header) return;

          const value = values[index + 1];

          rowData[header] =
            value === null || value === undefined
              ? null
              : this.serializeCellValue(value);
        });

        records.push(rowData);
      }

      return records;
    }

    throw new Error(`Hoja no encontrada: ${sheetName}`);
  }

  private serializeCellValue(value: ExcelJS.CellValue): unknown {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'object') {
      if ('text' in value && typeof value.text === 'string') {
        return value.text;
      }

      if ('richText' in value && Array.isArray(value.richText)) {
        return value.richText.map((part) => part.text).join('');
      }

      return JSON.stringify(value);
    }

    return value;
  }
}