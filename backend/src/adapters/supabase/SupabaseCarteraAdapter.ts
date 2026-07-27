import { getSupabaseClient } from '../../config/supabaseClient';
import { SUPABASE_CARTERA_TABLE } from '../../config/env';
import { CarteraDataSource } from '../../repositories/CarteraRepository';

/**
 * Adaptador de lectura de la cartera desde Supabase PostgreSQL.
 * Implementa la misma interfaz que el adaptador de Excel para que el resto
 * de la arquitectura (repositorio, servicio, controladores) no cambie.
 */
/**
 * Sólo las columnas que el dashboard y sus agregaciones realmente usan.
 * Evita traer campos pesados no usados (teléfonos, referencias, direcciones),
 * reduciendo ~50% el tamaño de la lectura, la memoria y el tiempo de respuesta.
 */
const DASHBOARD_COLUMNS = [
  'codigo',
  'pais',
  'campania_adeuda',
  'nombre',
  'zona',
  'sector',
  'saldo_inicial',
  'saldo_actual',
  'saldo_inicial_usd',
  'saldo_actual_usd',
  'pd_actual',
  'gestor',
  'gerente_zona'
].join(',');

export class SupabaseCarteraAdapter implements CarteraDataSource {
  private readonly table: string;
  private readonly pageSize = 1000; // Supabase limita cada respuesta a 1000 filas.
  // La cartera sólo cambia al importar (y ahí se invalida la caché), así que un
  // TTL más largo hace instantáneas las cargas repetidas del dashboard.
  private readonly cacheTtlMs = 5 * 60_000;

  // Caché en memoria compartida entre peticiones (el adaptador es singleton).
  private cache: { rows: Record<string, unknown>[]; expires: number } | null = null;

  constructor(table: string = SUPABASE_CARTERA_TABLE) {
    this.table = table;
  }

  async getCartera(): Promise<Record<string, unknown>[]> {
    const now = Date.now();
    if (this.cache && this.cache.expires > now) {
      return this.cache.rows;
    }

    const client = getSupabaseClient();

    // 1) Conteo para saber cuántas páginas se necesitan.
    const { count, error: countError } = await client.from(this.table).select('*', { count: 'exact', head: true });
    if (countError) {
      throw new Error(`Error al contar filas en "${this.table}": ${countError.message}`);
    }

    const total = count ?? 0;
    const pages = Math.ceil(total / this.pageSize);

    // 2) Todas las páginas EN PARALELO, con proyección de columnas.
    const requests = [];
    for (let page = 0; page < pages; page += 1) {
      const from = page * this.pageSize;
      const to = from + this.pageSize - 1;
      requests.push(client.from(this.table).select(DASHBOARD_COLUMNS).range(from, to));
    }

    const results = await Promise.all(requests);

    const all: Record<string, unknown>[] = [];
    for (const { data, error } of results) {
      if (error) {
        throw new Error(`Error al leer la tabla "${this.table}" en Supabase: ${error.message}`);
      }
      if (data) all.push(...(data as unknown as Record<string, unknown>[]));
    }

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
