import { MONEDA_POR_PAIS } from '../services/gestionService';

/**
 * CORRECCIÓN DE CONVERSIÓN MONETARIA (auditoría FORD-AVON): fuente ÚNICA y
 * centralizada para convertir un saldo LOCAL real (`saldo_actual`/
 * `saldo_inicial`, siempre la fuente de verdad) a su equivalente en USD, y de
 * ahí a cualquier moneda de visualización — reutilizada por cada componente
 * que hoy leía `saldo_actual_usd`/`saldo_inicial_usd` directamente de una fila
 * cruda de cartera (columnas OBSOLETAS como fuente: se congelan con la tasa
 * vigente al importar y nunca reflejan cambios posteriores de
 * config_tasas_conversion).
 *
 * Misma convención que el backend (ver usdEquivalente en
 * backend/src/utils/carteraAggregations.ts) y que `useTasasConversion`: la
 * tasa de `config_tasas_conversion` es "unidades de moneda local por 1 USD"
 * (ej. GTQ tasa=7.644720 ⇒ 1 USD = 7.644720 GTQ), así que
 * usdEquivalente = local / tasa, y para mostrar en otra moneda:
 * convertido = usdEquivalente × tasa_destino.
 */

/** Resuelve la moneda LOCAL real de un país (mismo mapa que MONEDA_POR_PAIS
 *  de gestionService.ts, tolerante a mayúsculas/acentos como el resto del
 *  dashboard). 'USD' si el país no se reconoce (nunca divide por una tasa
 *  inexistente). */
export const monedaDePais = (paisRaw: unknown): string => {
  const pais = String(paisRaw ?? '').trim().toUpperCase();
  return MONEDA_POR_PAIS[pais] ?? 'USD';
};

/**
 * Equivalente en USD de un saldo LOCAL, dividiendo entre la tasa vigente de
 * la moneda del país. Sin tasa válida (ausente, cero o negativa) conserva el
 * valor local sin dividir — nunca corrompe el dato ni asume 1 en silencio.
 */
export const usdEquivalente = (local: number, paisRaw: unknown, tasas: Record<string, number>): number => {
  const moneda = monedaDePais(paisRaw);
  if (moneda === 'USD') return local;
  const tasa = tasas[moneda];
  if (!tasa || !Number.isFinite(tasa) || tasa <= 0) return local;
  return local / tasa;
};

/**
 * Convierte un saldo LOCAL a la moneda de visualización elegida por el
 * usuario (`monedaDestino`, código ISO o 'USD'). Nunca parte de una columna
 * `_usd` precomputada — siempre deriva del saldo local real.
 */
export const convertirMoneda = (
  local: number,
  paisRaw: unknown,
  monedaDestino: string,
  tasas: Record<string, number>
): number => {
  const usd = usdEquivalente(local, paisRaw, tasas);
  if (monedaDestino === 'USD') return usd;
  const tasaDestino = tasas[monedaDestino];
  if (!tasaDestino || !Number.isFinite(tasaDestino) || tasaDestino <= 0) return usd;
  return usd * tasaDestino;
};
