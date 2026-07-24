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
  private readonly cacheTtlMs = 60_000; // Cartera cambia sólo al importar; caché breve.

  // Caché en memoria compartida entre peticiones (el adaptador es singleton).
  private cache: { rows: Record<string, unknown>[]; expires: number } | null = null;

  constructor(table: string = SUPABASE_CARTERA_TABLE) {
    this.table = table;
  }

  async getCartera(): Promise<Record<string, unknown>[]> {
    const now = Date.now();
    if (this.cache && this.cache.expires > now) {
      console.log('[PERF] supabase: CACHE HIT (0 consultas)');
      return this.cache.rows;
    }
    console.log('[PERF] supabase: CACHE MISS -> leyendo de Supabase');

    // === INSTRUMENTACIÓN TEMPORAL (remover tras el diagnóstico) ===
    const tReadStart = Date.now();

    const client = getSupabaseClient();

    // 1) Conteo para saber cuántas páginas se necesitan.
    const tCountStart = Date.now();
    const { count, error: countError } = await client.from(this.table).select('*', { count: 'exact', head: true });
    console.log(`[PERF] supabase: consulta COUNT = ${Date.now() - tCountStart} ms`);
    if (countError) {
      throw new Error(`Error al contar filas en "${this.table}": ${countError.message}`);
    }

    const total = count ?? 0;
    const pages = Math.ceil(total / this.pageSize);
    console.log(`[PERF] supabase: filas=${total}, paginas/consultas=${pages}, pageSize=${this.pageSize}`);

    // 2) Todas las páginas EN PARALELO (antes eran secuenciales -> ~20s).
    const requests = [];
    for (let page = 0; page < pages; page += 1) {
      const from = page * this.pageSize;
      const to = from + this.pageSize - 1;
      const pageIndex = page + 1;
      const tPageStart = Date.now();
      requests.push(
        client
          .from(this.table)
          .select('*')
          .range(from, to)
          .then((result) => {
            console.log(`[PERF] supabase: pagina ${pageIndex}/${pages} (range ${from}-${to}) = ${Date.now() - tPageStart} ms`);
            return result;
          })
      );
    }

    const results = await Promise.all(requests);

    const all: Record<string, unknown>[] = [];
    for (const { data, error } of results) {
      if (error) {
        throw new Error(`Error al leer la tabla "${this.table}" en Supabase: ${error.message}`);
      }
      if (data) all.push(...(data as Record<string, unknown>[]));
    }

    console.log(`[PERF] supabase: LECTURA TOTAL (count + ${pages} paginas en paralelo) = ${Date.now() - tReadStart} ms`);
    // === FIN INSTRUMENTACIÓN TEMPORAL ===

    this.cache = { rows: all, expires: now + this.cacheTtlMs };
    return all;
  }

  /** Invalida la caché en memoria para forzar una relectura en la próxima petición. */
  clearCache(): void {
    this.cache = null;
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
