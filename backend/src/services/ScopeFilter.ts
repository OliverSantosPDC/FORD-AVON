import type { ScopeContext } from './ScopeService';

/**
 * FASE 3.3.3 — applyScope: capa central de AUTORIZACIÓN de datos.
 *
 * Aplica el `ScopeContext` (resuelto por ScopeService y transportado en
 * `req.auth.scopeContext`) sobre un conjunto de filas. Es una FRONTERA DE
 * SEGURIDAD: los filtros del usuario nunca deben ampliar el alcance.
 *
 * El único origen válido del alcance es `context` (derivado del token en el
 * backend). Nunca se confía en gestor/zona/país/ids enviados por el frontend.
 *
 * Esta fase SOLO crea la herramienta; NO se conecta a ningún endpoint.
 *
 * Secuencia prevista (fase posterior):
 *   datos → applyScope (seguridad) → filtros del usuario → KPIs → responder.
 * Nunca: filtros del usuario → scope.
 */

/**
 * Normalización segura para el "puente de texto" entre `cartera.gestor|zona`
 * y `gestores.nombre_cartera` / `zonas.nombre`.
 * - Convierte a string, recorta espacios y pasa a minúsculas.
 * - NO elimina acentos (evita colisiones entre nombres distintos).
 *   " Juan Pérez " y "JUAN PÉREZ" ⇒ "juan pérez" (equivalentes).
 */
export const normalizeScopeValue = (value: unknown): string =>
  (value === null || value === undefined ? '' : String(value)).trim().toLowerCase();

/** Construye un Set normalizado, descartando vacíos. */
const toNormalizedSet = (values: string[]): Set<string> => {
  const set = new Set<string>();
  for (const value of values) {
    const normalized = normalizeScopeValue(value);
    if (normalized) set.add(normalized);
  }
  return set;
};

/** Qué campo de la fila representa cada dimensión de scope (según la tabla). */
export interface ApplyScopeOptions<T> {
  gestorField?: keyof T;
  zonaField?: keyof T;
  paisField?: keyof T;
}

/** Dimensión activa: campo de la fila + valores permitidos (normalizados). */
interface ActiveDimension<T> {
  field: keyof T;
  allowed: Set<string>;
}

/**
 * ¿El scope es vacío para un usuario NO global?
 * (Ninguna de las tres listas de alcance tiene valores.)
 */
export const isScopeEmpty = (context: ScopeContext): boolean =>
  context.scope.gestores.length === 0 &&
  context.scope.zonas.length === 0 &&
  context.scope.paises.length === 0;

/**
 * Aplica el alcance de seguridad sobre `rows`.
 *
 * Reglas:
 *  1) `isGlobal === true` (administrador, liderazgo, acceso global temporal
 *     vigente) ⇒ passthrough: devuelve todas las filas SIN filtro de seguridad.
 *     Los filtros de búsqueda del usuario se aplican después, por separado.
 *  2) No global ⇒ una fila se conserva solo si coincide con AL MENOS UNA
 *     dimensión de scope activa (gestor/zona/país). Con el modelo actual, cada
 *     rol puebla una sola dimensión (gestor/supervisor → gestores;
 *     gerente_zona → zonas), por lo que el filtro equivale al de su rol.
 *  3) No global con scope VACÍO (sin dimensiones activas) ⇒ CERO filas.
 *     Nunca se hace fallback a "todos".
 *
 * Una "dimensión activa" requiere: que el caller indique el campo de esa
 * dimensión (options) Y que la lista de scope correspondiente tenga valores.
 * Si no se indica el campo, esa dimensión no autoriza nada (fail-closed).
 */
export const applyScope = <T>(rows: T[], context: ScopeContext, options: ApplyScopeOptions<T>): T[] => {
  // 1) Usuarios globales: sin filtro de seguridad.
  if (context.isGlobal) return rows;

  // 2) Determinar dimensiones activas (campo indicado + lista de scope no vacía).
  const dimensions: ActiveDimension<T>[] = [];
  if (options.gestorField && context.scope.gestores.length > 0) {
    dimensions.push({ field: options.gestorField, allowed: toNormalizedSet(context.scope.gestores) });
  }
  if (options.zonaField && context.scope.zonas.length > 0) {
    dimensions.push({ field: options.zonaField, allowed: toNormalizedSet(context.scope.zonas) });
  }
  if (options.paisField && context.scope.paises.length > 0) {
    dimensions.push({ field: options.paisField, allowed: toNormalizedSet(context.scope.paises) });
  }

  // 3) Scope vacío (sin dimensiones activas) ⇒ CERO filas. Nunca "todos".
  if (dimensions.length === 0) return [];

  // 4) Conservar la fila si coincide con al menos una dimensión activa.
  return rows.filter((row) =>
    dimensions.some((dimension) => dimension.allowed.has(normalizeScopeValue(row[dimension.field])))
  );
};
