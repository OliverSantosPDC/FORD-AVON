import { getSupabaseClient } from '../config/supabaseClient';
import { SUPABASE_CARTERA_TABLE } from '../config/env';
import { registrarAuditoria } from './AuditoriaService';
import { generarPasswordTemporal, PASSWORD_TEMPORAL_ADMINISTRATIVA, DIAS_VIGENCIA_PASSWORD_TEMPORAL_ADMINISTRATIVA } from '../utils/password';
import { describirErrorAuth, esUsuarioAuthInexistente } from '../utils/authErrors';
import type { FilaImportUsuario, ParsedWorkbookUsuarios } from '../utils/usuariosImportExcel';

/**
 * FASE 1 — Módulo Usuarios (administración global).
 *
 * Reutiliza el modelo de identidad existente (profiles/roles) y las relaciones de
 * alcance (gestores/supervisor_gestor/gerente_zona_zona) SIN crear un sistema
 * paralelo de auth/permisos/scope. La creación se hace por invitación de correo
 * con la Admin API de Supabase (service role); nunca se generan contraseñas.
 *
 * Fuente de verdad de personas: USUARIOS + roles/niveles/relaciones (Grupos y
 * Niveles) en Supabase — NUNCA `cartera`. `nombre_cartera` (rol gestor) se
 * guarda tal como llega del formulario/Excel, exista o no ese nombre en
 * `cartera.gestor`: `cartera` es solo dato operativo (saldos, distribución),
 * no un catálogo de qué Gestor/Gerente de zona es válido. La visibilidad real
 * de cartera de cada usuario la resuelve ScopeService a partir de sus propias
 * relaciones (supervisor_gestor, gestor_pais_zona, gerente_zona_zona, etc.),
 * aplicadas después sobre `cartera` — nunca al revés.
 */

export interface RoleRef {
  clave: string;
  nombre: string;
  /** Nivel oficial de Grupos y Niveles (1=Administrador ... 5=Gerente de zona). */
  nivel: number | null;
}

export interface UsuarioListItem {
  id: string;
  nombre: string;
  apellido: string | null;
  email: string;
  activo: boolean;
  roleId: string | null;
  role: RoleRef | null;
}

export interface PaisZona { zonaId: string; zona: string; pais: string; }
/** País/Zona de un Gerente de zona, con su División organizacional (hoja
 *  Comercial de la plantilla de usuarios). Metadata de asignación — nunca
 *  participa en el cálculo de alcance de ScopeService (exclusivamente
 *  País/Zona vía `paisZonaGrant`). */
export interface GerenteZonaAsignacion extends PaisZona { division: string | null; }

export interface UsuarioDetalle extends UsuarioListItem {
  /** Para rol gestor: su nombre_cartera (puente con cartera.gestor). */
  nombreCartera: string | null;
  /** Para rol supervisor: ids de gestores.id supervisados (Nivel 3 -> Nivel 4). */
  gestorIds: string[];
  /** Para rol supervisor: ids de profiles.id (gerentes de zona) supervisados (Nivel 3 -> Nivel 5). */
  gerenteZonaIds: string[];
  /** Para rol liderazgo: ids de profiles.id (supervisores) asignados (Nivel 2 -> Nivel 3). */
  supervisorIds: string[];
  /** Para rol gerente_zona: ids de zonas.id asignadas (compat). */
  zonaIds: string[];
  /** Para rol gerente_zona: País/División/Zona explícitos. */
  paisZona: GerenteZonaAsignacion[];
  /** Para rol gestor: País/Zona explícitos, narrowing ADICIONAL opcional. */
  gestorPaisZona: PaisZona[];
}

export interface Catalogos {
  roles: Array<{ id: string; clave: string; nombre: string; nivel: number | null }>;
  zonas: Array<{ id: string; nombre: string; codigo: string | null }>;
  gestores: Array<{ id: string; nombreCartera: string | null; usuarioId: string | null }>;
  /** Perfiles con rol supervisor (activos), para asignar Liderazgo -> Supervisor. */
  supervisores: Array<{ id: string; nombre: string; apellido: string | null }>;
  /** Perfiles con rol gerente_zona (activos), para asignar Supervisor -> Gerente de zona. */
  gerentesZona: Array<{ id: string; nombre: string; apellido: string | null }>;
  /** Pares País/Zona REALES existentes en cartera (nunca inventados), con su zonas.id. */
  carteraPaisZona: PaisZona[];
  /** Combinaciones País/División/Zona YA asignadas a algún Gerente de zona
   *  (nunca inventadas): catálogo base del selector de asignación. */
  gerenteZonaPaisDivisionZona: GerenteZonaAsignacion[];
}

export interface CrearUsuarioInput {
  email: string;
  nombre: string;
  apellido?: string | null;
  roleId: string;
  activo?: boolean;
  /** Contraseña inicial definida por el administrador. Si se omite, se genera una temporal. */
  password?: string;
  // NOTA: nombreCartera se conserva por compatibilidad de firma pero la gestión de
  // Usuarios ya NO lo define directamente; el gestor efectivo día a día sigue siendo
  // semimanual (módulo Asignación → tabla asignaciones → gestor efectivo en
  // CarteraService). gestorIds/supervisorIds/zonaIds/paisZona/gestorPaisZona SÍ son
  // la fuente de autorización (roles + relaciones / ScopeService) y se usan de lleno.
  nombreCartera?: string | null;
  /** Supervisor -> Gestores asignados. */
  gestorIds?: string[];
  /** Supervisor -> Gerentes de zona asignados (Nivel 3 -> Nivel 5). */
  gerenteZonaIds?: string[];
  /** Liderazgo -> Supervisores asignados. */
  supervisorIds?: string[];
  /** Gerente de zona -> zonas (compat; se ignora si viene `paisZona`). */
  zonaIds?: string[];
  /** Gerente de zona -> País/División/Zona explícitos (autoritativo). */
  paisZona?: Array<{ zonaId: string; pais: string; division?: string | null }>;
  /** Gestor -> País/Zona explícitos (narrowing adicional opcional). */
  gestorPaisZona?: Array<{ zonaId: string; pais: string }>;
}

/** Longitud mínima segura para contraseñas definidas por administrador. */
export const MIN_PASSWORD_LEN = 8;

export type ActualizarUsuarioInput = Partial<Omit<CrearUsuarioInput, 'email'>>;

export class UsuariosError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsuariosError';
  }
}

const hoy = (): string => new Date().toISOString().slice(0, 10);
const uniq = (values: string[]): string[] => Array.from(new Set(values.filter((v) => v.length > 0)));
/** Normaliza un correo para comparación/deduplicación (trim + minúsculas). Usado
 *  tanto por `buscarPerfilPorEmail` como por la importación masiva (Sección 3). */
const normEmail = (email: string): string => email.trim().toLowerCase();

const roleRefOf = (roles: unknown): RoleRef | null => {
  const r = Array.isArray(roles) ? roles[0] : roles;
  const rr = r as { clave?: string; nombre?: string; nivel?: number | null } | null;
  return rr && rr.clave ? { clave: rr.clave, nombre: rr.nombre ?? rr.clave, nivel: rr.nivel ?? null } : null;
};

/** Devuelve la clave del rol dado su id (para saber qué relación poblar). */
const claveDeRol = async (roleId: string): Promise<string | null> => {
  const { data, error } = await getSupabaseClient().from('roles').select('clave').eq('id', roleId).single();
  if (error) throw new UsuariosError(`No se pudo leer el rol: ${error.message}`);
  return (data as { clave?: string } | null)?.clave ?? null;
};

export const listarUsuarios = async (): Promise<UsuarioListItem[]> => {
  const { data, error } = await getSupabaseClient()
    .from('profiles')
    .select('id, nombre, apellido, email, activo, role_id, roles ( clave, nombre, nivel )')
    .order('nombre', { ascending: true });

  if (error) throw new UsuariosError(`No se pudieron listar los usuarios: ${error.message}`);

  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((p) => ({
    id: String(p.id),
    nombre: String(p.nombre ?? ''),
    apellido: (p.apellido as string | null) ?? null,
    email: String(p.email ?? ''),
    activo: Boolean(p.activo),
    roleId: (p.role_id as string | null) ?? null,
    role: roleRefOf(p.roles)
  }));
};

