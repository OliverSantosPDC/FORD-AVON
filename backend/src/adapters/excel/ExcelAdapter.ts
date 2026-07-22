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
      entries: 'emit',
    });

    const records: Record<string, unknown>[] = [];
    let headers: string[] = [];

    try {
      for await (const worksheetReader of workbookReader) {
        if (
          worksheetReader.name.toUpperCase() !==
          sheetName.toUpperCase()
        ) {
          continue;
        }

        let rowNumber = 0;

        for await (const row of worksheetReader) {
          rowNumber++;

          const values = row.values as ExcelJS.CellValue[];

          if (rowNumber === 1) {
            headers = values
              .slice(1)
              .map((value) =>
                value === null || value === undefined
                  ? ''
                  : String(value)
              );

            if (headers.length === 0) {
              throw new Error(
                `Hoja vacía o sin encabezados: ${sheetName}`
              );
            }

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
    } catch (error) {
      console.error('Error leyendo Excel:', error);
      throw new Error(
        `Archivo no encontrado o no se pudo abrir: ${fileName}`
      );
    }

    throw new Error(
      `Hoja no encontrada: ${sheetName}`
    );
  }

  private serializeCellValue(
    value: ExcelJS.CellValue
  ): unknown {
    if (value === null) {
      return null;
    }

    if (typeof value === 'object') {
      if (
        'text' in value &&
        typeof value.text === 'string'
      ) {
        return value.text;
      }

      if ('richText' in value) {
        return (
          value.richText
            ?.map((part) => part.text)
            .join('') ?? null
        );
      }

      return JSON.stringify(value);
    }

    return value;
  }
}