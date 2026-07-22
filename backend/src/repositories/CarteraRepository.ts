import { ExcelAdapter } from '../adapters/excel/ExcelAdapter';

export class CarteraRepository {
  private readonly adapter: ExcelAdapter;
  private readonly fileName = 'Cartera.xlsx';
  private readonly sheetName = 'Cartera';

  constructor(adapter: ExcelAdapter) {
    this.adapter = adapter;
  }

  async getCartera(): Promise<Record<string, unknown>[]> {
    return this.adapter.readSheet(this.fileName, this.sheetName);
  }
}