export const obtenerUsuario = async (id: string): Promise<UsuarioDetalle | null> => {
  const client = getSupabaseClient();

  const { data: p, error } = await client
    .from('profiles')
    .select('id, nombre, apellido, email, activo, role_id, roles ( clave, nombre, nivel )')
    .eq('id', id)
    .single();
  if (error || !p) return null;

  const base: UsuarioListItem = {
    id: String((p as Record<string, unknown>).id),
    nombre: String((p as Record<string, unknown>).nombre ?? ''),
    apellido: ((p as Record<string, unknown>).apellido as string | null) ?? null,
    email: String((p as Record<string, unknown>).email ?? ''),
    activo: Boolean((p as Record<string, unknown>).activo),
    roleId: ((p as Record<string, unknown>).role_id as string | null) ?? null,
    role: roleRefOf((p as Record<string, unknown>).roles)
  };

  const { data: gestorRow } = await client.from('gestores').select('id, nombre_cartera').eq('usuario_id', id).eq('activo', true).limit(1);
  const gestorId = ((gestorRow ?? [])[0] as { id?: string } | undefined)?.id ?? null;
  const { data: supRows } = await client.from('supervisor_gestor').select('gestor_id').eq('supervisor_id', id).eq('activo', true);
  const { data: supGerRows } = await client.from('supervisor_gerente_zona').select('gerente_zona_id').eq('supervisor_id', id).eq('activo', true);
  const { data: liderRows } = await client.from('liderazgo_supervisor').select('supervisor_id').eq('liderazgo_id', id).eq('activo', true);
  const { data: gerRows } = await client.from('gerente_zona_zona').select('zona_id, pais, division, zonas ( nombre )').eq('usuario_id', id).eq('activo', true);
  const { data: gestorZonaRows } = gestorId
    ? await client.from('gestor_pais_zona').select('zona_id, pais, zonas ( nombre )').eq('gestor_id', gestorId).eq('activo', true)
    : { data: [] as unknown[] };

  const paisZonaDe = (rows: unknown[]): PaisZona[] =>
    (rows as Array<{ zona_id: string; pais: string | null; zonas: { nombre?: string } | { nombre?: string }[] | null }>).map((r) => {
      const z = Array.isArray(r.zonas) ? r.zonas[0] : r.zonas;
      return { zonaId: r.zona_id, zona: z?.nombre ?? '', pais: r.pais ?? '' };
    });
  const gerenteZonaAsignacionesDe = (rows: unknown[]): GerenteZonaAsignacion[] =>
    (rows as Array<{ zona_id: string; pais: string | null; division: string | null; zonas: { nombre?: string } | { nombre?: string }[] | null }>).map((r) => {
      const z = Array.isArray(r.zonas) ? r.zonas[0] : r.zonas;
      return { zonaId: r.zona_id, zona: z?.nombre ?? '', pais: r.pais ?? '', division: r.division ?? null };
    });

  return {
    ...base,
    nombreCartera: ((gestorRow ?? [])[0] as { nombre_cartera?: string } | undefined)?.nombre_cartera ?? null,
    gestorIds: ((supRows ?? []) as Array<{ gestor_id: string }>).map((r) => r.gestor_id),
    gerenteZonaIds: ((supGerRows ?? []) as Array<{ gerente_zona_id: string }>).map((r) => r.gerente_zona_id),
    supervisorIds: ((liderRows ?? []) as Array<{ supervisor_id: string }>).map((r) => r.supervisor_id),
    zonaIds: ((gerRows ?? []) as Array<{ zona_id: string }>).map((r) => r.zona_id),
    paisZona: gerenteZonaAsignacionesDe(gerRows ?? []),
    gestorPaisZona: paisZonaDe(gestorZonaRows ?? [])
  };
};

/** Pares (país, zona) REALES existentes en cartera, resueltos contra zonas.id.
 *  Nunca inventa combinaciones: solo expone lo que efectivamente existe hoy en
 *  cartera (y que además tiene fila en `zonas`, requerido por la FK). */
