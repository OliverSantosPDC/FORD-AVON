import { getSupabaseClient } from '../config/supabaseClient';
import type { AuthScope } from './PerfilService';

/**
 * FASE 3.3.1 — ScopeService (única fuente de verdad del alcance de datos).
 *
 * Resuelve QUÉ países / zonas / gestores puede consultar un usuario autenticado.
 * Esta fase SOLO calcula y prepara el `ScopeContext`; NO lo aplica a ningún
 * endpoint (cartera/dashboard/inteligencia). La aplicación real (`applyScope`)
 * se hará en una fase posterior.
 *
 * Reglas de seguridad (fail-closed):
 *  - Un rol no global sin asignaciones ⇒ scope vacío ⇒ cero datos (nunca "todo").
 *  - Ante un error de consulta NUNCA se concede acceso global: se propaga el error.
 *  - El acceso global temporal vigente activa isGlobal=true sin alterar nada más.
 *
 * Lee con la SERVICE ROLE (igual que PerfilService), por lo que bypassa RLS.
 */

/** Roles con alcance global permanente (según `roles.clave`).
 *  IMPORTANTE (Grupos y Niveles): `liderazgo` YA NO es global. Nivel 2 depende
 *  de sus Supervisores asignados (`liderazgo_supervisor`) — si un liderazgo no
 *  tiene supervisores asignados, su alcance es VACÍO (fail-closed), nunca "todo". */
const GLOBAL_ROLES = ['administrador'] as const;

export interface ScopeContext {
  userId: string;
  role: string;
  permissions: string[];
  isGlobal: boolean;
  /** Nombres (para el puente de texto con `cartera`). */
  scope: AuthScope; // { paises: string[]; zonas: string[]; gestores: string[] }
  /** UUIDs de gestores del alcance (para tablas operativas por id, fase posterior). */
  gestorIds: string[];
  /** UUIDs de zonas del alcance. */
  zonaIds: string[];
}

export interface ResolveScopeInput {
  userId: string;
  /** `roles.clave` del usuario (o null si no tiene rol). */
  roleClave: string | null;
  /** Permisos ya resueltos por la autenticación. */
  permissions: string[];
}

/** Error específico de resolución de scope (para diferenciar en el caller). */
export class ScopeResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeResolutionError';
  }
}

const uniq = (values: Array<string | null | undefined>): string[] =>
  Array.from(new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0)));

/** Fecha del servidor en formato DATE (YYYY-MM-DD, UTC) para comparar vigencias. */
const serverDate = (): string => new Date().toISOString().slice(0, 10);

const emptyScope = (): AuthScope => ({ paises: [], zonas: [], gestores: [] });

const baseContext = (input: ResolveScopeInput): ScopeContext => ({
  userId: input.userId,
  role: input.roleClave ?? '',
  permissions: input.permissions,
  isGlobal: false,
  scope: emptyScope(),
  gestorIds: [],
  zonaIds: []
});

/**
 * ¿El usuario tiene un acceso global temporal VIGENTE?
 * Condiciones: activo = true, fecha_inicio <= hoy, fecha_fin >= hoy.
 * Fail-closed: si la consulta falla, se propaga el error (nunca se asume global).
 */
