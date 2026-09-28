/**
 * CORRECCIÓN DE FORMATO NUMÉRICO (auditoría FORD-AVON): fuente ÚNICA de
 * formato para todo el frontend — convención anglosajona SIEMPRE (coma =
 * miles, punto = decimales), nunca `'es'` (produce el patrón inverso: punto
 * de miles, coma decimal) ni el locale del navegador (`undefined`/sin
 * argumento), que puede variar por usuario/máquina y produce un formato
 * impredecible. Ejemplos: 1,021.89 · 15,483.25 · 1,250,000.00.
 */

/** Monto/cantidad con decimales fijos (por defecto 2). `null`/`undefined`/no-finito ⇒ '—'. */
export const formatMoney = (value: number | null | undefined, decimals = 2): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

/** Entero (conteos: cuentas, filas, etc.), sin decimales. */
export const formatInt = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString('en-US');
};

/** Porcentaje con decimales fijos (por defecto 2), incluye el símbolo `%`. */
export const formatPercent = (value: number | null | undefined, decimals = 2): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
};
