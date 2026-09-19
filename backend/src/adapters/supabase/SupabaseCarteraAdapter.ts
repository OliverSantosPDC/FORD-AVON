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
  'pd_inicial',
  'pd_actual'
  // `gestor`/`gerente_zona` NUNCA se leen de cartera: la identidad real se
  // resuelve exclusivamente vía gestor_pais_zona/gerente_zona_zona
  // (CarteraService.overlayIdentidadReal, sobrescribe estos campos en cada
  // fila después de leerla) — ver la auditoría en carteraAggregations.ts.
].join(',');

export class SupabaseCarteraAdapter implements CarteraDataSource {
  private readonly table: string;
  private readonly pageSize = 1000; // Supabase limita cada respuesta a 1000 filas.
  private readonly cacheTtlMs = 5 * 60_000;

  private cache: { rows: Record<string, unknown>[]; expires: number } | null = null;

  // Single-flight: si N requests llegan concurrentemente mientras el cache
  // está vencido/vacío, sólo la primera dispara la carga real a Supabase; las
  // demás reusan esta MISMA promesa en vez de repetir el count() + N
  // requests paginados en paralelo (evita "cache stampede").
  private inFlight: Promise<Record<string, unknown>[]> | null = null;

  constructor(table: string = SUPABASE_CARTERA_TABLE) {
    this.table = table;
  }

  async getCartera(): Promise<Record<string, unknown>[]> {
    const now = Date.now();
    if (this.cache && this.cache.expires > now) {
      console.log(`[PERF] cartera cache HIT, filas=${this.cache.rows.length}`);
      return this.cache.rows;
    }

    if (this.inFlight) {
      console.log('[PERF] cartera cache MISS, single-flight: esperando carga en curso');
      return this.inFlight;
    }

    console.log('[PERF] cartera cache MISS, iniciando carga desde Supabase');
    const tLoad = Date.now();
    this.inFlight = this.loadFromSupabase()
      .then((rows) => {
        this.cache = { rows, expires: Date.now() + this.cacheTtlMs };
        console.log(`[PERF] cartera cache MISS resuelto = ${Date.now() - tLoad} ms, filas=${rows.length}`);
        return rows;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  private async loadFromSupabase(): Promise<Record<string, unknown>[]> {
    const client = getSupabaseClient();
    const { count, error: countError } = await client.from(this.table).select('*', { count: 'exact', head: true });
    if (countError) {
      throw new Error(`Error al contar filas en \"${this.table}\": ${countError.message}`);
    }

    const total = count ?? 0;
    const pages = Math.ceil(total / this.pageSize);
    const requests = [];
    for (let page = 0; page < pages; page += 1) {
      const from = page * this.pageSize;
      const to = from + this.pageSize - 1;
      // CRÍTICO: `.order('id')` es obligatorio en una paginación por `range()`.
      // Sin un orden explícito, PostgREST/Postgres NO garantiza qué filas caen
      // en cada página — especialmente al lanzar todas las páginas en paralelo
      // (Promise.all): sin orden, cada request puede recibir un plan de
      // ejecución distinto, causando que algunas filas se OMITAN (nunca
      // aparecen en ninguna página) o se DUPLIQUEN, de forma no determinística
      // entre cargas. Ordenar por `id` (identity PK, estable) hace que cada
      // rango de `range()` sea un slice determinista del mismo orden total.
      requests.push(client.from(this.table).select(DASHBOARD_COLUMNS).order('id', { ascending: true }).range(from, to));
    }

    const results = await Promise.all(requests);
    const all: Record<string, unknown>[] = [];
    for (const { data, error } of results) {
      if (error) {
        throw new Error(`Error al leer la tabla \"${this.table}\" en Supabase: ${error.message}`);
      }
      if (data) all.push(...(data as unknown as Record<string, unknown>[]));
    }

    return all;
  }

  clearCache(): void {
    this.cache = null;
    this.inFlight = null;
  }

  async count(): Promise<number> {
    const client = getSupabaseClient();
    const { count, error } = await client.from(this.table).select('*', { count: 'exact', head: true });
    if (error) {
      throw new Error(`Error al contar filas en \"${this.table}\": ${error.message}`);
    }
    return count ?? 0;
  }
}