const hasActiveGlobalAccess = async (userId: string): Promise<boolean> => {
  const today = serverDate();
  const { data, error } = await getSupabaseClient()
    .from('acceso_global_temporal')
    .select('id')
    .eq('usuario_id', userId)
    .eq('activo', true)
    .lte('fecha_inicio', today)
    .gte('fecha_fin', today)
    .limit(1);

  if (error) {
    throw new ScopeResolutionError(`No se pudo verificar el acceso global temporal: ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
};

/** Gestores activos (id + nombre_cartera) dado un conjunto de `gestores.id`. */
const gestoresPorIds = async (gestorIds: string[]): Promise<Array<{ id: string; nombre_cartera: string | null }>> => {
  if (gestorIds.length === 0) return [];
  const { data, error } = await getSupabaseClient()
    .from('gestores')
    .select('id, nombre_cartera')
    .in('id', gestorIds)
    .eq('activo', true);
  if (error) throw new ScopeResolutionError(`No se pudieron leer los gestores: ${error.message}`);
  return (data ?? []) as Array<{ id: string; nombre_cartera: string | null }>;
};

/** País/Zona explícitos (narrowing adicional) de uno o varios `gestores.id`, vigentes. */
const paisZonaDeGestores = async (gestorIds: string[]): Promise<Array<{ pais: string; zona: string }>> => {
  if (gestorIds.length === 0) return [];
  const today = serverDate();
  const client = getSupabaseClient();
  const { data: rel, error: relError } = await client
    .from('gestor_pais_zona')
    .select('zona_id, pais')
    .in('gestor_id', gestorIds)
    .eq('activo', true)
    .lte('fecha_inicio', today)
    .or(`fecha_fin.is.null,fecha_fin.gte.${today}`);
  if (relError) throw new ScopeResolutionError(`No se pudieron leer las zonas asignadas del gestor: ${relError.message}`);
  const rows = (rel ?? []) as Array<{ zona_id: string; pais: string | null }>;
  if (rows.length === 0) return [];

  const zonaIds = uniq(rows.map((r) => r.zona_id));
  const { data: zonas, error: zError } = await client.from('zonas').select('id, nombre').in('id', zonaIds).eq('activo', true);
  if (zError) throw new ScopeResolutionError(`No se pudieron leer las zonas: ${zError.message}`);
  const nombrePorId = new Map(((zonas ?? []) as Array<{ id: string; nombre: string }>).map((z) => [z.id, z.nombre]));

  return rows
    .map((r) => ({ pais: r.pais ?? '', zona: nombrePorId.get(r.zona_id) ?? '' }))
    .filter((p) => p.pais && p.zona);
};

/** Resuelve el scope de un GESTOR: sus propios registros activos en `gestores`,
 *  narrowed opcionalmente por País/Zona explícitos (`gestor_pais_zona`). Si no
 *  tiene País/Zona asignados, el alcance es exactamente el de hoy (por nombre). */
const resolveGestorScope = async (ctx: ScopeContext): Promise<ScopeContext> => {
  const { data, error } = await getSupabaseClient()
    .from('gestores')
    .select('id, nombre_cartera')
    .eq('usuario_id', ctx.userId)
    .eq('activo', true);

  if (error) {
    throw new ScopeResolutionError(`No se pudieron leer los gestores del usuario: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{ id: string; nombre_cartera: string | null }>;
  ctx.gestorIds = uniq(rows.map((r) => r.id));
  ctx.scope.gestores = uniq(rows.map((r) => r.nombre_cartera));
  ctx.scope.paisZonaPairs = await paisZonaDeGestores(ctx.gestorIds);
  return ctx;
};

/**
 * Resuelve el scope de un SUPERVISOR: gestores asignados en `supervisor_gestor`
 * (activos y vigentes) que además estén activos en `gestores`.
 */
const resolveSupervisorScope = async (ctx: ScopeContext): Promise<ScopeContext> => {
  const today = serverDate();
  const client = getSupabaseClient();

  const { data: rel, error: relError } = await client
    .from('supervisor_gestor')
    .select('gestor_id')
    .eq('supervisor_id', ctx.userId)
    .eq('activo', true)
    .lte('fecha_inicio', today)
    .or(`fecha_fin.is.null,fecha_fin.gte.${today}`);

  if (relError) {
    throw new ScopeResolutionError(`No se pudieron leer las asignaciones del supervisor: ${relError.message}`);
  }

  const gestorIds = uniq(((rel ?? []) as Array<{ gestor_id: string | null }>).map((r) => r.gestor_id));
  if (gestorIds.length === 0) {
    // Sin asignaciones vigentes ⇒ scope vacío (NO global).
    return ctx;
  }

  const rows = await gestoresPorIds(gestorIds);
  ctx.gestorIds = uniq(rows.map((r) => r.id));
  ctx.scope.gestores = uniq(rows.map((r) => r.nombre_cartera));
  return ctx;
};

/**
 * Resuelve el scope de un LIDERAZGO (Nivel 2): UNIÓN del alcance de todos sus
 * Supervisores asignados en `liderazgo_supervisor` (activos y vigentes). Sin
 * supervisores asignados ⇒ scope vacío (fail-closed; ya NO es un rol global).
 */
const resolveLiderazgoScope = async (ctx: ScopeContext): Promise<ScopeContext> => {
  const today = serverDate();
  const client = getSupabaseClient();

  const { data: rel, error: relError } = await client
    .from('liderazgo_supervisor')
    .select('supervisor_id')
    .eq('liderazgo_id', ctx.userId)
    .eq('activo', true)
    .lte('fecha_inicio', today)
    .or(`fecha_fin.is.null,fecha_fin.gte.${today}`);

  if (relError) {
    throw new ScopeResolutionError(`No se pudieron leer los supervisores del liderazgo: ${relError.message}`);
  }

  const supervisorIds = uniq(((rel ?? []) as Array<{ supervisor_id: string | null }>).map((r) => r.supervisor_id));
  if (supervisorIds.length === 0) {
    return ctx; // Sin supervisores vigentes ⇒ scope vacío (NO global).
  }

  const { data: relGestores, error: gRelError } = await client
    .from('supervisor_gestor')
    .select('gestor_id')
    .in('supervisor_id', supervisorIds)
    .eq('activo', true)
    .lte('fecha_inicio', today)
    .or(`fecha_fin.is.null,fecha_fin.gte.${today}`);
  if (gRelError) {
    throw new ScopeResolutionError(`No se pudieron leer los gestores de los supervisores del liderazgo: ${gRelError.message}`);
  }

  const gestorIds = uniq(((relGestores ?? []) as Array<{ gestor_id: string | null }>).map((r) => r.gestor_id));
  const rows = await gestoresPorIds(gestorIds);
  ctx.gestorIds = uniq(rows.map((r) => r.id));
  ctx.scope.gestores = uniq(rows.map((r) => r.nombre_cartera));
  return ctx;
};

/**
 * Resuelve el scope de un GERENTE DE ZONA: País/Zona asignados en
 * `gerente_zona_zona` (activos y vigentes, con `pais` explícito — una misma
 * zona/código puede repetirse entre países en `cartera`, por lo que zona sola
 * es ambigua). `scope.zonas`/`scope.paises` quedan como superset (para activar
 * las dimensiones base de `applyScope`); `paisZonaPairs` exige la combinación
 * EXACTA.
 */
const resolveGerenteZonaScope = async (ctx: ScopeContext): Promise<ScopeContext> => {
  const today = serverDate();
  const client = getSupabaseClient();

  const { data: rel, error: relError } = await client
    .from('gerente_zona_zona')
    .select('zona_id, pais')
    .eq('usuario_id', ctx.userId)
    .eq('activo', true)
    .lte('fecha_inicio', today)
    .or(`fecha_fin.is.null,fecha_fin.gte.${today}`);

  if (relError) {
    throw new ScopeResolutionError(`No se pudieron leer las asignaciones del gerente de zona: ${relError.message}`);
  }

  const relRows = (rel ?? []) as Array<{ zona_id: string | null; pais: string | null }>;
  const zonaIds = uniq(relRows.map((r) => r.zona_id));
  if (zonaIds.length === 0) {
    return ctx; // Sin zonas vigentes ⇒ scope vacío (NO global).
  }

  const { data: zonas, error: zError } = await client
    .from('zonas')
    .select('id, nombre')
    .in('id', zonaIds)
    .eq('activo', true);

  if (zError) {
    throw new ScopeResolutionError(`No se pudieron leer las zonas del gerente: ${zError.message}`);
  }

  const nombrePorId = new Map(((zonas ?? []) as Array<{ id: string; nombre: string }>).map((z) => [z.id, z.nombre]));
  ctx.zonaIds = uniq(Array.from(nombrePorId.keys()));
  ctx.scope.zonas = uniq(Array.from(nombrePorId.values()));
  ctx.scope.paises = uniq(relRows.map((r) => r.pais));
  ctx.scope.paisZonaPairs = relRows
    .map((r) => ({ pais: r.pais ?? '', zona: nombrePorId.get(r.zona_id ?? '') ?? '' }))
    .filter((p) => p.pais && p.zona);
  return ctx;
};

/**
 * Punto de entrada único: calcula el `ScopeContext` del usuario.
 *
 * Orden de resolución:
 *  1) Rol global (administrador) ⇒ isGlobal=true.
 *  2) Acceso global temporal vigente ⇒ isGlobal=true (sin alterar el scope normal).
 *  3) Scope por rol: gestor | supervisor | liderazgo | gerente_zona.
 *  4) Cualquier otro rol ⇒ isGlobal=false y scope vacío.
 *
 * PAÍSES: se poblan cuando el rol tiene País/Zona explícitos asignados
 * (gerente_zona vía `gerente_zona_zona.pais`); para gestor/supervisor/liderazgo
 * el alcance sigue siendo por nombre de gestor (con narrowing opcional de
 * País/Zona para gestor vía `gestor_pais_zona`).
 */
export const resolveScopeContext = async (input: ResolveScopeInput): Promise<ScopeContext> => {
  const ctx = baseContext(input);
  const role = ctx.role;

  // 1) Roles globales permanentes.
  if ((GLOBAL_ROLES as readonly string[]).includes(role)) {
    ctx.isGlobal = true;
    return ctx;
  }

  // 2) Acceso global temporal vigente (para cualquier rol no global).
  if (await hasActiveGlobalAccess(ctx.userId)) {
    ctx.isGlobal = true;
    return ctx;
  }

  // 3) Scope por rol.
  switch (role) {
    case 'gestor':
      return resolveGestorScope(ctx);
    case 'supervisor':
      return resolveSupervisorScope(ctx);
    case 'liderazgo':
      return resolveLiderazgoScope(ctx);
    case 'gerente_zona':
      return resolveGerenteZonaScope(ctx);
    default:
      // 4) Rol no contemplado: sin acceso global, scope vacío.
      return ctx;
  }
};
