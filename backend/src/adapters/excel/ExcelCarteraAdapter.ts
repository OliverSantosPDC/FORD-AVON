import path from 'path';
import { ExcelAdapter } from './ExcelAdapter';
import { CarteraDataSource } from '../../repositories/CarteraRepository';

/**
 * Fuente de datos basada en el archivo Cartera.xlsx.
 * Envuelve el ExcelAdapter genérico y expone la interfaz CarteraDataSource,
 * conservando el comportamiento anterior como fallback (DATA_SOURCE=excel).
 */
export class ExcelCarteraAdapter implements CarteraDataSource {
  private readonly adapter: ExcelAdapter;
  private readonly fileName = 'Cartera.xlsx';
  private readonly sheetName = 'Cartera';

  constructor(basePath: string = path.join(__dirname, '../../../data/excel')) {
    this.adapter = new ExcelAdapter(basePath);
  }

  async getCartera(): Promise<Record<string, unknown>[]> {
    return this.adapter.readSheet(this.fileName, this.sheetName);
  }
}
