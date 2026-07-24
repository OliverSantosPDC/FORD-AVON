/**
 * Contrato de una fuente de datos de cartera.
 * Tanto el adaptador de Excel como el de Supabase lo implementan, de modo que
 * el repositorio y el servicio son agnósticos del origen de los datos.
 */
export interface CarteraDataSource {
  getCartera(): Promise<Record<string, unknown>[]>;
  /** Invalida cualquier caché en memoria de la fuente (opcional). */
  clearCache?(): void;
}

export class CarteraRepository {
  private readonly source: CarteraDataSource;

  constructor(source: CarteraDataSource) {
    this.source = source;
  }

  async getCartera(): Promise<Record<string, unknown>[]> {
    return this.source.getCartera();
  }
}
