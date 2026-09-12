import { getSupabaseClient } from '../config/supabaseClient';
import { ConfigError } from './ConfigService';

const c = () => getSupabaseClient();

/** Fila fija que representa la ÚNICA configuración global vigente de meta. No es un
 *  período calendario: es un sentinela para reutilizar el índice único ya existente
 *  de la tabla `metas` (ambito, clave, periodo) y garantizar una sola fila. */
const AMBITO = 'GLOBAL';
const PERIODO = 'GLOBAL';

export type MetaTipo = 'PORCENTAJE' | 'MONTO';

interface MetaRow {
  id: string;
  tipo: MetaTipo;
  porcentaje_meta: number | null;
  monto_meta: number;
  updated_at: string | null;
  updated_by: string | null;
  created_at: string | null;
}

export interface MetaGlobalComputada {
  definida: boolean;
  tipo: MetaTipo | null;
  /** Meta % (fracción, ej. 0.9371) sobre el TOTAL global de cartera (SUM(saldo_inicial_usd), sin scope). */
  porcentaje: number | null;
  /** Meta MONTO USD correspondiente al total GLOBAL (no al universo scoped/filtrado). */
  montoUsdGlobal: number | null;
  /** SUM(cartera.saldo_inicial_usd) sin scope ni filtros: el total real de negocio. */
  totalSaldoInicialUsd: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Total real de negocio: SUM(cartera.saldo_inicial_usd) de TODA la cartera, sin
 *  scope ni filtros. La meta global es un objetivo de negocio único; su % debe
 *  calcularse siempre contra el universo completo, no contra lo que un usuario
 *  puntual esté autorizado a ver. Se recalcula en cada lectura (nunca se cachea
 *  un valor congelado) para que un reimport de cartera se refleje de inmediato. */
export const getTotalSaldoInicialGlobalUsd = async (): Promise<number> => {
  const { data, error } = await c().from('cartera').select('saldo_inicial_usd').limit(200000);
  if (error) throw new ConfigError(error.message);
  return ((data ?? []) as Array<{ saldo_inicial_usd: number | string | null }>).reduce(
    (sum, r) => sum + (Number(r.saldo_inicial_usd) || 0),
    0
  );
};

const getMetaGlobalRaw = async (): Promise<MetaRow | null> => {
  const { data, error } = await c()
    .from('metas')
    .select('id, tipo, porcentaje_meta, monto_meta, updated_at, updated_by, created_at')
    .eq('ambito', AMBITO)
    .eq('periodo', PERIODO)
    .is('clave', null)
    .maybeSingle();
  if (error) throw new ConfigError(error.message);
  return (data as MetaRow | null) ?? null;
};

/** Meta global calculada: SOLO uno de los dos valores (% o monto) es la fuente
 *  configurada (según `tipo`); el otro se deriva SIEMPRE contra el total actual
 *  de cartera (nunca un valor congelado al momento de guardar). Ver requerimiento:
 *  "META % = META MONTO / TOTAL SALDO INICIAL" y su inversa. */
export const getMetaGlobalComputada = async (): Promise<MetaGlobalComputada> => {
  const [row, totalSaldoInicialUsd] = await Promise.all([getMetaGlobalRaw(), getTotalSaldoInicialGlobalUsd()]);
  if (!row) {
    return { definida: false, tipo: null, porcentaje: null, montoUsdGlobal: null, totalSaldoInicialUsd, updatedAt: null, updatedBy: null };
  }
  const safeDiv = (a: number, b: number) => (b > 0 ? a / b : 0);
  const porcentaje = row.tipo === 'PORCENTAJE' ? Number(row.porcentaje_meta) : safeDiv(Number(row.monto_meta), totalSaldoInicialUsd);
  const montoUsdGlobal = row.tipo === 'MONTO' ? Number(row.monto_meta) : totalSaldoInicialUsd * porcentaje;
  return {
    definida: true,
    tipo: row.tipo,
    porcentaje: Number.isFinite(porcentaje) ? porcentaje : 0,
    montoUsdGlobal: Number.isFinite(montoUsdGlobal) ? montoUsdGlobal : 0,
    totalSaldoInicialUsd,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by
  };
};

/** Guarda la ÚNICA configuración global. `tipo` decide cuál de los dos valores es
 *  la fuente editable; el otro se recalcula (nunca ambos quedan como fuentes
 *  independientes: eso violaría la regla "solo una puede ser la fuente activa"). */
export const guardarMetaGlobal = async (
  b: { tipo?: unknown; porcentaje?: unknown; montoUsd?: unknown },
  actor: string | null
): Promise<void> => {
  const tipo = b.tipo === 'PORCENTAJE' || b.tipo === 'MONTO' ? b.tipo : null;
  if (!tipo) throw new ConfigError('El tipo de meta debe ser PORCENTAJE o MONTO.');

  const totalSaldoInicialUsd = await getTotalSaldoInicialGlobalUsd();

  let porcentajeMeta: number | null = null;
  let montoMeta: number;
  if (tipo === 'PORCENTAJE') {
    const pct = Number(b.porcentaje);
    if (!Number.isFinite(pct) || pct <= 0) throw new ConfigError('La meta % debe ser un número mayor que 0.');
    porcentajeMeta = pct;
    montoMeta = totalSaldoInicialUsd * pct; // valor informativo (auditoría); se recalcula igual en cada lectura
  } else {
    const monto = Number(b.montoUsd);
    if (!Number.isFinite(monto) || monto <= 0) throw new ConfigError('La meta MONTO debe ser un número mayor que 0.');
    montoMeta = monto;
    porcentajeMeta = totalSaldoInicialUsd > 0 ? monto / totalSaldoInicialUsd : 0; // informativo
  }

  // El índice único existente (ambito, coalesce(clave,''), periodo) usa una
  // expresión: PostgREST no puede usarlo como destino de ON CONFLICT directo, así
  // que se resuelve con lectura previa + update/insert (en vez de upsert), lo que
  // además evita tocar el índice existente.
  const existing = await getMetaGlobalRaw();
  const patch = {
    tipo,
    porcentaje_meta: porcentajeMeta,
    monto_meta: montoMeta,
    moneda: 'USD',
    activo: true,
    updated_at: new Date().toISOString(),
    updated_by: actor
  };
  if (existing) {
    const { error } = await c().from('metas').update(patch).eq('id', existing.id);
    if (error) throw new ConfigError(error.message);
  } else {
    const { error } = await c()
      .from('metas')
      .insert({ ambito: AMBITO, clave: null, periodo: PERIODO, created_by: actor, ...patch });
    if (error) throw new ConfigError(error.message);
  }
};
