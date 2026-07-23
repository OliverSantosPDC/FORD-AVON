import { getSupabaseClient } from '../../config/supabaseClient';
import { SUPABASE_CARTERA_TABLE } from '../../config/env';
import { CarteraDataSource } from '../../repositories/CarteraRepository';

/**
 * Adaptador de lectura de la cartera desde Supabase PostgreSQL.
 * Implementa la misma interfaz que el adaptador de Excel para que el resto
 * de la arquitectura (repositorio, servicio, controladores) no cambie.
 */
export class SupabaseCarteraAdapter implements CarteraDataSource {
  private readonly table: string;
  private readonly pageSize = 1000; // Supabase limita cada respuesta a 1000 filas.

  constructor(table: string = SUPABASE_CARTERA_TABLE) {
    this.table = table;
  }

  async getCartera(): Promise<Record<string, unknown>[]> {
    const client = getSupabaseClient();
    const all: Record<string, unknown>[] = [];
    let from = 0;

    // Paginación por rangos para traer la tabla completa sin exceder el límite.
    for (;;) {
      const to = from + this.pageSize - 1;
      const { data, error } = await client.from(this.table).select('*').range(from, to);

      if (error) {
        throw new Error(`Error al leer la tabla "${this.table}" en Supabase: ${error.message}`);
      }

      if (!data || data.length === 0) {
        break;
      }

      all.push(...(data as Record<string, unknown>[]));

      if (data.length < this.pageSize) {
        break;
      }

      from += this.pageSize;
    }

    return all;
  }

  /** Devuelve el número de filas almacenadas en la tabla (para verificación). */
  async count(): Promise<number> {
    const client = getSupabaseClient();
    const { count, error } = await client.from(this.table).select('*', { count: 'exact', head: true });

    if (error) {
      throw new Error(`Error al contar filas en "${this.table}": ${error.message}`);
    }

    return count ?? 0;
  }
}