const distinctCarteraPaisZona = async (): Promise<PaisZona[]> => {
  const client = getSupabaseClient();
  const pageSize = 1000;
  const pares = new Set<string>();
  for (let page = 0; page < 60; page += 1) {
    const from = page * pageSize;
    // `.order('id')` obligatorio: sin orden explícito, `range()` no garantiza
    // qué filas caen en cada página (ver SupabaseCarteraAdapter.getCartera) —
    // podía omitir país/zona reales de cartera de forma no determinística.
    const { data, error } = await client.from(SUPABASE_CARTERA_TABLE).select('pais, zona').order('id', { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw new UsuariosError(`No se pudo leer el catálogo de país/zona de cartera: ${error.message}`);
    const rows = (data ?? []) as Array<{ pais?: unknown; zona?: unknown }>;
    for (const r of rows) {
      const pais = typeof r.pais === 'string' ? r.pais.trim() : '';
      const zona = typeof r.zona === 'string' ? r.zona.trim() : '';
      if (pais && zona) pares.add(`${pais}||${zona}`);
    }
    if (rows.length < pageSize) break;
  }

  const { data: zonasRows, error: zErr } = await client.from('zonas').select('id, nombre').eq('activo', true);
  if (zErr) throw new UsuariosError(`No se pudo leer el catálogo de zonas: ${zErr.message}`);
  const zonaIdPorNombre = new Map(((zonasRows ?? []) as Array<{ id: string; nombre: string }>).map((z) => [z.nombre, z.id]));

  return Array.from(pares)
    .map((par) => { const [pais, zona] = par.split('||'); return { pais, zona, zonaId: zonaIdPorNombre.get(zona) ?? '' }; })
    .filter((p) => p.zonaId)
    .sort((a, b) => a.pais.localeCompare(b.pais, 'es') || a.zona.localeCompare(b.zona, 'es', { numeric: true }));
};

/** Combinaciones País/División/Zona YA asignadas (activas) a algún Gerente de
 *  zona — catálogo base del selector de asignación manual: crece con cada
 *  importación/edición, nunca se inventa. Si una misma (país,zona) tiene más
 *  de una división registrada entre distintos Gerentes, se exponen ambas
 *  combinaciones por separado (no se colapsan). */
const distinctGerenteZonaPaisDivisionZona = async (): Promise<GerenteZonaAsignacion[]> => {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('gerente_zona_zona')
    .select('zona_id, pais, division, zonas ( nombre )')
    .eq('activo', true);
  if (error) throw new UsuariosError(`No se pudo leer el catálogo de País/División/Zona de gerentes: ${error.message}`);

  const vistos = new Set<string>();
  const out: GerenteZonaAsignacion[] = [];
  for (const r of (data ?? []) as Array<{ zona_id: string; pais: string | null; division: string | null; zonas: { nombre?: string } | { nombre?: string }[] | null }>) {
    const z = Array.isArray(r.zonas) ? r.zonas[0] : r.zonas;
    const zona = z?.nombre ?? '';
    const pais = r.pais ?? '';
    const division = r.division ?? '';
    if (!zona || !pais) continue;
    const key = `${pais}||${division}||${zona}`;
    if (vistos.has(key)) continue;
    vistos.add(key);
    out.push({ zonaId: r.zona_id, zona, pais, division: r.division ?? null });
  }
  return out.sort((a, b) =>
    a.pais.localeCompare(b.pais, 'es') ||
    (a.division ?? '').localeCompare(b.division ?? '', 'es') ||
    a.zona.localeCompare(b.zona, 'es', { numeric: true }));
};

export const obtenerCatalogos = async (): Promise<Catalogos> => {
  const client = getSupabaseClient();

  const [{ data: roles, error: rErr }, { data: zonas, error: zErr }, { data: gestores, error: gErr }, carteraPaisZona,
    { data: supervisores, error: sErr }, { data: gerentesZona, error: gzErr }, gerenteZonaPaisDivisionZona] =
    await Promise.all([
      client.from('roles').select('id, clave, nombre, nivel').order('nivel', { ascending: true, nullsFirst: false }),
      client.from('zonas').select('id, nombre, codigo').eq('activo', true).order('nombre', { ascending: true }),
      client.from('gestores').select('id, nombre_cartera, usuario_id').eq('activo', true),
      distinctCarteraPaisZona(),
      client.from('profiles').select('id, nombre, apellido, roles!inner ( clave )').eq('activo', true).eq('roles.clave', 'supervisor'),
      client.from('profiles').select('id, nombre, apellido, roles!inner ( clave )').eq('activo', true).eq('roles.clave', 'gerente_zona'),
      distinctGerenteZonaPaisDivisionZona()
    ]);

  if (rErr) throw new UsuariosError(`No se pudieron leer los roles: ${rErr.message}`);
  if (zErr) throw new UsuariosError(`No se pudieron leer las zonas: ${zErr.message}`);
  if (gErr) throw new UsuariosError(`No se pudieron leer los gestores: ${gErr.message}`);
  if (sErr) throw new UsuariosError(`No se pudieron leer los supervisores: ${sErr.message}`);
  if (gzErr) throw new UsuariosError(`No se pudieron leer los gerentes de zona: ${gzErr.message}`);

  return {
    roles: ((roles ?? []) as Array<Record<string, unknown>>).map((r) => ({ id: String(r.id), clave: String(r.clave), nombre: String(r.nombre), nivel: (r.nivel as number | null) ?? null })),
    zonas: ((zonas ?? []) as Array<Record<string, unknown>>).map((z) => ({ id: String(z.id), nombre: String(z.nombre), codigo: (z.codigo as string | null) ?? null })),
    // Excluye filas huérfanas (usuario_id = null, ver sincronizarRelaciones):
    // el catálogo de "Gestores para asignar a un Supervisor" solo debe listar
    // Gestores vinculados a un usuario actual, nunca registros históricos.
    gestores: ((gestores ?? []) as Array<Record<string, unknown>>)
      .filter((g) => g.usuario_id)
      .map((g) => ({ id: String(g.id), nombreCartera: (g.nombre_cartera as string | null) ?? null, usuarioId: (g.usuario_id as string | null) ?? null })),
    carteraPaisZona,
    supervisores: ((supervisores ?? []) as Array<Record<string, unknown>>).map((s) => ({ id: String(s.id), nombre: String(s.nombre ?? ''), apellido: (s.apellido as string | null) ?? null })),
    gerentesZona: ((gerentesZona ?? []) as Array<Record<string, unknown>>).map((s) => ({ id: String(s.id), nombre: String(s.nombre ?? ''), apellido: (s.apellido as string | null) ?? null })),
    gerenteZonaPaisDivisionZona
  };
};

/**
 * Desactiva/limpia las relaciones que NO correspondan al rol indicado.
 * Preserva historial (desactivación lógica); para el vínculo de gestor
 * simplemente lo desliga (`usuario_id = null`). Aplica a alta, edición
 * individual y carga masiva, evitando que queden relaciones de roles previos.
 */
const limpiarRelacionesAjenas = async (userId: string, roleClave: string | null): Promise<void> => {
  const client = getSupabaseClient();
  if (roleClave !== 'gestor') {
    // Antes de desvincular, desactiva el narrowing País/Zona del gestor saliente
    // (evita filas huérfanas de gestor_pais_zona apuntando a un gestor sin dueño).
    const { data: gRow } = await client.from('gestores').select('id').eq('usuario_id', userId).eq('activo', true).limit(1);
    const gestorId = (gRow ?? [])[0]?.id as string | undefined;
    if (gestorId) await client.from('gestor_pais_zona').update({ activo: false }).eq('gestor_id', gestorId);
    // Desactiva también la fila `gestores` al desvincular (nunca dejarla
    // "activo=true" huérfana): de lo contrario sigue apareciendo en cualquier
    // catálogo/filtro de personas como un registro histórico sin dueño.
    await client.from('gestores').update({ usuario_id: null, activo: false }).eq('usuario_id', userId);
  }
  if (roleClave !== 'supervisor') {
    await client.from('supervisor_gestor').update({ activo: false }).eq('supervisor_id', userId);
    await client.from('supervisor_gerente_zona').update({ activo: false }).eq('supervisor_id', userId);
  }
  if (roleClave !== 'liderazgo') {
    await client.from('liderazgo_supervisor').update({ activo: false }).eq('liderazgo_id', userId);
  }
  if (roleClave !== 'gerente_zona') {
    await client.from('gerente_zona_zona').update({ activo: false }).eq('usuario_id', userId);
  }
};

/** Sincroniza las relaciones de alcance según el rol (reemplazo idempotente). */
const sincronizarRelaciones = async (
  userId: string,
  roleClave: string | null,
  input: {
    nombreCartera?: string | null;
    gestorIds?: string[];
    gerenteZonaIds?: string[];
    supervisorIds?: string[];
    zonaIds?: string[];
    paisZona?: Array<{ zonaId: string; pais: string; division?: string | null }>;
    gestorPaisZona?: Array<{ zonaId: string; pais: string }>;
  }
): Promise<void> => {
  await limpiarRelacionesAjenas(userId, roleClave);
  const client = getSupabaseClient();

  // gestor → gestores.usuario_id + nombre_cartera (puente con cartera.gestor)
  let gestorIdVinculado: string | null = null;
  if (roleClave === 'gestor' && input.nombreCartera) {
    // Desvincula cualquier gestor previo de este usuario y (re)asigna el
    // elegido. La fila previa se DESACTIVA al desvincular (nunca queda
    // "activo=true" sin usuario_id): así, si NOMBRE_CARTERA cambia de texto
    // entre ediciones (p. ej. "Bryan Rodriguez" -> "BRYAN DAVID RODRIGUEZ
    // LARIOS"), la fila antigua deja de contar como persona en cualquier
    // catálogo/filtro — antes quedaba huérfana pero activa, produciendo
    // nombres duplicados en el filtro de Gestor (bug confirmado en producción).
    await client.from('gestores').update({ usuario_id: null, activo: false }).eq('usuario_id', userId);
    const { data: existente } = await client.from('gestores').select('id').eq('nombre_cartera', input.nombreCartera).limit(1);
    const row = (existente ?? [])[0] as { id?: string } | undefined;
    if (row?.id) {
      const { error } = await client.from('gestores').update({ usuario_id: userId, activo: true }).eq('id', row.id);
      if (error) throw new UsuariosError(`No se pudo vincular el gestor: ${error.message}`);
      gestorIdVinculado = row.id;
    } else {
      const { data: inserted, error } = await client.from('gestores').insert({ usuario_id: userId, nombre_cartera: input.nombreCartera, activo: true }).select('id').single();
      if (error) throw new UsuariosError(`No se pudo crear el gestor: ${error.message}`);
      gestorIdVinculado = (inserted as { id: string }).id;
    }
  } else if (roleClave === 'gestor') {
    // BUG CORREGIDO (ronda 1): Usuarios ya NO envía `nombreCartera` en cada
    // edición (la asignación de cartera es semimanual, ver comentario arriba
    // de CrearUsuarioInput), así que antes `gestorIdVinculado` quedaba
    // SIEMPRE en null al editar — el bloque de abajo (gestor_pais_zona) nunca
    // se ejecutaba y la selección de País/Zona se perdía en silencio. Se
    // resuelve aquí el gestor YA vinculado a este usuario (el mismo filtro
    // que usa limpiarRelacionesAjenas), sin tocar su nombre_cartera.
    const { data: existente } = await client.from('gestores').select('id').eq('usuario_id', userId).eq('activo', true).limit(1);
    gestorIdVinculado = ((existente ?? [])[0] as { id?: string } | undefined)?.id ?? null;

    if (!gestorIdVinculado) {
      // BUG CORREGIDO (ronda 2): un usuario con rol Gestor creado
      // MANUALMENTE (sin pasar por la carga masiva) nunca tuvo
      // `nombre_cartera` que ofrecer, así que tampoco tenía ninguna fila en
      // `gestores` — la ronda anterior "corrigió" esto lanzando un error
      // ("aún no tiene un nombre de cartera vinculado"), que bloqueaba por
      // completo la asignación de País/Zona para cualquier Gestor manual.
      // `nombre_cartera` NUNCA debe ser un requisito de identidad: la
      // identidad real de un Gestor es `gestores.usuario_id` (-> profiles.id).
      // Se crea aquí el registro de `gestores` que debería haber existido
      // desde la creación del usuario, SIN nombre_cartera (columna ahora
      // nullable — ver sql/2026_gestores_nombre_cartera_nullable.sql); el
      // puente de texto hacia cartera.gestor queda simplemente vacío hasta
      // que alguien lo complete (import/edición), sin bloquear nada mientras
      // tanto. ScopeService ya resuelve el alcance de un Gestor exclusivamente
      // vía gestor_pais_zona (gestores.id) cuando nombre_cartera es null —
      // ver resolveGestorScope, que ya filtra nombre_cartera vacío de forma
      // defensiva desde antes de este cambio.
      const { data: inserted, error } = await client.from('gestores').insert({ usuario_id: userId, nombre_cartera: null, activo: true }).select('id').single();
      if (error) throw new UsuariosError(`No se pudo crear el registro de gestor: ${error.message}`);
      gestorIdVinculado = (inserted as { id: string }).id;
    }
  }

  // gestor → País/Zona explícitos (narrowing ADICIONAL opcional sobre nombre_cartera)
  if (roleClave === 'gestor' && input.gestorPaisZona) {
    // gestorIdVinculado SIEMPRE está resuelto en este punto para roleClave
    // 'gestor' (encontrado o recién creado arriba) — nunca se llega aquí sin
    // un gestor_id real.
    await client.from('gestor_pais_zona').delete().eq('gestor_id', gestorIdVinculado);
    if (input.gestorPaisZona.length > 0) {
      // Deduplica (zonaId, pais) por si el cliente envía la misma combinación
      // más de una vez: nunca debe quedar más de un registro vigente para la
      // misma relación gestor + zona.
      const vistos = new Set<string>();
      const unicos = input.gestorPaisZona.filter((pz) => {
        const k = `${pz.zonaId}||${pz.pais}`;
        if (vistos.has(k)) return false;
        vistos.add(k);
        return true;
      });
      const rows = unicos.map((pz) => ({ gestor_id: gestorIdVinculado, zona_id: pz.zonaId, pais: pz.pais, fecha_inicio: hoy(), fecha_fin: null, activo: true }));
      const { error } = await client.from('gestor_pais_zona').insert(rows);
      if (error) throw new UsuariosError(`No se pudo asignar el País/Zona del gestor: ${error.message}`);
    }
  }

  // supervisor → supervisor_gestor (reemplaza asignaciones vigentes)
  if (roleClave === 'supervisor' && input.gestorIds) {
    await client.from('supervisor_gestor').delete().eq('supervisor_id', userId);
    if (input.gestorIds.length > 0) {
      const rows = input.gestorIds.map((gestorId) => ({ supervisor_id: userId, gestor_id: gestorId, fecha_inicio: hoy(), fecha_fin: null, activo: true }));
      const { error } = await client.from('supervisor_gestor').insert(rows);
      if (error) throw new UsuariosError(`No se pudieron asignar los gestores del supervisor: ${error.message}`);
    }
  }

  // supervisor → supervisor_gerente_zona (reemplaza asignaciones vigentes)
  if (roleClave === 'supervisor' && input.gerenteZonaIds) {
    await client.from('supervisor_gerente_zona').delete().eq('supervisor_id', userId);
    if (input.gerenteZonaIds.length > 0) {
      const rows = input.gerenteZonaIds.map((gerenteZonaId) => ({ supervisor_id: userId, gerente_zona_id: gerenteZonaId, fecha_inicio: hoy(), fecha_fin: null, activo: true }));
      const { error } = await client.from('supervisor_gerente_zona').insert(rows);
      if (error) throw new UsuariosError(`No se pudieron asignar los gerentes de zona del supervisor: ${error.message}`);
    }
  }

  // liderazgo → liderazgo_supervisor (reemplaza asignaciones vigentes)
  if (roleClave === 'liderazgo' && input.supervisorIds) {
    await client.from('liderazgo_supervisor').delete().eq('liderazgo_id', userId);
    if (input.supervisorIds.length > 0) {
      const rows = input.supervisorIds.map((supervisorId) => ({ liderazgo_id: userId, supervisor_id: supervisorId, fecha_inicio: hoy(), fecha_fin: null, activo: true }));
      const { error } = await client.from('liderazgo_supervisor').insert(rows);
      if (error) throw new UsuariosError(`No se pudieron asignar los supervisores del liderazgo: ${error.message}`);
    }
  }

  // gerente_zona → gerente_zona_zona (reemplaza asignaciones vigentes; País/Zona explícito)
  if (roleClave === 'gerente_zona' && input.paisZona) {
    await client.from('gerente_zona_zona').delete().eq('usuario_id', userId);
    if (input.paisZona.length > 0) {
      // Deduplica (zonaId, pais): nunca más de un registro vigente para la
      // misma relación gerente + zona, aunque el cliente repita la combinación.
      const vistos = new Set<string>();
      const unicos = input.paisZona.filter((pz) => {
        const k = `${pz.zonaId}||${pz.pais}`;
        if (vistos.has(k)) return false;
        vistos.add(k);
        return true;
      });
      const rows = unicos.map((pz) => ({ usuario_id: userId, zona_id: pz.zonaId, pais: pz.pais, division: pz.division ?? null, fecha_inicio: hoy(), fecha_fin: null, activo: true }));
      const { error } = await client.from('gerente_zona_zona').insert(rows);
      if (error) throw new UsuariosError(`No se pudieron asignar las zonas del gerente: ${error.message}`);
    }
  } else if (roleClave === 'gerente_zona' && input.zonaIds) {
    // Compatibilidad: solo zona_id, sin país (desaconsejado; ambiguo si el código
    // de zona se repite entre países). Preferir siempre `paisZona`.
    await client.from('gerente_zona_zona').delete().eq('usuario_id', userId);
    if (input.zonaIds.length > 0) {
      const rows = input.zonaIds.map((zonaId) => ({ usuario_id: userId, zona_id: zonaId, fecha_inicio: hoy(), fecha_fin: null, activo: true }));
      const { error } = await client.from('gerente_zona_zona').insert(rows);
      if (error) throw new UsuariosError(`No se pudieron asignar las zonas del gerente: ${error.message}`);
    }
  }
};

export const crearUsuario = async (input: CrearUsuarioInput): Promise<{ id: string; password: string }> => {
  const client = getSupabaseClient();
  const email = input.email.trim().toLowerCase();
  if (!email) throw new UsuariosError('El correo es obligatorio.');
  if (!input.roleId) throw new UsuariosError('El rol es obligatorio.');

  // 1) Creación DIRECTA en Supabase Auth con email confirmado (sin invitación).
  //    Si el administrador definió una contraseña válida, se usa; si no, se genera
  //    una temporal. La contraseña NO se persiste en texto plano en ningún lugar.
  const inputPw = (input.password ?? '').trim();
  if (inputPw && inputPw.length < MIN_PASSWORD_LEN) {
    throw new UsuariosError(`La contraseña debe tener al menos ${MIN_PASSWORD_LEN} caracteres.`);
  }
  const password = inputPw || generarPasswordTemporal();
  const { data: created, error: createError } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (createError || !created?.user?.id) {
    throw new UsuariosError(`No se pudo crear el usuario: ${createError?.message ?? 'error desconocido'}`);
  }
  const userId = created.user.id;

  // 2) Perfil (upsert por si un trigger ya creó una fila base).
  const { error: profileError } = await client.from('profiles').upsert(
    {
      id: userId,
      email,
      nombre: input.nombre.trim(),
      apellido: input.apellido?.trim() ?? null,
      role_id: input.roleId,
      activo: input.activo ?? true
    },
    { onConflict: 'id' }
  );
  if (profileError) throw new UsuariosError(`No se pudo crear el perfil: ${profileError.message}`);

  // 3) Relaciones de alcance según rol.
  const clave = await claveDeRol(input.roleId);
  await sincronizarRelaciones(userId, clave, input);

  return { id: userId, password };
};

/**
 * Restablece la contraseña de un usuario existente vía Supabase Auth admin.
 * No requiere la contraseña anterior. No devuelve ni persiste la contraseña.
 */
export const restablecerPassword = async (id: string, password: string): Promise<void> => {
  const pw = (password ?? '').trim();
  if (!pw) throw new UsuariosError('La contraseña es obligatoria.');
  if (pw.length < MIN_PASSWORD_LEN) throw new UsuariosError(`La contraseña debe tener al menos ${MIN_PASSWORD_LEN} caracteres.`);
  const { error } = await getSupabaseClient().auth.admin.updateUserById(id, { password: pw });
  if (error) throw new UsuariosError(describirErrorAuth(error, 'No se pudo restablecer la contraseña.'));
};

/**
 * "Restablecer contraseña" (función administrativa, USUARIOS): distinta de
 * restablecerPassword() de arriba (el admin escribe una contraseña libre).
 * Aquí la contraseña SIEMPRE es la fija PASSWORD_TEMPORAL_ADMINISTRATIVA
 * ('Avon2026'), vigente DIAS_VIGENCIA_PASSWORD_TEMPORAL_ADMINISTRATIVA (15)
 * días. Bloquea SIEMPRE a usuarios con rol administrador — el rol se lee del
 * propio perfil (fuente real de roles/permisos), nunca de lo que mande el
 * cliente. La contraseña NUNCA se persiste en ninguna tabla de aplicación:
 * solo se envía a Supabase Auth (admin.updateUserById); `profiles` guarda
 * únicamente METADATOS de vigencia (is_temporary_password/
 * must_change_password/temporary_password_*_at).
 */
export const restablecerPasswordTemporal = async (id: string): Promise<{ email: string; expiresAt: string }> => {
  const client = getSupabaseClient();

  const { data: perfil, error: perfilErr } = await client
    .from('profiles')
    .select('id, email, roles ( clave )')
    .eq('id', id)
    .single();
  if (perfilErr || !perfil) throw new UsuariosError('Usuario no encontrado.');
  const email = String((perfil as Record<string, unknown>).email ?? '');
  const roleClave = roleRefOf((perfil as Record<string, unknown>).roles)?.clave ?? null;

  if (roleClave === 'administrador') {
    throw new UsuariosForbiddenError('Los usuarios administradores no pueden recibir la contraseña temporal predeterminada.');
  }

  const { error: authErr } = await client.auth.admin.updateUserById(id, { password: PASSWORD_TEMPORAL_ADMINISTRATIVA });
  if (authErr) throw new UsuariosError(describirErrorAuth(authErr, 'No se pudo restablecer la contraseña.'));

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + DIAS_VIGENCIA_PASSWORD_TEMPORAL_ADMINISTRATIVA * 24 * 60 * 60 * 1000);
  const { error: updateErr } = await client
    .from('profiles')
    .update({
      is_temporary_password: true,
      must_change_password: true,
      temporary_password_created_at: createdAt.toISOString(),
      temporary_password_expires_at: expiresAt.toISOString()
    })
    .eq('id', id);
  if (updateErr) throw new UsuariosError(`Contraseña restablecida pero no se pudo registrar el estado temporal: ${updateErr.message}`);

  return { email, expiresAt: expiresAt.toISOString() };
};

/**
 * Limpia el estado de contraseña temporal de UN usuario (siempre el propio,
 * llamado por AuthController.passwordChanged con req.auth.userId — nunca un
 * id ajeno). Se invoca tras un cambio de contraseña exitoso vía Supabase
 * Auth (hecho en el cliente, authService.updatePassword): este método NUNCA
 * toca la contraseña en sí, solo los metadatos de vigencia.
 */
export const limpiarEstadoPasswordTemporal = async (id: string): Promise<void> => {
  const { error } = await getSupabaseClient()
    .from('profiles')
    .update({
      is_temporary_password: false,
      must_change_password: false,
      temporary_password_created_at: null,
      temporary_password_expires_at: null
    })
    .eq('id', id);
  if (error) throw new UsuariosError(`No se pudo actualizar el estado de la contraseña: ${error.message}`);
};

export const actualizarUsuario = async (id: string, input: ActualizarUsuarioInput): Promise<void> => {
  const client = getSupabaseClient();

  const patch: Record<string, unknown> = {};
  if (input.nombre !== undefined) patch.nombre = String(input.nombre).trim();
  if (input.apellido !== undefined) patch.apellido = input.apellido?.toString().trim() ?? null;
  if (input.roleId !== undefined) patch.role_id = input.roleId;
  if (input.activo !== undefined) patch.activo = input.activo;

  if (Object.keys(patch).length > 0) {
    const { error } = await client.from('profiles').update(patch).eq('id', id);
    if (error) throw new UsuariosError(`No se pudo actualizar el usuario: ${error.message}`);
  }

  // Relaciones: se sincronizan según el rol efectivo (el nuevo si cambió, o el actual).
  let clave: string | null = null;
  if (input.roleId !== undefined) clave = await claveDeRol(input.roleId);
  else {
    const { data } = await client.from('profiles').select('role_id').eq('id', id).single();
    const roleId = (data as { role_id?: string } | null)?.role_id;
    clave = roleId ? await claveDeRol(roleId) : null;
  }
  await sincronizarRelaciones(id, clave, input);
};

/** Error de AUTORIZACIÓN (nunca de validación de datos): el controller debe
 *  traducirlo a HTTP 403, no 400. */
export class UsuariosForbiddenError extends UsuariosError {
  constructor(message: string) {
    super(message);
    this.name = 'UsuariosForbiddenError';
  }
}

interface PerfilAEliminar { id: string; email: string; roleClave: string | null; }

/**
 * Regla de autorización para eliminar un usuario (Sección 3):
 *  - Nadie puede eliminarse a sí mismo (cualquier rol).
 *  - Un usuario con rol ADMINISTRADOR SOLO puede ser eliminado por OTRO
 *    ADMINISTRADOR (Gestor/Supervisor/Gerente de zona/Liderazgo -> NUNCA).
 * Se valida SIEMPRE en el backend (el frontend nunca es la fuente de verdad).
 */
const validarPermisoEliminar = (target: PerfilAEliminar, actorId: string | null, actorRoleClave: string | null): void => {
  if (actorId && actorId === target.id) throw new UsuariosForbiddenError('No puedes eliminar tu propia cuenta.');
  if (target.roleClave === 'administrador' && actorRoleClave !== 'administrador') {
    throw new UsuariosForbiddenError('Solo un Administrador puede eliminar a otro Administrador.');
  }
};

/** Limpia relaciones + Auth + perfil de UN usuario ya autorizado para eliminarse.
 *  No valida permisos (eso ya se hizo antes de invocar esta función). */
const ejecutarEliminacionUsuario = async (id: string): Promise<void> => {
  const client = getSupabaseClient();

  // 1) Limpia relaciones de alcance para que no quede acceso residual. Solo
  //    quita LAS ASIGNACIONES (quién supervisa/depende de quién): nunca borra
  //    a los usuarios "hijos" (Gestores/Gerentes de zona de un Supervisor
  //    eliminado siguen existiendo como cuentas independientes).
  // Desactiva la fila `gestores` al desvincular (nunca dejarla huérfana pero activa).
  await client.from('gestores').update({ usuario_id: null, activo: false }).eq('usuario_id', id);
  await client.from('supervisor_gestor').delete().eq('supervisor_id', id);
  await client.from('supervisor_gerente_zona').delete().or(`supervisor_id.eq.${id},gerente_zona_id.eq.${id}`);
  await client.from('liderazgo_supervisor').delete().or(`liderazgo_id.eq.${id},supervisor_id.eq.${id}`);
  await client.from('gerente_zona_zona').delete().eq('usuario_id', id);

  // 2) Elimina de Supabase Auth (Admin API). Requiere SUPABASE_SERVICE_ROLE_KEY
  //    (getSupabaseClient() ya está configurado exclusivamente con esa clave;
  //    nunca con la anon key). Un usuario ya inexistente en Auth (p. ej. una
  //    reintento tras un fallo previo) NO es un error fatal.
  const { error: authError } = await client.auth.admin.deleteUser(id);
  if (authError && !esUsuarioAuthInexistente(authError)) {
    throw new UsuariosError(describirErrorAuth(authError, 'No se pudo eliminar el usuario de Auth.'));
  }

  // 3) Elimina el perfil (por si no hubo cascada).
  await client.from('profiles').delete().eq('id', id);
};

/**
 * Elimina un usuario: valida el permiso (auto-eliminación / regla de
 * Administrador), limpia relaciones, borra de Supabase Auth y de profiles.
 * Devuelve datos para auditoría.
 */
export const eliminarUsuario = async (
  id: string,
  actorId: string | null,
  actorRoleClave: string | null
): Promise<{ email: string; roleClave: string | null }> => {
  const client = getSupabaseClient();

  const { data: perfil } = await client.from('profiles').select('id, email, roles ( clave )').eq('id', id).single();
  if (!perfil) throw new UsuariosError('Usuario no encontrado.');
  const email = String((perfil as Record<string, unknown>).email ?? '');
  const roleClave = roleRefOf((perfil as Record<string, unknown>).roles)?.clave ?? null;

  validarPermisoEliminar({ id, email, roleClave }, actorId, actorRoleClave);
  await ejecutarEliminacionUsuario(id);

  return { email, roleClave };
};

export interface CandidatoEliminacion { id: string; email: string; rol: string | null; }
export interface CandidatoBloqueado extends CandidatoEliminacion { motivo: string; }
export interface ValidacionEliminacionMasiva {
  permitidos: CandidatoEliminacion[];
  bloqueados: CandidatoBloqueado[];
}

/**
 * Valida TODA una selección de ids SIN eliminar nada (Sección 8-9): separa
 * permitidos/bloqueados con motivo, para mostrarlos ANTES de pedir
 * confirmación. Nunca hace una eliminación parcial silenciosa: cada id
 * queda explícitamente en un grupo u otro.
 */
export const validarEliminacionMasiva = async (
  ids: string[],
  actorId: string | null,
  actorRoleClave: string | null
): Promise<ValidacionEliminacionMasiva> => {
  const idsUnicos = Array.from(new Set(ids.filter((x) => typeof x === 'string' && x.trim())));
  const permitidos: CandidatoEliminacion[] = [];
  const bloqueados: CandidatoBloqueado[] = [];
  if (idsUnicos.length === 0) return { permitidos, bloqueados };

  const client = getSupabaseClient();
  const { data, error } = await client.from('profiles').select('id, email, roles ( clave )').in('id', idsUnicos);
  if (error) throw new UsuariosError(`No se pudo verificar la selección: ${error.message}`);
  const encontrados = new Map(((data ?? []) as Array<Record<string, unknown>>).map((f) => [String(f.id), f]));

  for (const id of idsUnicos) {
    const fila = encontrados.get(id);
    if (!fila) { bloqueados.push({ id, email: '', rol: null, motivo: 'Usuario no encontrado.' }); continue; }
    const email = String(fila.email ?? '');
    const rol = roleRefOf(fila.roles)?.clave ?? null;
    try {
      validarPermisoEliminar({ id, email, roleClave: rol }, actorId, actorRoleClave);
      permitidos.push({ id, email, rol });
    } catch (permError) {
      const motivo = permError instanceof Error ? permError.message : 'No autorizado.';
      bloqueados.push({ id, email, rol, motivo });
    }
  }
  return { permitidos, bloqueados };
};

export interface ResultadoEliminacionMasiva {
  eliminados: CandidatoEliminacion[];
  bloqueados: CandidatoBloqueado[];
  errores: CandidatoBloqueado[];
}

/**
 * Elimina una selección completa de usuarios (Sección 8-9). Re-valida TODO en
 * el servidor (nunca confía en que el frontend ya validó): solo se eliminan
 * los ids que pasan `validarPermisoEliminar` en el momento de ejecutar, nunca
 * los bloqueados. El resultado siempre enumera qué pasó con CADA id
 * (eliminado/bloqueado/error) — nunca una eliminación parcial silenciosa.
 * Operación idempotente: reintentar sobre ids ya eliminados los reporta como
 * "Usuario no encontrado" en `bloqueados`, sin fallar.
 */
export const eliminarUsuariosMasivo = async (
  ids: string[],
  actorId: string | null,
  actorRoleClave: string | null
): Promise<ResultadoEliminacionMasiva> => {
  const { permitidos, bloqueados } = await validarEliminacionMasiva(ids, actorId, actorRoleClave);
  const eliminados: CandidatoEliminacion[] = [];
  const errores: CandidatoBloqueado[] = [];

  for (const candidato of permitidos) {
    try {
      await ejecutarEliminacionUsuario(candidato.id);
      eliminados.push(candidato);
    } catch (execError) {
      const motivo = execError instanceof Error ? execError.message : 'No se pudo eliminar.';
      errores.push({ ...candidato, motivo });
    }
  }

  return { eliminados, bloqueados, errores };
};

/* ============================================================================
 * IMPORTACIÓN MASIVA DE USUARIOS (Configuración > Usuarios) — plantillas
 * Administrativa/Comercial (reemplaza por completo el antiguo módulo
 * "Gestión masiva de Usuarios" de Repositorio, eliminado). Reutiliza
 * crearUsuario/actualizarUsuario/sincronizarRelaciones (misma lógica,
 * mismas garantías de reemplazo idempotente, que la edición manual) —
 * identifica a cada persona por CORREO normalizado, nunca por nombre: varias
 * filas con el mismo correo en la hoja Comercial son la MISMA persona con
 * varias asignaciones de territorio, nunca usuarios duplicados.
 * ========================================================================== */

export interface PreviewItem {
  hoja: string;
  fila: number;
  accion: string;
  email: string;
  rol: string;
  columna: string;
  estado: 'VALIDO' | 'ERROR';
  mensaje: string;
}

export interface ResumenImport {
  total: number;
  validas: number;
  errores: number;
  creaciones: number;
  actualizaciones: number;
  relacionesAsignadas: number;
}

export interface ResultadoAplicarItem {
  hoja: string;
  fila: number;
  accion: string;
  email: string;
  nombre?: string;
  apellido?: string;
  rol: string;
  resultado: 'OK' | 'ERROR';
  password: string;
  mensaje: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normDivision = (s: string): string => s.trim().toLowerCase();

interface FilaConEstado extends FilaImportUsuario {
  emailNorm: string;
  estado: 'VALIDO' | 'ERROR';
  columna: string;
  mensaje: string;
  /** Clave de rol normalizada (solo si ROL fue válido; '' si no). */
  rolResuelto: string;
}

interface ImportContexto {
  rolesPorClave: Map<string, { id: string; nivel: number | null }>;
  zonaIdPorNombre: Map<string, string>;
  /** lowercase -> grafía canónica real (de cartera). */
  paisesValidos: Map<string, string>;
  perfilesPorEmail: Map<string, { id: string; roleClave: string | null }>;
}

/** Países REALES (nunca inventados): distintos valores de `cartera.pais`. */
const paisesRealesDeCartera = async (): Promise<string[]> => {
  const client = getSupabaseClient();
  const pageSize = 1000;
  const set = new Set<string>();
  for (let page = 0; page < 60; page += 1) {
    const from = page * pageSize;
    const { data, error } = await client.from(SUPABASE_CARTERA_TABLE).select('pais').order('id', { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw new UsuariosError(`No se pudo leer el catálogo de países: ${error.message}`);
    const rows = (data ?? []) as Array<{ pais?: unknown }>;
    for (const r of rows) { const p = typeof r.pais === 'string' ? r.pais.trim() : ''; if (p) set.add(p); }
    if (rows.length < pageSize) break;
  }
  return Array.from(set);
};

const cargarContextoImportacion = async (): Promise<ImportContexto> => {
  const client = getSupabaseClient();
  const [{ data: roles, error: rErr }, { data: zonas, error: zErr }, { data: perfiles, error: pErr }, paisesReales] = await Promise.all([
    client.from('roles').select('id, clave, nivel'),
    client.from('zonas').select('id, nombre').eq('activo', true),
    client.from('profiles').select('id, email, role_id, roles ( clave )'),
    paisesRealesDeCartera()
  ]);
  if (rErr) throw new UsuariosError(`No se pudieron leer los roles: ${rErr.message}`);
  if (zErr) throw new UsuariosError(`No se pudieron leer las zonas: ${zErr.message}`);
  if (pErr) throw new UsuariosError(`No se pudieron leer los usuarios: ${pErr.message}`);

  const rolesPorClave = new Map(((roles ?? []) as Array<{ id: string; clave: string; nivel: number | null }>).map((r) => [r.clave, { id: r.id, nivel: r.nivel }]));
  const zonaIdPorNombre = new Map(((zonas ?? []) as Array<{ id: string; nombre: string }>).map((z) => [z.nombre, z.id]));
  const paisesValidos = new Map(paisesReales.map((p) => [p.toLowerCase(), p]));
  const perfilesPorEmail = new Map<string, { id: string; roleClave: string | null }>();
  for (const p of (perfiles ?? []) as Array<Record<string, unknown>>) {
    const email = normEmail(String(p.email ?? ''));
    if (email) perfilesPorEmail.set(email, { id: String(p.id), roleClave: roleRefOf(p.roles)?.clave ?? null });
  }
  return { rolesPorClave, zonaIdPorNombre, paisesValidos, perfilesPorEmail };
};

/** Valida una fila de forma aislada (sin considerar otras filas del mismo
 *  correo — eso lo hace `detectarConflictosPorEmail` después). */
const validarFilaBase = (
  fila: FilaImportUsuario,
  ctx: ImportContexto
): { estado: 'VALIDO' | 'ERROR'; columna: string; mensaje: string; rolResuelto: string } => {
  const correo = normEmail(fila.correo);
  if (!correo || !EMAIL_RE.test(correo)) return { estado: 'ERROR', columna: 'CORREO', mensaje: 'CORREO inválido o vacío.', rolResuelto: '' };
  if (!fila.nombre.trim()) return { estado: 'ERROR', columna: 'NOMBRE', mensaje: 'NOMBRE es obligatorio.', rolResuelto: '' };

  const rolNorm = fila.rol.trim().toLowerCase();
  const rolInfo = ctx.rolesPorClave.get(rolNorm);
  if (!rolInfo) return { estado: 'ERROR', columna: 'ROL', mensaje: `ROL "${fila.rol}" no es válido (ver hoja ROLES_VALIDOS).`, rolResuelto: '' };

  if (fila.nivel.trim()) {
    const nivelNum = Number(fila.nivel.trim());
    if (!Number.isFinite(nivelNum) || (rolInfo.nivel !== null && nivelNum !== rolInfo.nivel)) {
      return { estado: 'ERROR', columna: 'NIVEL', mensaje: `NIVEL no coincide con el ROL "${fila.rol}" (se esperaba ${rolInfo.nivel ?? '—'}).`, rolResuelto: '' };
    }
  }

  const paisNorm = fila.pais.trim();
  if (!paisNorm) return { estado: 'ERROR', columna: 'PAIS', mensaje: 'PAIS es obligatorio.', rolResuelto: '' };
  if (!ctx.paisesValidos.has(paisNorm.toLowerCase())) {
    return { estado: 'ERROR', columna: 'PAIS', mensaje: `PAIS "${fila.pais}" no coincide con ningún país real de cartera.`, rolResuelto: '' };
  }

  if (fila.hoja === 'Comercial' && rolNorm === 'gerente_zona') {
    if (!fila.division.trim()) return { estado: 'ERROR', columna: 'DIVISION', mensaje: 'DIVISION es obligatoria para Gerente de zona.', rolResuelto: '' };
    const zonaNorm = fila.zona.trim().toUpperCase();
    if (!zonaNorm) return { estado: 'ERROR', columna: 'ZONA', mensaje: 'ZONA es obligatoria para Gerente de zona.', rolResuelto: '' };
    if (zonaNorm !== 'GV' && !/^\d+$/.test(zonaNorm)) {
      return { estado: 'ERROR', columna: 'ZONA', mensaje: `ZONA "${fila.zona}" no es un código numérico válido ni el marcador especial "GV".`, rolResuelto: '' };
    }
  }

  return { estado: 'VALIDO', columna: '', mensaje: '', rolResuelto: rolNorm };
};

/** Si un mismo CORREO aparece en varias filas con NOMBRE/APELLIDO/ROL
 *  distintos, es un conflicto de identidad real (Sección "Gerente de zona"):
 *  se reporta y NINGUNA fila de ese correo se aplica — nunca se fusionan
 *  identidades distintas por coincidencia de correo. */
const detectarConflictosPorEmail = (filas: FilaConEstado[]): void => {
  const porEmail = new Map<string, FilaConEstado[]>();
  for (const f of filas) {
    if (!f.emailNorm) continue;
    const l = porEmail.get(f.emailNorm) ?? [];
    l.push(f);
    porEmail.set(f.emailNorm, l);
  }
  for (const [email, grupo] of porEmail) {
    if (grupo.length < 2) continue;
    const base = grupo[0];
    const nombreBase = base.nombre.trim().toLowerCase();
    const apellidoBase = base.apellido.trim().toLowerCase();
    const rolBase = base.rolResuelto || base.rol.trim().toLowerCase();
    const conflicto = grupo.some((f) => {
      const rol = f.rolResuelto || f.rol.trim().toLowerCase();
      return f.nombre.trim().toLowerCase() !== nombreBase || f.apellido.trim().toLowerCase() !== apellidoBase || rol !== rolBase;
    });
    if (!conflicto) continue;
    const filasTexto = grupo.map((f) => `${f.hoja}#${f.fila}`).join(', ');
    grupo.forEach((f) => {
      f.estado = 'ERROR';
      f.columna = f.columna || 'CORREO';
      f.mensaje = `Conflicto: el correo "${email}" aparece con NOMBRE/APELLIDO/ROL distintos entre filas (${filasTexto}). Corrige el archivo antes de importar.`;
    });
  }
};

/** Para cada (País,División) de filas Comercial válidas (rol gerente_zona),
 *  junta los códigos de zona conocidos: los numéricos del propio archivo +
 *  los ya existentes (vigentes) en `gerente_zona_zona` para ese
 *  País/División — nunca se inventa una zona. Es la fuente usada para
 *  expandir el marcador ZONA="GV" ("todas las zonas de esta división"). */
const construirMapaZonasPorDivision = async (filasGerenteZonaValidas: FilaConEstado[]): Promise<Map<string, Set<string>>> => {
  const mapa = new Map<string, Set<string>>();
  const addKey = (pais: string, division: string, zona: string) => {
    const key = `${pais}||${normDivision(division)}`;
    const set = mapa.get(key) ?? new Set<string>();
    set.add(zona);
    mapa.set(key, set);
  };
  const paresNecesarios = new Set<string>();
  for (const f of filasGerenteZonaValidas) {
    const pais = f.pais.trim();
    paresNecesarios.add(`${pais}||${normDivision(f.division)}`);
    const zonaNorm = f.zona.trim().toUpperCase();
    if (zonaNorm !== 'GV') addKey(pais, f.division, zonaNorm);
  }
  if (paresNecesarios.size > 0) {
    const { data, error } = await getSupabaseClient().from('gerente_zona_zona').select('pais, division, zonas ( nombre )').eq('activo', true);
    if (error) throw new UsuariosError(`No se pudo leer gerente_zona_zona para resolver "GV": ${error.message}`);
    for (const r of (data ?? []) as Array<{ pais: string | null; division: string | null; zonas: { nombre?: string } | { nombre?: string }[] | null }>) {
      const pais = (r.pais ?? '').trim();
      const key = `${pais}||${normDivision(r.division ?? '')}`;
      if (!paresNecesarios.has(key)) continue;
      const z = Array.isArray(r.zonas) ? r.zonas[0] : r.zonas;
      const zona = z?.nombre ?? '';
      if (zona) addKey(pais, r.division ?? '', zona);
    }
  }
  return mapa;
};

interface EvaluacionImportacion {
  filas: FilaConEstado[];
  ctx: ImportContexto;
  mapaZonas: Map<string, Set<string>>;
  items: PreviewItem[];
  resumen: ResumenImport;
}

/** Evalúa TODO el archivo (valida + resuelve GV) sin escribir nada en la
 *  base de datos. Única fuente de verdad para validar y aplicar: aplicar
 *  reutiliza exactamente este mismo resultado, nunca revalida por su cuenta. */
const evaluarImportacionUsuarios = async (parsed: ParsedWorkbookUsuarios): Promise<EvaluacionImportacion> => {
  const ctx = await cargarContextoImportacion();

  const filas: FilaConEstado[] = parsed.filas.map((f) => {
    const base = validarFilaBase(f, ctx);
    return { ...f, emailNorm: normEmail(f.correo), ...base };
  });
  detectarConflictosPorEmail(filas);

  const filasGerenteZonaValidas = () => filas.filter((f) => f.estado === 'VALIDO' && f.hoja === 'Comercial' && f.rolResuelto === 'gerente_zona');
  const mapaZonas = await construirMapaZonasPorDivision(filasGerenteZonaValidas());

  // Revalida las filas GV ahora que se conoce el universo de zonas de su división.
  for (const f of filasGerenteZonaValidas()) {
    if (f.zona.trim().toUpperCase() !== 'GV') continue;
    const zonas = mapaZonas.get(`${f.pais.trim()}||${normDivision(f.division)}`);
    if (!zonas || zonas.size === 0) {
      f.estado = 'ERROR';
      f.columna = 'ZONA';
      f.mensaje = `No se encontraron zonas conocidas para la división "${f.division}" en "${f.pais}" — agrega primero al menos una fila con una zona numérica para esa división, o asígnala manualmente desde Gestión de usuarios.`;
    }
  }

  const accionPorEmail = new Map<string, string>();
  for (const f of filas) {
    if (!f.emailNorm || accionPorEmail.has(f.emailNorm)) continue;
    accionPorEmail.set(f.emailNorm, ctx.perfilesPorEmail.has(f.emailNorm) ? 'ACTUALIZAR' : 'CREAR');
  }

  const items: PreviewItem[] = filas.map((f) => ({
    hoja: f.hoja,
    fila: f.fila,
    accion: f.emailNorm ? (accionPorEmail.get(f.emailNorm) ?? '') : '',
    email: f.correo,
    rol: f.rol,
    columna: f.columna,
    estado: f.estado,
    mensaje: f.mensaje
  }));

  const emailsValidosUnicos = new Set(filas.filter((f) => f.estado === 'VALIDO').map((f) => f.emailNorm));
  let creaciones = 0;
  let actualizaciones = 0;
  for (const email of emailsValidosUnicos) {
    if (ctx.perfilesPorEmail.has(email)) actualizaciones += 1; else creaciones += 1;
  }

  let relacionesAsignadas = 0;
  const zonasPorEmailGerente = new Map<string, Set<string>>();
  for (const f of filasGerenteZonaValidas()) {
    const zonasFila = f.zona.trim().toUpperCase() === 'GV'
      ? Array.from(mapaZonas.get(`${f.pais.trim()}||${normDivision(f.division)}`) ?? [])
      : [f.zona.trim().toUpperCase()];
    const set = zonasPorEmailGerente.get(f.emailNorm) ?? new Set<string>();
    zonasFila.forEach((z) => set.add(`${f.pais.trim()}||${z}`));
    zonasPorEmailGerente.set(f.emailNorm, set);
  }
  for (const set of zonasPorEmailGerente.values()) relacionesAsignadas += set.size;

  return {
    filas,
    ctx,
    mapaZonas,
    items,
    resumen: {
      total: filas.length,
      validas: filas.filter((f) => f.estado === 'VALIDO').length,
      errores: filas.filter((f) => f.estado === 'ERROR').length,
      creaciones,
      actualizaciones,
      relacionesAsignadas
    }
  };
};

/** Valida el archivo completo (ambas hojas) SIN modificar la base de datos. */
export const validarImportacionUsuarios = async (parsed: ParsedWorkbookUsuarios): Promise<{ items: PreviewItem[]; resumen: ResumenImport }> => {
  const { items, resumen } = await evaluarImportacionUsuarios(parsed);
  return { items, resumen };
};

/**
 * Aplica el archivo completo: SOLO se aplican correos cuyas filas estén
 * TODAS en estado VALIDO (nunca una fila con error, independientemente del
 * valor de `soloValidas` — aplicar datos inválidos nunca es una opción
 * segura; el parámetro se conserva por compatibilidad de firma con el flujo
 * de confirmación del frontend). Reutiliza crearUsuario/actualizarUsuario
 * (misma lógica/garantías que la edición manual, incluido el reemplazo
 * idempotente de relaciones vía sincronizarRelaciones).
 */
export const aplicarImportacionUsuarios = async (
  parsed: ParsedWorkbookUsuarios,
  soloValidas: boolean,
  actorId: string | null
): Promise<{ resultados: ResultadoAplicarItem[]; resumen: ResumenImport }> => {
  void soloValidas;
  const { filas, ctx, mapaZonas, resumen } = await evaluarImportacionUsuarios(parsed);

  const porEmail = new Map<string, FilaConEstado[]>();
  for (const f of filas) {
    if (!f.emailNorm) continue;
    const l = porEmail.get(f.emailNorm) ?? [];
    l.push(f);
    porEmail.set(f.emailNorm, l);
  }

  const resultados: ResultadoAplicarItem[] = [];
  let relacionesCreadas = 0;

  for (const [email, grupo] of porEmail) {
    const todasValidas = grupo.every((f) => f.estado === 'VALIDO');
    if (!todasValidas) {
      grupo.forEach((f) => resultados.push({
        hoja: f.hoja, fila: f.fila, accion: '', email: f.correo, nombre: f.nombre, apellido: f.apellido,
        rol: f.rol, resultado: 'ERROR', password: '',
        mensaje: f.mensaje || 'Fila con errores de validación: no se aplicó ningún cambio para este correo.'
      }));
      continue;
    }

    const base = grupo[0];
    const existente = ctx.perfilesPorEmail.get(email) ?? null;
    const rolInfo = ctx.rolesPorClave.get(base.rolResuelto);
    if (!rolInfo) continue; // Ya validado arriba: no debería ocurrir.

    // Asignaciones Gerente de zona del grupo completo (expandiendo "GV"),
    // deduplicadas por (país, zona).
    const paisZona: Array<{ zonaId: string; pais: string; division?: string | null }> = [];
    if (base.rolResuelto === 'gerente_zona') {
      const vistos = new Set<string>();
      for (const f of grupo) {
        if (f.hoja !== 'Comercial') continue;
        const pais = f.pais.trim();
        const zonaNorm = f.zona.trim().toUpperCase();
        const codigos = zonaNorm === 'GV'
          ? Array.from(mapaZonas.get(`${pais}||${normDivision(f.division)}`) ?? [])
          : [zonaNorm];
        for (const codigo of codigos) {
          const key = `${pais}||${codigo}`;
          if (vistos.has(key)) continue;
          vistos.add(key);
          let zonaId = ctx.zonaIdPorNombre.get(codigo);
          if (!zonaId) {
            // Código de zona real del archivo que aún no existe en el
            // catálogo: se crea (dato real de la plantilla, no inventado).
            const { data: creada, error: errZona } = await getSupabaseClient().from('zonas').insert({ nombre: codigo, activo: true }).select('id').single();
            if (errZona) throw new UsuariosError(`No se pudo crear la zona "${codigo}": ${errZona.message}`);
            zonaId = (creada as { id: string }).id;
            ctx.zonaIdPorNombre.set(codigo, zonaId);
          }
          paisZona.push({ zonaId, pais, division: f.division.trim() || null });
        }
      }
    }

    try {
      let usuarioId: string;
      let password = '';
      let accion: string;
      if (existente) {
        accion = 'ACTUALIZAR';
        usuarioId = existente.id;
        await actualizarUsuario(usuarioId, {
          nombre: base.nombre.trim(),
          apellido: base.apellido.trim() || null,
          roleId: rolInfo.id,
          ...(base.rolResuelto === 'gerente_zona' ? { paisZona } : {})
        });
      } else {
        accion = 'CREAR';
        const creado = await crearUsuario({
          email,
          nombre: base.nombre.trim(),
          apellido: base.apellido.trim() || null,
          roleId: rolInfo.id,
          ...(base.rolResuelto === 'gerente_zona' ? { paisZona } : {})
        });
        usuarioId = creado.id;
        password = creado.password;
      }
      relacionesCreadas += paisZona.length;
      grupo.forEach((f) => resultados.push({
        hoja: f.hoja, fila: f.fila, accion, email: f.correo, nombre: f.nombre, apellido: f.apellido,
        rol: f.rol, resultado: 'OK', password, mensaje: accion === 'CREAR' ? 'Usuario creado.' : 'Usuario actualizado.'
      }));
    } catch (applyError) {
      const motivo = applyError instanceof Error ? applyError.message : 'No se pudo aplicar.';
      grupo.forEach((f) => resultados.push({
        hoja: f.hoja, fila: f.fila, accion: existente ? 'ACTUALIZAR' : 'CREAR', email: f.correo, nombre: f.nombre, apellido: f.apellido,
        rol: f.rol, resultado: 'ERROR', password: '', mensaje: motivo
      }));
    }
  }

  await registrarAuditoria(actorId, 'IMPORTAR_USUARIOS', 'usuarios', null, {
    total: resumen.total,
    validas: resumen.validas,
    errores: resumen.errores,
    ok: resultados.filter((r) => r.resultado === 'OK').length
  });

  return { resultados, resumen: { ...resumen, relacionesAsignadas: relacionesCreadas } };
};

/* ============================================================================
 * GRUPOS Y NIVELES — visuales (Sección 10). Un renglón por usuario con rol
 * dependiente (liderazgo/supervisor/gestor/gerente_zona), calculado SIEMPRE a
 * partir de las relaciones reales configuradas (nunca de ASIGNACION). El
 * País/Zona alcanzado por un Gestor es la UNIÓN (nunca un fallback
 * condicional) de su `gestor_pais_zona` explícito y las filas de `cartera`
 * cuyo `gestor` (texto) coincide con su nombre registrado — el mismo
 * principio OR independiente que usa ScopeFilter.applyScope para autorizar
 * datos; jamás "si no hay explícito, usar cartera" (eso dejaba a un
 * Liderazgo/Supervisor viendo 0 País/Zona de un Gestor que SÍ tiene alcance
 * real vía gestor_pais_zona pero ningún match de nombre en cartera).
 * ========================================================================== */

export interface AlcanceResumenItem {
  userId: string;
  roleClave: string | null;
  nivel: number | null;
  totalSupervisores: number | null; // liderazgo
  totalGestores: number | null;     // supervisor
  totalZonas: number | null;        // gestor | gerente_zona
  totalSectores: number | null;     // gerente_zona
  paises: string[];
  zonas: string[];
}

interface CarteraFila { pais: string; zona: string; sector: string; }

const cargarCarteraResumen = async (): Promise<CarteraFila[]> => {
  const client = getSupabaseClient();
  const pageSize = 1000;
  const out: CarteraFila[] = [];
  for (let page = 0; page < 60; page += 1) {
    const from = page * pageSize;
    // `.order('id')` obligatorio: ver nota en SupabaseCarteraAdapter.getCartera.
    const { data, error } = await client.from(SUPABASE_CARTERA_TABLE).select('pais, zona, sector').order('id', { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw new UsuariosError(`No se pudo leer cartera para el resumen de alcance: ${error.message}`);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    for (const r of rows) {
      out.push({
        pais: typeof r.pais === 'string' ? r.pais.trim() : '',
        zona: typeof r.zona === 'string' ? r.zona.trim() : '',
        sector: typeof r.sector === 'string' ? r.sector.trim() : ''
      });
    }
    if (rows.length < pageSize) break;
  }
  return out;
};

export const obtenerResumenAlcance = async (): Promise<{ totalUsuarios: number; items: AlcanceResumenItem[] }> => {
  const client = getSupabaseClient();

  const [{ data: perfiles, error: pErr }, { data: gestores, error: gErr }, { data: supGes, error: sgErr },
    { data: lidSup, error: lsErr }, { data: gerZona, error: gzErr }, { data: gesPZ, error: gpzErr },
    { data: supGerZona, error: sgzErr }, cartera] =
    await Promise.all([
      client.from('profiles').select('id, activo, role_id, roles ( clave, nivel )'),
      client.from('gestores').select('id, usuario_id, nombre_cartera').eq('activo', true),
      client.from('supervisor_gestor').select('supervisor_id, gestor_id').eq('activo', true),
      client.from('liderazgo_supervisor').select('liderazgo_id, supervisor_id').eq('activo', true),
      client.from('gerente_zona_zona').select('usuario_id, zona_id, pais, zonas ( nombre )').eq('activo', true),
      client.from('gestor_pais_zona').select('gestor_id, pais, zonas ( nombre )').eq('activo', true),
      client.from('supervisor_gerente_zona').select('supervisor_id, gerente_zona_id').eq('activo', true),
      cargarCarteraResumen()
    ]);

  if (pErr) throw new UsuariosError(`No se pudieron leer los usuarios: ${pErr.message}`);
  if (gErr) throw new UsuariosError(`No se pudieron leer los gestores: ${gErr.message}`);
  if (sgErr) throw new UsuariosError(`No se pudo leer supervisor_gestor: ${sgErr.message}`);
  if (lsErr) throw new UsuariosError(`No se pudo leer liderazgo_supervisor: ${lsErr.message}`);
  if (gzErr) throw new UsuariosError(`No se pudo leer gerente_zona_zona: ${gzErr.message}`);
  if (gpzErr) throw new UsuariosError(`No se pudo leer gestor_pais_zona: ${gpzErr.message}`);
  if (sgzErr) throw new UsuariosError(`No se pudo leer supervisor_gerente_zona: ${sgzErr.message}`);

  const perfilRows = (perfiles ?? []) as Array<{ id: string; activo: boolean; roles: { clave?: string; nivel?: number | null } | { clave?: string; nivel?: number | null }[] | null }>;
  const totalUsuarios = perfilRows.length;

  const gestorIdPorUsuario = new Map(((gestores ?? []) as Array<{ id: string; usuario_id: string | null }>).filter((g) => g.usuario_id).map((g) => [g.usuario_id as string, g.id]));

  const gestoresPorSupervisor = new Map<string, string[]>();
  for (const r of (supGes ?? []) as Array<{ supervisor_id: string; gestor_id: string }>) {
    const list = gestoresPorSupervisor.get(r.supervisor_id) ?? [];
    list.push(r.gestor_id);
    gestoresPorSupervisor.set(r.supervisor_id, list);
  }
  const supervisoresPorLiderazgo = new Map<string, string[]>();
  for (const r of (lidSup ?? []) as Array<{ liderazgo_id: string; supervisor_id: string }>) {
    const list = supervisoresPorLiderazgo.get(r.liderazgo_id) ?? [];
    list.push(r.supervisor_id);
    supervisoresPorLiderazgo.set(r.liderazgo_id, list);
  }
  const zonasPorGerente = new Map<string, Array<{ pais: string; zona: string }>>();
  for (const r of (gerZona ?? []) as Array<{ usuario_id: string; pais: string | null; zonas: { nombre?: string } | { nombre?: string }[] | null }>) {
    const z = Array.isArray(r.zonas) ? r.zonas[0] : r.zonas;
    const list = zonasPorGerente.get(r.usuario_id) ?? [];
    list.push({ pais: r.pais ?? '', zona: z?.nombre ?? '' });
    zonasPorGerente.set(r.usuario_id, list);
  }
  const zonasPorGestorId = new Map<string, Array<{ pais: string; zona: string }>>();
  for (const r of (gesPZ ?? []) as Array<{ gestor_id: string; pais: string | null; zonas: { nombre?: string } | { nombre?: string }[] | null }>) {
    const z = Array.isArray(r.zonas) ? r.zonas[0] : r.zonas;
    const list = zonasPorGestorId.get(r.gestor_id) ?? [];
    list.push({ pais: r.pais ?? '', zona: z?.nombre ?? '' });
    zonasPorGestorId.set(r.gestor_id, list);
  }
  const gerentesPorSupervisor = new Map<string, string[]>();
  for (const r of (supGerZona ?? []) as Array<{ supervisor_id: string; gerente_zona_id: string }>) {
    const list = gerentesPorSupervisor.get(r.supervisor_id) ?? [];
    list.push(r.gerente_zona_id);
    gerentesPorSupervisor.set(r.supervisor_id, list);
  }
  /** País/Zona asignados a un gerente de zona (profiles.id), para heredar hacia arriba. */
  const paisZonaDeGerente = (gerenteUserId: string): Array<{ pais: string; zona: string }> => zonasPorGerente.get(gerenteUserId) ?? [];

  const dedupPares = (pares: Array<{ pais: string; zona: string }>): Array<{ pais: string; zona: string }> => {
    const seen = new Set<string>();
    const out: Array<{ pais: string; zona: string }> = [];
    for (const p of pares) {
      const key = `${p.pais.toLowerCase()}||${p.zona.toLowerCase()}`;
      if (!p.pais || !p.zona || seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  };

  /** País/Zona alcanzado por un Gestor (gestores.id): EXCLUSIVAMENTE su
   *  gestor_pais_zona explícito — nunca coincidencia de nombre contra
   *  `cartera.gestor` (auditoría real: el puente de texto coincidía con
   *  0/18,107 filas reales; consistente con `ScopeFilter.applyScope`, cuya
   *  única fuente de autorización real es `paisZonaGrant`). */
  const paisZonaDeGestorId = (gestorId: string): Array<{ pais: string; zona: string }> =>
    dedupPares(zonasPorGestorId.get(gestorId) ?? []);

  const items: AlcanceResumenItem[] = perfilRows.map((p) => {
    const roleRaw = Array.isArray(p.roles) ? p.roles[0] : p.roles;
    const roleClave = roleRaw?.clave ?? null;
    const nivel = roleRaw?.nivel ?? null;
    const base: AlcanceResumenItem = { userId: p.id, roleClave, nivel, totalSupervisores: null, totalGestores: null, totalZonas: null, totalSectores: null, paises: [], zonas: [] };

    if (roleClave === 'liderazgo') {
      const supervisorIds = uniq(supervisoresPorLiderazgo.get(p.id) ?? []);
      const gestorIds = uniq(supervisorIds.flatMap((sid) => gestoresPorSupervisor.get(sid) ?? []));
      const pzGestores = gestorIds.flatMap((gid) => paisZonaDeGestorId(gid));
      const gerenteIds = uniq(supervisorIds.flatMap((sid) => gerentesPorSupervisor.get(sid) ?? []));
      const pzGerentes = gerenteIds.flatMap((gid) => paisZonaDeGerente(gid));
      const pz = dedupPares([...pzGestores, ...pzGerentes]);
      return {
        ...base, totalSupervisores: supervisorIds.length, totalGestores: gestorIds.length,
        paises: uniq(pz.map((z) => z.pais)),
        zonas: uniq(pz.map((z) => z.zona))
      };
    }
    if (roleClave === 'supervisor') {
      const gestorIds = uniq(gestoresPorSupervisor.get(p.id) ?? []);
      const pzGestores = gestorIds.flatMap((gid) => paisZonaDeGestorId(gid));
      const gerenteIds = uniq(gerentesPorSupervisor.get(p.id) ?? []);
      const pzGerentes = gerenteIds.flatMap((gid) => paisZonaDeGerente(gid));
      const pz = dedupPares([...pzGestores, ...pzGerentes]);
      return {
        ...base, totalGestores: gestorIds.length,
        paises: uniq(pz.map((z) => z.pais)),
        zonas: uniq(pz.map((z) => z.zona))
      };
    }
    if (roleClave === 'gestor') {
      const gestorId = gestorIdPorUsuario.get(p.id);
      const pz = gestorId ? paisZonaDeGestorId(gestorId) : [];
      return { ...base, totalZonas: uniq(pz.map((z) => z.zona)).length, paises: uniq(pz.map((z) => z.pais)), zonas: uniq(pz.map((z) => z.zona)) };
    }
    if (roleClave === 'gerente_zona') {
      const asignadas = zonasPorGerente.get(p.id) ?? [];
      const paisZonaSet = new Set(asignadas.map((a) => `${a.pais}||${a.zona}`));
      const filas = cartera.filter((f) => paisZonaSet.has(`${f.pais}||${f.zona}`));
      return { ...base, totalZonas: uniq(asignadas.map((a) => a.zona)).length, totalSectores: uniq(filas.map((f) => f.sector)).length, paises: uniq(asignadas.map((a) => a.pais)), zonas: uniq(asignadas.map((a) => a.zona)) };
    }
    return base;
  });

  return { totalUsuarios, items };
};

export const buscarPerfilPorEmail = async (email: string): Promise<{ id: string; roleId: string | null; roleClave: string | null } | null> => {
  const { data } = await getSupabaseClient()
    .from('profiles')
    .select('id, role_id, roles ( clave )')
    .ilike('email', normEmail(email))
    .limit(1);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return { id: String(row.id), roleId: (row.role_id as string | null) ?? null, roleClave: roleRefOf(row.roles)?.clave ?? null };
};

