import { getSupabaseClient } from '../config/supabaseClient';
import { SUPABASE_CARTERA_TABLE } from '../config/env';
import { registrarAuditoria } from './AuditoriaService';
import { generarPasswordTemporal } from '../utils/password';
import { describirErrorAuth, esUsuarioAuthInexistente } from '../utils/authErrors';
import {
  SHEET_USUARIOS, SHEET_LIDERAZGO_SUPERVISOR, SHEET_SUPERVISOR_GESTOR, SHEET_SUPERVISOR_GERENTE,
  SHEET_GESTOR_PAIS_ZONA, SHEET_GERENTE_PAIS_ZONA, idPaisZonaDe,
  type ParsedWorkbook, type FilaUsuarioImport, type FilaRelacionImport, type FilaPaisZonaImport
} from '../utils/usuariosExcel';

/**
 * FASE 1 — Módulo Usuarios (administración global).
 *
 * Reutiliza el modelo de identidad existente (profiles/roles) y las relaciones de
 * alcance (gestores/supervisor_gestor/gerente_zona_zona) SIN crear un sistema
 * paralelo de auth/permisos/scope. La creación se hace por invitación de correo
 * con la Admin API de Supabase (service role); nunca se generan contraseñas.
 *
 * Puente de Scope del gestor: `gestores.nombre_cartera` DEBE coincidir con
 * `cartera.gestor`. Por eso el catálogo de `nombre_cartera` proviene de los
 * valores reales de `cartera.gestor` (no texto libre).
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
  /** Para rol gerente_zona: País/Zona explícitos (Nivel 5 -> Nivel 6). */
  paisZona: PaisZona[];
  /** Para rol gestor: País/Zona explícitos, narrowing ADICIONAL opcional (Nivel 4 -> Nivel 6). */
  gestorPaisZona: PaisZona[];
}

export interface Catalogos {
  roles: Array<{ id: string; clave: string; nombre: string; nivel: number | null }>;
  zonas: Array<{ id: string; nombre: string; codigo: string | null }>;
  gestores: Array<{ id: string; nombreCartera: string | null; usuarioId: string | null }>;
  /** Valores distintos reales de cartera.gestor (para asignar nombre_cartera). */
  carteraGestores: string[];
  /** Perfiles con rol supervisor (activos), para asignar Liderazgo -> Supervisor. */
  supervisores: Array<{ id: string; nombre: string; apellido: string | null }>;
  /** Perfiles con rol gerente_zona (activos), para asignar Supervisor -> Gerente de zona. */
  gerentesZona: Array<{ id: string; nombre: string; apellido: string | null }>;
  /** Pares País/Zona REALES existentes en cartera (nunca inventados), con su zonas.id. */
  carteraPaisZona: PaisZona[];
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
  // la fuente de autorización (Grupos y Niveles / ScopeService) y se usan de lleno.
  nombreCartera?: string | null;
  /** Supervisor -> Gestores asignados. */
  gestorIds?: string[];
  /** Supervisor -> Gerentes de zona asignados (Nivel 3 -> Nivel 5). */
  gerenteZonaIds?: string[];
  /** Liderazgo -> Supervisores asignados. */
  supervisorIds?: string[];
  /** Gerente de zona -> zonas (compat; se ignora si viene `paisZona`). */
  zonaIds?: string[];
  /** Gerente de zona -> País/Zona explícitos (autoritativo). */
  paisZona?: Array<{ zonaId: string; pais: string }>;
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
  const { data: gerRows } = await client.from('gerente_zona_zona').select('zona_id, pais, zonas ( nombre )').eq('usuario_id', id).eq('activo', true);
  const { data: gestorZonaRows } = gestorId
    ? await client.from('gestor_pais_zona').select('zona_id, pais, zonas ( nombre )').eq('gestor_id', gestorId).eq('activo', true)
    : { data: [] as unknown[] };

  const paisZonaDe = (rows: unknown[]): PaisZona[] =>
    (rows as Array<{ zona_id: string; pais: string | null; zonas: { nombre?: string } | { nombre?: string }[] | null }>).map((r) => {
      const z = Array.isArray(r.zonas) ? r.zonas[0] : r.zonas;
      return { zonaId: r.zona_id, zona: z?.nombre ?? '', pais: r.pais ?? '' };
    });

  return {
    ...base,
    nombreCartera: ((gestorRow ?? [])[0] as { nombre_cartera?: string } | undefined)?.nombre_cartera ?? null,
    gestorIds: ((supRows ?? []) as Array<{ gestor_id: string }>).map((r) => r.gestor_id),
    gerenteZonaIds: ((supGerRows ?? []) as Array<{ gerente_zona_id: string }>).map((r) => r.gerente_zona_id),
    supervisorIds: ((liderRows ?? []) as Array<{ supervisor_id: string }>).map((r) => r.supervisor_id),
    zonaIds: ((gerRows ?? []) as Array<{ zona_id: string }>).map((r) => r.zona_id),
    paisZona: paisZonaDe(gerRows ?? []),
    gestorPaisZona: paisZonaDe(gestorZonaRows ?? [])
  };
};

/** Valores distintos de cartera.gestor (paginado, sólo la columna). */
const distinctCarteraGestores = async (): Promise<string[]> => {
  const client = getSupabaseClient();
  const pageSize = 1000;
  const set = new Set<string>();
  for (let page = 0; page < 60; page += 1) {
    const from = page * pageSize;
    const { data, error } = await client
      .from(SUPABASE_CARTERA_TABLE)
      .select('gestor')
      .range(from, from + pageSize - 1);
    if (error) throw new UsuariosError(`No se pudo leer el catálogo de gestores de cartera: ${error.message}`);
    const rows = (data ?? []) as Array<{ gestor?: unknown }>;
    for (const r of rows) {
      const g = r.gestor;
      if (typeof g === 'string' && g.trim()) set.add(g.trim());
    }
    if (rows.length < pageSize) break;
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
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
    const { data, error } = await client.from(SUPABASE_CARTERA_TABLE).select('pais, zona').range(from, from + pageSize - 1);
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

export const obtenerCatalogos = async (): Promise<Catalogos> => {
  const client = getSupabaseClient();

  const [{ data: roles, error: rErr }, { data: zonas, error: zErr }, { data: gestores, error: gErr }, carteraGestores, carteraPaisZona,
    { data: supervisores, error: sErr }, { data: gerentesZona, error: gzErr }] =
    await Promise.all([
      client.from('roles').select('id, clave, nombre, nivel').order('nivel', { ascending: true, nullsFirst: false }),
      client.from('zonas').select('id, nombre, codigo').eq('activo', true).order('nombre', { ascending: true }),
      client.from('gestores').select('id, nombre_cartera, usuario_id').eq('activo', true),
      distinctCarteraGestores(),
      distinctCarteraPaisZona(),
      client.from('profiles').select('id, nombre, apellido, roles!inner ( clave )').eq('activo', true).eq('roles.clave', 'supervisor'),
      client.from('profiles').select('id, nombre, apellido, roles!inner ( clave )').eq('activo', true).eq('roles.clave', 'gerente_zona')
    ]);

  if (rErr) throw new UsuariosError(`No se pudieron leer los roles: ${rErr.message}`);
  if (zErr) throw new UsuariosError(`No se pudieron leer las zonas: ${zErr.message}`);
  if (gErr) throw new UsuariosError(`No se pudieron leer los gestores: ${gErr.message}`);
  if (sErr) throw new UsuariosError(`No se pudieron leer los supervisores: ${sErr.message}`);
  if (gzErr) throw new UsuariosError(`No se pudieron leer los gerentes de zona: ${gzErr.message}`);

  return {
    roles: ((roles ?? []) as Array<Record<string, unknown>>).map((r) => ({ id: String(r.id), clave: String(r.clave), nombre: String(r.nombre), nivel: (r.nivel as number | null) ?? null })),
    zonas: ((zonas ?? []) as Array<Record<string, unknown>>).map((z) => ({ id: String(z.id), nombre: String(z.nombre), codigo: (z.codigo as string | null) ?? null })),
    gestores: ((gestores ?? []) as Array<Record<string, unknown>>).map((g) => ({ id: String(g.id), nombreCartera: (g.nombre_cartera as string | null) ?? null, usuarioId: (g.usuario_id as string | null) ?? null })),
    carteraGestores,
    carteraPaisZona,
    supervisores: ((supervisores ?? []) as Array<Record<string, unknown>>).map((s) => ({ id: String(s.id), nombre: String(s.nombre ?? ''), apellido: (s.apellido as string | null) ?? null })),
    gerentesZona: ((gerentesZona ?? []) as Array<Record<string, unknown>>).map((s) => ({ id: String(s.id), nombre: String(s.nombre ?? ''), apellido: (s.apellido as string | null) ?? null }))
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
    await client.from('gestores').update({ usuario_id: null }).eq('usuario_id', userId);
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
    paisZona?: Array<{ zonaId: string; pais: string }>;
    gestorPaisZona?: Array<{ zonaId: string; pais: string }>;
  }
): Promise<void> => {
  await limpiarRelacionesAjenas(userId, roleClave);
  const client = getSupabaseClient();

  // gestor → gestores.usuario_id + nombre_cartera (puente con cartera.gestor)
  let gestorIdVinculado: string | null = null;
  if (roleClave === 'gestor' && input.nombreCartera) {
    // Desvincula cualquier gestor previo de este usuario y (re)asigna el elegido.
    await client.from('gestores').update({ usuario_id: null }).eq('usuario_id', userId);
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
  }

  // gestor → País/Zona explícitos (narrowing ADICIONAL opcional sobre nombre_cartera)
  if (roleClave === 'gestor' && input.gestorPaisZona && gestorIdVinculado) {
    await client.from('gestor_pais_zona').delete().eq('gestor_id', gestorIdVinculado);
    if (input.gestorPaisZona.length > 0) {
      const rows = input.gestorPaisZona.map((pz) => ({ gestor_id: gestorIdVinculado, zona_id: pz.zonaId, pais: pz.pais, fecha_inicio: hoy(), fecha_fin: null, activo: true }));
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
      const rows = input.paisZona.map((pz) => ({ usuario_id: userId, zona_id: pz.zonaId, pais: pz.pais, fecha_inicio: hoy(), fecha_fin: null, activo: true }));
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
  await client.from('gestores').update({ usuario_id: null }).eq('usuario_id', id);
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
 * CARGA MASIVA DE USUARIOS + GRUPOS Y NIVELES (módulo Repositorio)
 * Reutiliza crearUsuario/actualizarUsuario (Fase 1: identidad/perfil) y agrega
 * una Fase 2 que sincroniza por completo las relaciones de alcance desde las
 * hojas normalizadas (liderazgo_supervisor, supervisor_gestor,
 * supervisor_gerente_zona, gestor_pais_zona, gerente_zona_zona). NUNCA usa
 * ASIGNACION: las relaciones alimentan directamente a ScopeService.
 * ========================================================================== */

const ACCIONES_VALIDAS = ['CREAR', 'ACTUALIZAR', 'ACTIVAR', 'DESACTIVAR'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normEmail = (email: string): string => email.trim().toLowerCase();
const paisZonaKey = (pais: string, zona: string): string => `${pais.trim().toLowerCase()}||${zona.trim().toLowerCase()}`;

export interface PreviewItem {
  hoja: string;
  fila: number;
  accion: string;
  email: string;
  rol: string;
  valor?: string;
  /** Columna que originó el error (vacío si la fila es VALIDO). */
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
  activaciones: number;
  desactivaciones: number;
  relacionesCreadas: number;
  relacionesVigentes: number;
  relacionesEliminadas: number;
}

export interface ResultadoAplicarItem {
  hoja: string;
  fila: number;
  accion: string;
  email: string;
  /** Solo disponibles para filas de la hoja USUARIOS; ausentes en filas de relación. */
  nombre?: string;
  apellido?: string;
  rol: string;
  /** Columna que originó el error (vacío si resultado=OK). */
  columna: string;
  resultado: 'OK' | 'ERROR';
  /** Solo para CREAR; vacío en el resto. No se persiste. */
  password: string;
  mensaje: string;
}

interface PerfilExistente { id: string; roleClave: string | null; activo: boolean; }

interface ContextoMasivo {
  rolesPorClave: Map<string, { id: string; nivel: number | null }>;
  carteraGestores: Set<string>;
  carteraPaisZona: Set<string>;
  /** ID_PAIS_ZONA ("102GUATEMALA": ZONA + nombre completo del País, sin
   *  separador ni abreviatura) -> par real (Sección 4-8), construido con la
   *  MISMA función (`idPaisZonaDe`) que genera la plantilla: nunca se infiere
   *  País desde Zona, y el mismo número de Zona en países distintos produce
   *  IDs distintos (ej. "108GUATEMALA" ≠ "108REPUBLICA DOMINICANA"). Clave
   *  normalizada en mayúsculas para que la comparación no dependa de cómo
   *  haya tecleado el valor la persona en Excel. */
  paisZonaPorId: Map<string, PaisZona>;
  zonaIdPorNombre: Map<string, string>;
  perfilesPorEmail: Map<string, PerfilExistente>;
}

/** Carga TODO el contexto necesario para validar y aplicar el workbook completo
 *  en consultas por lote (evita N+1): roles, catálogo real de cartera
 *  (gestores y pares País-Zona) y los perfiles YA EXISTENTES para cada email
 *  referenciado en cualquier hoja (usuarios o relaciones). */
const cargarContextoMasivo = async (parsed: ParsedWorkbook): Promise<ContextoMasivo> => {
  const client = getSupabaseClient();
  const catalogos = await obtenerCatalogos();

  const emails = new Set<string>();
  const add = (v: string) => { const e = normEmail(v); if (e) emails.add(e); };
  parsed.usuarios.forEach((f) => add(f.email));
  parsed.liderazgoSupervisor.forEach((f) => { add(f.propietario); add(f.relacionado); });
  parsed.supervisorGestor.forEach((f) => { add(f.propietario); add(f.relacionado); });
  parsed.supervisorGerente.forEach((f) => { add(f.propietario); add(f.relacionado); });
  parsed.gestorPaisZona.forEach((f) => add(f.email));
  parsed.gerentePaisZona.forEach((f) => add(f.email));

  const perfilesPorEmail = new Map<string, PerfilExistente>();
  if (emails.size > 0) {
    const { data, error } = await client.from('profiles').select('id, email, activo, roles ( clave )').in('email', Array.from(emails));
    if (error) throw new UsuariosError(`No se pudieron leer los usuarios existentes: ${error.message}`);
    ((data ?? []) as Array<Record<string, unknown>>).forEach((p) => {
      perfilesPorEmail.set(normEmail(String(p.email ?? '')), { id: String(p.id), roleClave: roleRefOf(p.roles)?.clave ?? null, activo: Boolean(p.activo) });
    });
  }

  const zonaIdPorNombre = new Map<string, string>();
  catalogos.zonas.forEach((z) => zonaIdPorNombre.set(z.nombre.trim().toLowerCase(), z.id));

  return {
    rolesPorClave: new Map(catalogos.roles.map((r) => [r.clave, { id: r.id, nivel: r.nivel }])),
    carteraGestores: new Set(catalogos.carteraGestores.map((g) => g.toLowerCase())),
    carteraPaisZona: new Set(catalogos.carteraPaisZona.map((pz) => paisZonaKey(pz.pais, pz.zona))),
    paisZonaPorId: new Map(catalogos.carteraPaisZona.map((pz) => [idPaisZonaDe(pz.pais, pz.zona).toUpperCase(), pz])),
    zonaIdPorNombre,
    perfilesPorEmail
  };
};

/** Resuelve ID_PAIS_ZONA -> PAIS+ZONA en las filas de una hoja País-Zona,
 *  ANTES de validar/aplicar (Sección 5/13): permite usar el identificador de
 *  la hoja PAIS_ZONA en vez de escribir País y Zona a mano. Muta las filas en
 *  el mismo `ParsedWorkbook` que usan tanto validarWorkbook como
 *  aplicarWorkbook, así ambos ven exactamente el mismo PAIS/ZONA resuelto
 *  (nunca dos resoluciones separadas que puedan divergir). Si ID_PAIS_ZONA
 *  viene vacío, no toca nada (compatibilidad con PAIS/ZONA directos, Sección 6). */
const resolverIdsPaisZona = (filas: FilaPaisZonaImport[], paisZonaPorId: Map<string, PaisZona>): void => {
  filas.forEach((f) => {
    const id = f.idPaisZona.trim().toUpperCase();
    if (!id) return;
    const resuelto = paisZonaPorId.get(id);
    if (resuelto) {
      f.pais = resuelto.pais;
      f.zona = resuelto.zona;
    } else {
      f.idPaisZonaInvalido = true;
    }
  });
};

/** Rol/estado EFECTIVO de un email tras aplicar (hipotéticamente) el archivo:
 *  prioriza lo declarado en la hoja USUARIOS (si el email aparece ahí) sobre
 *  lo que ya existe en Supabase. `rol=null` ⇒ el email no existe en ningún lado
 *  (ni en el archivo ni en la base) — error de referencia inexistente.
 *  `usuariosInvalidos` son los emails cuya PROPIA fila CREAR en USUARIOS tiene
 *  un error (Sección 3): ese usuario NUEVO no se creará, así que cualquier
 *  relación que dependa de él NO puede darse por válida todavía — se marca
 *  `invalido: true` en vez de confiar en el rol declarado. Un error en una
 *  fila ACTUALIZAR/ACTIVAR/DESACTIVAR no aplica aquí: el usuario YA EXISTE y
 *  esa fila con error simplemente no cambia nada (el rol/estado ya vigente en
 *  Supabase sigue siendo válido para las relaciones). */
const rolEfectivo = (
  email: string,
  usuariosPorEmail: Map<string, FilaUsuarioImport>,
  ctx: ContextoMasivo,
  usuariosInvalidos: Set<string>
): { rol: string | null; activo: boolean | null; invalido: boolean } => {
  const fila = usuariosPorEmail.get(email);
  const existente = ctx.perfilesPorEmail.get(email);
  if (fila && usuariosInvalidos.has(email) && fila.accion.toUpperCase() === 'CREAR') {
    return { rol: existente?.roleClave ?? null, activo: existente?.activo ?? null, invalido: true };
  }
  if (fila) {
    const accion = fila.accion.toUpperCase();
    const activoDeclarado = fila.activo ? fila.activo.toUpperCase() !== 'NO' : undefined;
    if (accion === 'CREAR' || accion === 'ACTUALIZAR') {
      const rol = fila.rol || existente?.roleClave || null;
      const activo = activoDeclarado !== undefined ? activoDeclarado : (accion === 'CREAR' ? true : (existente?.activo ?? true));
      return { rol, activo, invalido: false };
    }
    if (accion === 'ACTIVAR') return { rol: existente?.roleClave ?? null, activo: true, invalido: false };
    if (accion === 'DESACTIVAR') return { rol: existente?.roleClave ?? null, activo: false, invalido: false };
  }
  if (existente) return { rol: existente.roleClave, activo: existente.activo, invalido: false };
  return { rol: null, activo: null, invalido: false };
};

const validarNivel = (fila: FilaUsuarioImport, rolInfo: { nivel: number | null }): string => {
  if (!fila.nivel.trim()) return '';
  const n = Number(fila.nivel);
  if (!Number.isFinite(n)) return `NIVEL inválido: "${fila.nivel}".`;
  if (rolInfo.nivel !== null && n !== rolInfo.nivel) return `NIVEL (${n}) no corresponde al ROL "${fila.rol}" (Nivel oficial ${rolInfo.nivel}).`;
  return '';
};

interface ResultadoValidacion { mensaje: string; columna: string; }
const ok: ResultadoValidacion = { mensaje: '', columna: '' };

/** Valida una fila de la hoja USUARIOS SIN tocar la BD. */
const validarFilaUsuario = (fila: FilaUsuarioImport, ctx: ContextoMasivo, vistos: Set<string>): ResultadoValidacion => {
  const accion = fila.accion.toUpperCase();
  if (!ACCIONES_VALIDAS.includes(accion)) return { mensaje: `ACCION no válida: "${fila.accion}".`, columna: 'ACCION' };

  const email = normEmail(fila.email);
  if (!email) return { mensaje: 'EMAIL es obligatorio.', columna: 'EMAIL' };
  if (!EMAIL_RE.test(email)) return { mensaje: 'EMAIL inválido.', columna: 'EMAIL' };
  if (vistos.has(email)) return { mensaje: 'EMAIL duplicado dentro de la hoja USUARIOS.', columna: 'EMAIL' };

  const existente = ctx.perfilesPorEmail.get(email);

  if (accion === 'CREAR') {
    if (existente) return { mensaje: 'El usuario ya existe (email duplicado).', columna: 'EMAIL' };
    if (!fila.nombre.trim()) return { mensaje: 'NOMBRE es obligatorio.', columna: 'NOMBRE' };
    if (!fila.apellido.trim()) return { mensaje: 'APELLIDO es obligatorio.', columna: 'APELLIDO' };
    if (!fila.rol) return { mensaje: 'ROL es obligatorio.', columna: 'ROL' };
    const rolInfo = ctx.rolesPorClave.get(fila.rol);
    if (!rolInfo) return { mensaje: `ROL no válido: "${fila.rol}".`, columna: 'ROL' };
    const nivelErr = validarNivel(fila, rolInfo);
    if (nivelErr) return { mensaje: nivelErr, columna: 'NIVEL' };
    if (fila.rol === 'gestor') {
      if (!fila.nombreCartera.trim()) return { mensaje: 'NOMBRE_CARTERA es obligatorio para ROL=gestor.', columna: 'NOMBRE_CARTERA' };
      if (!ctx.carteraGestores.has(fila.nombreCartera.trim().toLowerCase())) {
        return { mensaje: `NOMBRE_CARTERA no existe en cartera.gestor: "${fila.nombreCartera}".`, columna: 'NOMBRE_CARTERA' };
      }
    }
    return ok;
  }

  if (!existente) return { mensaje: 'Usuario no encontrado.', columna: 'EMAIL' };
  if (accion === 'ACTUALIZAR' && fila.rol) {
    const rolInfo = ctx.rolesPorClave.get(fila.rol);
    if (!rolInfo) return { mensaje: `ROL no válido: "${fila.rol}".`, columna: 'ROL' };
    const nivelErr = validarNivel(fila, rolInfo);
    if (nivelErr) return { mensaje: nivelErr, columna: 'NIVEL' };
    if (fila.rol === 'gestor' && fila.nombreCartera.trim() && !ctx.carteraGestores.has(fila.nombreCartera.trim().toLowerCase())) {
      return { mensaje: `NOMBRE_CARTERA no existe en cartera.gestor: "${fila.nombreCartera}".`, columna: 'NOMBRE_CARTERA' };
    }
  }
  return ok;
};

interface RelacionDef { hoja: string; colPropietario: string; colRelacionado: string; rolPropietario: string; rolRelacionado: string; }
const DEF_LIDERAZGO_SUPERVISOR: RelacionDef = { hoja: SHEET_LIDERAZGO_SUPERVISOR, colPropietario: 'LIDERAZGO_EMAIL', colRelacionado: 'SUPERVISOR_EMAIL', rolPropietario: 'liderazgo', rolRelacionado: 'supervisor' };
const DEF_SUPERVISOR_GESTOR: RelacionDef = { hoja: SHEET_SUPERVISOR_GESTOR, colPropietario: 'SUPERVISOR_EMAIL', colRelacionado: 'GESTOR_EMAIL', rolPropietario: 'supervisor', rolRelacionado: 'gestor' };
const DEF_SUPERVISOR_GERENTE: RelacionDef = { hoja: SHEET_SUPERVISOR_GERENTE, colPropietario: 'SUPERVISOR_EMAIL', colRelacionado: 'GERENTE_ZONA_EMAIL', rolPropietario: 'supervisor', rolRelacionado: 'gerente_zona' };

/** Valida una hoja de relación simple (1 fila = 1 par propietario/relacionado). */
const validarFilasRelacion = (
  filas: FilaRelacionImport[], def: RelacionDef, ctx: ContextoMasivo, usuariosPorEmail: Map<string, FilaUsuarioImport>,
  usuariosInvalidos: Set<string>
): PreviewItem[] => {
  const vistos = new Set<string>();
  return filas.map((f) => {
    const propietario = normEmail(f.propietario);
    const relacionado = normEmail(f.relacionado);
    let mensaje = ''; let columna = '';
    if (!propietario) { mensaje = `${def.colPropietario} es obligatorio.`; columna = def.colPropietario; }
    else if (!relacionado) { mensaje = `${def.colRelacionado} es obligatorio.`; columna = def.colRelacionado; }
    else if (propietario === relacionado) { mensaje = 'Referencia circular: un usuario no puede asignarse a sí mismo.'; columna = def.colRelacionado; }
    if (!mensaje) {
      const key = `${propietario}||${relacionado}`;
      if (vistos.has(key)) { mensaje = 'Fila duplicada.'; columna = `${def.colPropietario}/${def.colRelacionado}`; }
      vistos.add(key);
    }
    if (!mensaje) {
      const efP = rolEfectivo(propietario, usuariosPorEmail, ctx, usuariosInvalidos);
      if (efP.invalido) { mensaje = `${f.propietario} tiene errores en la hoja USUARIOS: corrígelos antes de asignar relaciones.`; columna = def.colPropietario; }
      else if (!efP.rol) { mensaje = `${def.colPropietario} inexistente: "${f.propietario}".`; columna = def.colPropietario; }
      else if (efP.rol !== def.rolPropietario) { mensaje = `${f.propietario} no tiene rol "${def.rolPropietario}" (relación jerárquica inválida; tiene "${efP.rol}").`; columna = def.colPropietario; }
      else if (efP.activo === false) { mensaje = `${f.propietario} quedará inactivo: no se le pueden asignar relaciones.`; columna = def.colPropietario; }
    }
    if (!mensaje) {
      const efR = rolEfectivo(relacionado, usuariosPorEmail, ctx, usuariosInvalidos);
      if (efR.invalido) { mensaje = `${f.relacionado} tiene errores en la hoja USUARIOS: corrígelos antes de asignar relaciones.`; columna = def.colRelacionado; }
      else if (!efR.rol) { mensaje = `${def.colRelacionado} inexistente: "${f.relacionado}".`; columna = def.colRelacionado; }
      else if (efR.rol !== def.rolRelacionado) { mensaje = `${f.relacionado} no tiene rol "${def.rolRelacionado}" (relación jerárquica inválida; tiene "${efR.rol}").`; columna = def.colRelacionado; }
      else if (efR.activo === false) { mensaje = `${f.relacionado} quedará inactivo: no se le pueden asignar relaciones.`; columna = def.colRelacionado; }
    }
    return { hoja: f.hoja, fila: f.fila, accion: '', email: f.propietario, rol: '', valor: f.relacionado, columna, estado: mensaje ? 'ERROR' : 'VALIDO', mensaje: mensaje || 'OK' } as PreviewItem;
  });
};

/** Valida una hoja de País-Zona (Gestor o Gerente de zona): PAR obligatorio, nunca listas cruzadas. */
const validarFilasPaisZona = (
  filas: FilaPaisZonaImport[], colEmail: string, rolEsperado: string, ctx: ContextoMasivo, usuariosPorEmail: Map<string, FilaUsuarioImport>,
  usuariosInvalidos: Set<string>
): PreviewItem[] => {
  const vistos = new Set<string>();
  return filas.map((f) => {
    const email = normEmail(f.email);
    let mensaje = ''; let columna = '';
    if (f.idPaisZonaInvalido) { mensaje = `ID_PAIS_ZONA no válido: "${f.idPaisZona}".`; columna = 'ID_PAIS_ZONA'; }
    else if (!email) { mensaje = `${colEmail} es obligatorio.`; columna = colEmail; }
    else if (!f.pais.trim()) { mensaje = 'PAIS es obligatorio (o indique ID_PAIS_ZONA).'; columna = 'PAIS'; }
    else if (!f.zona.trim()) { mensaje = 'ZONA es obligatorio (o indique ID_PAIS_ZONA).'; columna = 'ZONA'; }
    if (!mensaje) {
      const key = `${email}||${paisZonaKey(f.pais, f.zona)}`;
      if (vistos.has(key)) { mensaje = 'Fila duplicada.'; columna = 'PAIS/ZONA'; }
      vistos.add(key);
    }
    if (!mensaje && !ctx.carteraPaisZona.has(paisZonaKey(f.pais, f.zona))) {
      // Cubre los 3 casos: Zona inexistente en ningún país, Zona que pertenece
      // EXCLUSIVAMENTE a otro país, o Zona genuinamente inexistente en cartera:
      // en los 3, el PAR exacto (País+Zona) no existe en carteraPaisZona.
      mensaje = `Combinación País-Zona inexistente en cartera: "${f.pais} / ${f.zona}".`;
      columna = 'PAIS/ZONA';
    }
    if (!mensaje) {
      const ef = rolEfectivo(email, usuariosPorEmail, ctx, usuariosInvalidos);
      if (ef.invalido) { mensaje = `${f.email} tiene errores en la hoja USUARIOS: corrígelos antes de asignar relaciones.`; columna = colEmail; }
      else if (!ef.rol) { mensaje = `${colEmail} inexistente: "${f.email}".`; columna = colEmail; }
      else if (ef.rol !== rolEsperado) { mensaje = `${f.email} no tiene rol "${rolEsperado}" (relación jerárquica inválida; tiene "${ef.rol}").`; columna = colEmail; }
      else if (ef.activo === false) { mensaje = `${f.email} quedará inactivo: no se le pueden asignar relaciones.`; columna = colEmail; }
    }
    return { hoja: f.hoja, fila: f.fila, accion: '', email: f.email, rol: '', valor: `${f.pais} / ${f.zona}`, columna, estado: mensaje ? 'ERROR' : 'VALIDO', mensaje: mensaje || 'OK' } as PreviewItem;
  });
};

/** Valida TODAS las hojas presentes en el workbook (sin tocar la BD). */
const validarTodo = async (parsed: ParsedWorkbook): Promise<{ ctx: ContextoMasivo; usuariosPorEmail: Map<string, FilaUsuarioImport>; itemsUsuarios: PreviewItem[]; itemsLid: PreviewItem[]; itemsSupGes: PreviewItem[]; itemsSupGer: PreviewItem[]; itemsGesPz: PreviewItem[]; itemsGerPz: PreviewItem[]; }> => {
  const ctx = await cargarContextoMasivo(parsed);
  const usuariosPorEmail = new Map<string, FilaUsuarioImport>();
  parsed.usuarios.forEach((f) => { const e = normEmail(f.email); if (e) usuariosPorEmail.set(e, f); });

  // Resuelve ID_PAIS_ZONA -> PAIS/ZONA ANTES de validar relaciones (Sección 13:
  // EXCEL -> VALIDACIÓN -> RESOLVER ID_PAIS_ZONA -> VALIDAR RELACIONES -> ...),
  // mutando `parsed` para que aplicarWorkbook (que reutiliza este mismo objeto)
  // vea el mismo PAIS/ZONA ya resuelto.
  resolverIdsPaisZona(parsed.gestorPaisZona, ctx.paisZonaPorId);
  resolverIdsPaisZona(parsed.gerentePaisZona, ctx.paisZonaPorId);

  const vistos = new Set<string>();
  const itemsUsuarios: PreviewItem[] = parsed.usuarios.map((f) => {
    const { mensaje, columna } = validarFilaUsuario(f, ctx, vistos);
    const email = normEmail(f.email);
    if (email) vistos.add(email);
    return { hoja: SHEET_USUARIOS, fila: f.fila, accion: f.accion.toUpperCase(), email: f.email.trim(), rol: f.rol, columna, estado: mensaje ? 'ERROR' : 'VALIDO', mensaje: mensaje || 'OK' } as PreviewItem;
  });

  // Emails cuya PROPIA fila en USUARIOS tiene error (Sección 3): una relación
  // que dependa de ellos nunca se cuenta como válida por sí sola.
  const usuariosInvalidos = new Set(itemsUsuarios.filter((it) => it.estado === 'ERROR').map((it) => normEmail(it.email)));

  return {
    ctx, usuariosPorEmail, itemsUsuarios,
    itemsLid: parsed.hojasPresentes.has(SHEET_LIDERAZGO_SUPERVISOR) ? validarFilasRelacion(parsed.liderazgoSupervisor, DEF_LIDERAZGO_SUPERVISOR, ctx, usuariosPorEmail, usuariosInvalidos) : [],
    itemsSupGes: parsed.hojasPresentes.has(SHEET_SUPERVISOR_GESTOR) ? validarFilasRelacion(parsed.supervisorGestor, DEF_SUPERVISOR_GESTOR, ctx, usuariosPorEmail, usuariosInvalidos) : [],
    itemsSupGer: parsed.hojasPresentes.has(SHEET_SUPERVISOR_GERENTE) ? validarFilasRelacion(parsed.supervisorGerente, DEF_SUPERVISOR_GERENTE, ctx, usuariosPorEmail, usuariosInvalidos) : [],
    itemsGesPz: parsed.hojasPresentes.has(SHEET_GESTOR_PAIS_ZONA) ? validarFilasPaisZona(parsed.gestorPaisZona, 'GESTOR_EMAIL', 'gestor', ctx, usuariosPorEmail, usuariosInvalidos) : [],
    itemsGerPz: parsed.hojasPresentes.has(SHEET_GERENTE_PAIS_ZONA) ? validarFilasPaisZona(parsed.gerentePaisZona, 'GERENTE_ZONA_EMAIL', 'gerente_zona', ctx, usuariosPorEmail, usuariosInvalidos) : []
  };
};

const contarResumen = (grupos: PreviewItem[][]): ResumenImport => {
  const resumen: ResumenImport = { total: 0, validas: 0, errores: 0, creaciones: 0, actualizaciones: 0, activaciones: 0, desactivaciones: 0, relacionesCreadas: 0, relacionesVigentes: 0, relacionesEliminadas: 0 };
  grupos.flat().forEach((it) => {
    resumen.total += 1;
    if (it.estado === 'VALIDO') {
      resumen.validas += 1;
      if (it.hoja === SHEET_USUARIOS) {
        if (it.accion === 'CREAR') resumen.creaciones += 1;
        else if (it.accion === 'ACTUALIZAR') resumen.actualizaciones += 1;
        else if (it.accion === 'ACTIVAR') resumen.activaciones += 1;
        else if (it.accion === 'DESACTIVAR') resumen.desactivaciones += 1;
      }
    } else {
      resumen.errores += 1;
    }
  });
  return resumen;
};

/** Valida el archivo completo SIN modificar Supabase (Sección 7). */
export const validarWorkbook = async (parsed: ParsedWorkbook): Promise<{ items: PreviewItem[]; resumen: ResumenImport }> => {
  const r = await validarTodo(parsed);
  const grupos = [r.itemsUsuarios, r.itemsLid, r.itemsSupGes, r.itemsSupGer, r.itemsGesPz, r.itemsGerPz];
  return { items: grupos.flat(), resumen: contarResumen(grupos) };
};

/** Aplica una sola fila de USUARIOS (Fase 1: identidad/perfil). Las relaciones
 *  se sincronizan aparte, en Fase 2 (`sincronizarRelacionesWorkbook`). */
const aplicarFilaUsuario = async (fila: FilaUsuarioImport, ctx: ContextoMasivo): Promise<string> => {
  const accion = fila.accion.toUpperCase();
  const email = normEmail(fila.email);
  const rolInfo = fila.rol ? ctx.rolesPorClave.get(fila.rol) : undefined;
  const activoFlag = fila.activo ? fila.activo.toUpperCase() === 'SI' : undefined;

  if (accion === 'CREAR') {
    if (!rolInfo) throw new UsuariosError('Rol no resuelto.');
    const nombreCartera = fila.rol === 'gestor' ? (fila.nombreCartera.trim() || null) : undefined;
    const { password } = await crearUsuario({ email, nombre: fila.nombre, apellido: fila.apellido, roleId: rolInfo.id, activo: activoFlag ?? true, nombreCartera });
    return password;
  }

  const perfil = await buscarPerfilPorEmail(email);
  if (!perfil) throw new UsuariosError('Usuario no encontrado.');

  if (accion === 'ACTIVAR') { await actualizarUsuario(perfil.id, { activo: true }); return ''; }
  if (accion === 'DESACTIVAR') { await actualizarUsuario(perfil.id, { activo: false }); return ''; }

  // ACTUALIZAR
  const patch: ActualizarUsuarioInput = {};
  if (fila.nombre.trim()) patch.nombre = fila.nombre.trim();
  if (fila.apellido.trim()) patch.apellido = fila.apellido.trim();
  if (rolInfo) patch.roleId = rolInfo.id;
  if (activoFlag !== undefined) patch.activo = activoFlag;
  if (fila.rol === 'gestor' && fila.nombreCartera.trim()) patch.nombreCartera = fila.nombreCartera.trim();
  await actualizarUsuario(perfil.id, patch);
  return '';
};

/** Sincroniza una tabla de relación simple (owner_id, target_id) por completo
 *  para un propietario dado: reemplaza sus filas activas exactamente por
 *  `targetIds`. Devuelve el desglose creadas/vigentes(sin cambio)/eliminadas
 *  (Sección 16). */
const syncSimpleRelation = async (
  table: string, ownerField: string, targetField: string, ownerId: string, targetIds: string[]
): Promise<{ creadas: number; eliminadas: number; vigentes: number }> => {
  const client = getSupabaseClient();
  const { data: previos, error: pErr } = await client.from(table).select(targetField).eq(ownerField, ownerId).eq('activo', true);
  if (pErr) throw new UsuariosError(`No se pudo leer ${table}: ${pErr.message}`);
  const previosIds = new Set(((previos ?? []) as unknown as Array<Record<string, unknown>>).map((r) => String(r[targetField])));
  const nuevosIds = new Set(targetIds);
  const creadas = targetIds.filter((id) => !previosIds.has(id)).length;
  const vigentes = targetIds.filter((id) => previosIds.has(id)).length;
  const eliminadas = [...previosIds].filter((id) => !nuevosIds.has(id)).length;

  const { error: delErr } = await client.from(table).delete().eq(ownerField, ownerId);
  if (delErr) throw new UsuariosError(`No se pudo sincronizar ${table}: ${delErr.message}`);
  if (targetIds.length > 0) {
    const rows = targetIds.map((id) => ({ [ownerField]: ownerId, [targetField]: id, fecha_inicio: hoy(), fecha_fin: null, activo: true }));
    const { error } = await client.from(table).insert(rows);
    if (error) throw new UsuariosError(`No se pudo sincronizar ${table}: ${error.message}`);
  }
  return { creadas, eliminadas, vigentes };
};

/** Igual que `syncSimpleRelation` pero para relaciones País-Zona (par exacto,
 *  no listas independientes — ver Sección 6). */
const syncPaisZonaRelation = async (
  table: string, ownerField: string, ownerId: string, pares: Array<{ zonaId: string; pais: string }>
): Promise<{ creadas: number; eliminadas: number; vigentes: number }> => {
  const client = getSupabaseClient();
  const key = (zonaId: string, pais: string) => `${zonaId}||${pais.toLowerCase()}`;
  const { data: previos, error: pErr } = await client.from(table).select('zona_id, pais').eq(ownerField, ownerId).eq('activo', true);
  if (pErr) throw new UsuariosError(`No se pudo leer ${table}: ${pErr.message}`);
  const previosSet = new Set(((previos ?? []) as Array<{ zona_id: string; pais: string | null }>).map((r) => key(r.zona_id, r.pais ?? '')));
  const nuevosSet = new Set(pares.map((p) => key(p.zonaId, p.pais)));
  const creadas = pares.filter((p) => !previosSet.has(key(p.zonaId, p.pais))).length;
  const vigentes = pares.filter((p) => previosSet.has(key(p.zonaId, p.pais))).length;
  const eliminadas = [...previosSet].filter((k) => !nuevosSet.has(k)).length;

  const { error: delErr } = await client.from(table).delete().eq(ownerField, ownerId);
  if (delErr) throw new UsuariosError(`No se pudo sincronizar ${table}: ${delErr.message}`);
  if (pares.length > 0) {
    const rows = pares.map((p) => ({ [ownerField]: ownerId, zona_id: p.zonaId, pais: p.pais, fecha_inicio: hoy(), fecha_fin: null, activo: true }));
    const { error } = await client.from(table).insert(rows);
    if (error) throw new UsuariosError(`No se pudo sincronizar ${table}: ${error.message}`);
  }
  return { creadas, eliminadas, vigentes };
};

/** Solo las filas cuyo `PreviewItem` paralelo (mismo índice) resultó VALIDO. */
const filasValidas = <F>(filas: F[], items: PreviewItem[]): F[] => filas.filter((_, i) => items[i]?.estado === 'VALIDO');

/** Releer en frío profiles.id y (si aplica) gestores.id vigente para un
 *  conjunto de emails, DESPUÉS de aplicar la hoja USUARIOS: evita operar con
 *  ids obsoletos de altas o cambios de rol ocurridos en esta misma carga. */
const resolverIdsFrescos = async (
  emails: Set<string>
): Promise<{ idPorEmail: Map<string, string>; gestorIdPorEmail: Map<string, string> }> => {
  const idPorEmail = new Map<string, string>();
  const gestorIdPorEmail = new Map<string, string>();
  if (emails.size === 0) return { idPorEmail, gestorIdPorEmail };
  const client = getSupabaseClient();
  const { data: perfiles, error } = await client.from('profiles').select('id, email').in('email', Array.from(emails));
  if (error) throw new UsuariosError(`No se pudieron releer los usuarios: ${error.message}`);
  ((perfiles ?? []) as Array<{ id: string; email: string }>).forEach((p) => idPorEmail.set(normEmail(p.email), p.id));
  const profileIds = Array.from(idPorEmail.values());
  if (profileIds.length > 0) {
    const { data: gestoresRows, error: gErr } = await client.from('gestores').select('id, usuario_id').in('usuario_id', profileIds).eq('activo', true);
    if (gErr) throw new UsuariosError(`No se pudieron releer los gestores: ${gErr.message}`);
    const gestorIdPorProfileId = new Map<string, string>();
    ((gestoresRows ?? []) as Array<{ id: string; usuario_id: string }>).forEach((g) => gestorIdPorProfileId.set(g.usuario_id, g.id));
    idPorEmail.forEach((profileId, email) => {
      const gid = gestorIdPorProfileId.get(profileId);
      if (gid) gestorIdPorEmail.set(email, gid);
    });
  }
  return { idPorEmail, gestorIdPorEmail };
};

/** Sincroniza un tipo de relación simple (1 propietario -> N relacionados)
 *  para TODOS los propietarios "vigentes" en este archivo: la UNIÓN de (a) los
 *  propietarios con al menos una fila VÁLIDA en la hoja de relación y (b) los
 *  usuarios de la hoja USUARIOS con el rol propietario, aplicados con éxito en
 *  esta misma carga. Un propietario vigente sin filas válidas en la hoja de
 *  relación queda con CERO relaciones activas (se eliminan las anteriores):
 *  el archivo representa el estado completo vigente para todo propietario que
 *  menciona. Un propietario que NO aparece en ningún lado del archivo no se toca. */
const sincronizarTipoRelacion = async (
  filas: FilaRelacionImport[], items: PreviewItem[],
  usuarios: FilaUsuarioImport[], usuariosOk: Set<string>, rolPropietario: string,
  table: string, ownerField: string, targetField: string,
  idPorEmail: Map<string, string>, resolverTargetId: (email: string) => string | undefined
): Promise<{ creadas: number; vigentes: number; eliminadas: number }> => {
  const validas = filasValidas(filas, items);
  const propietarios = new Set<string>(validas.map((f) => normEmail(f.propietario)));
  usuarios.forEach((f) => { if (f.rol === rolPropietario && usuariosOk.has(normEmail(f.email))) propietarios.add(normEmail(f.email)); });

  const targetsPorPropietario = new Map<string, string[]>();
  validas.forEach((f) => {
    const owner = normEmail(f.propietario);
    const targetId = resolverTargetId(normEmail(f.relacionado));
    if (!targetId) return;
    const arr = targetsPorPropietario.get(owner) ?? [];
    arr.push(targetId);
    targetsPorPropietario.set(owner, arr);
  });

  let creadas = 0; let vigentes = 0; let eliminadas = 0;
  for (const email of propietarios) {
    const ownerId = idPorEmail.get(email);
    if (!ownerId) continue;
    const r = await syncSimpleRelation(table, ownerField, targetField, ownerId, targetsPorPropietario.get(email) ?? []);
    creadas += r.creadas; vigentes += r.vigentes; eliminadas += r.eliminadas;
  }
  return { creadas, vigentes, eliminadas };
};

/** Igual que `sincronizarTipoRelacion` pero para hojas País-Zona (Gestor o
 *  Gerente de zona): el PAR completo, nunca listas independientes. */
const sincronizarTipoPaisZona = async (
  filas: FilaPaisZonaImport[], items: PreviewItem[],
  usuarios: FilaUsuarioImport[], usuariosOk: Set<string>, rolPropietario: string,
  table: string, ownerField: string,
  ownerIdPorEmail: Map<string, string>, zonaIdPorNombre: Map<string, string>
): Promise<{ creadas: number; vigentes: number; eliminadas: number }> => {
  const validas = filasValidas(filas, items);
  const propietarios = new Set<string>(validas.map((f) => normEmail(f.email)));
  usuarios.forEach((f) => { if (f.rol === rolPropietario && usuariosOk.has(normEmail(f.email))) propietarios.add(normEmail(f.email)); });

  const paresPorPropietario = new Map<string, Array<{ zonaId: string; pais: string }>>();
  validas.forEach((f) => {
    const owner = normEmail(f.email);
    const zonaId = zonaIdPorNombre.get(f.zona.trim().toLowerCase());
    if (!zonaId) return;
    const arr = paresPorPropietario.get(owner) ?? [];
    arr.push({ zonaId, pais: f.pais.trim() });
    paresPorPropietario.set(owner, arr);
  });

  let creadas = 0; let vigentes = 0; let eliminadas = 0;
  for (const email of propietarios) {
    const ownerId = ownerIdPorEmail.get(email);
    if (!ownerId) continue;
    const r = await syncPaisZonaRelation(table, ownerField, ownerId, paresPorPropietario.get(email) ?? []);
    creadas += r.creadas; vigentes += r.vigentes; eliminadas += r.eliminadas;
  }
  return { creadas, vigentes, eliminadas };
};

/** Aplica el workbook completo (Sección 8-11): re-valida en el servidor (nunca
 *  confía en el cliente), aplica FASE 1 (USUARIOS: identidad/perfil) y luego
 *  FASE 2 (las 5 relaciones de Grupos y Niveles, sincronizadas por completo
 *  para cada propietario vigente, con ids releídos en frío). Registra
 *  auditoría reutilizando `IMPORTACION_USUARIOS` (sin duplicar historial). */
export const aplicarWorkbook = async (
  parsed: ParsedWorkbook,
  soloValidas: boolean,
  actorId: string | null
): Promise<{ resultados: ResultadoAplicarItem[]; resumen: ResumenImport }> => {
  const v = await validarTodo(parsed);
  const grupos = [v.itemsUsuarios, v.itemsLid, v.itemsSupGes, v.itemsSupGer, v.itemsGesPz, v.itemsGerPz];
  const hayErrores = grupos.some((g) => g.some((it) => it.estado === 'ERROR'));
  if (hayErrores && !soloValidas) {
    throw new UsuariosError('El archivo tiene filas con error. Corrígelas o usa "Procesar solo válidas".');
  }

  const resumen = contarResumen(grupos);
  const resultados: ResultadoAplicarItem[] = [];

  // FASE 1 — USUARIOS (identidad/perfil).
  const usuariosOk = new Set<string>();
  for (const item of v.itemsUsuarios) {
    const filaOriginal = parsed.usuarios.find((f) => f.fila === item.fila);
    const base = {
      hoja: item.hoja, fila: item.fila, accion: item.accion, email: item.email, rol: item.rol,
      nombre: filaOriginal?.nombre.trim() ?? '', apellido: filaOriginal?.apellido.trim() ?? '', columna: item.columna
    };
    if (item.estado === 'ERROR') {
      resultados.push({ ...base, resultado: 'ERROR', password: '', mensaje: item.mensaje });
      continue;
    }
    if (!filaOriginal) continue;
    try {
      const password = await aplicarFilaUsuario(filaOriginal, v.ctx);
      resultados.push({ ...base, resultado: 'OK', password, mensaje: 'Procesado correctamente.' });
      usuariosOk.add(normEmail(filaOriginal.email));
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'Error al procesar la fila.';
      resultados.push({ ...base, resultado: 'ERROR', password: '', mensaje });
    }
  }

  // Resultados de las hojas de RELACIÓN (informativos: se reflejan al sincronizar más abajo).
  const pushRelacion = (items: PreviewItem[]) => {
    items.forEach((it) => resultados.push({
      hoja: it.hoja, fila: it.fila, accion: it.accion, email: it.email, rol: it.rol, columna: it.columna,
      resultado: it.estado === 'VALIDO' ? 'OK' : 'ERROR', password: '', mensaje: it.mensaje
    }));
  };
  pushRelacion(v.itemsLid); pushRelacion(v.itemsSupGes); pushRelacion(v.itemsSupGer);
  pushRelacion(v.itemsGesPz); pushRelacion(v.itemsGerPz);

  // FASE 2 — RELACIONES (Grupos y Niveles), con ids releídos en frío.
  const emailsRelevantes = new Set<string>();
  const addAll = (arr: string[]) => arr.forEach((e) => { const n = normEmail(e); if (n) emailsRelevantes.add(n); });
  addAll(parsed.liderazgoSupervisor.flatMap((f) => [f.propietario, f.relacionado]));
  addAll(parsed.supervisorGestor.flatMap((f) => [f.propietario, f.relacionado]));
  addAll(parsed.supervisorGerente.flatMap((f) => [f.propietario, f.relacionado]));
  addAll(parsed.gestorPaisZona.map((f) => f.email));
  addAll(parsed.gerentePaisZona.map((f) => f.email));
  addAll(parsed.usuarios.map((f) => f.email));

  const { idPorEmail, gestorIdPorEmail } = await resolverIdsFrescos(emailsRelevantes);

  let relacionesCreadas = 0;
  let relacionesVigentes = 0;
  let relacionesEliminadas = 0;
  const acumular = (r: { creadas: number; vigentes: number; eliminadas: number }) => {
    relacionesCreadas += r.creadas; relacionesVigentes += r.vigentes; relacionesEliminadas += r.eliminadas;
  };

  if (parsed.hojasPresentes.has(SHEET_LIDERAZGO_SUPERVISOR)) {
    acumular(await sincronizarTipoRelacion(
      parsed.liderazgoSupervisor, v.itemsLid, parsed.usuarios, usuariosOk, 'liderazgo',
      'liderazgo_supervisor', 'liderazgo_id', 'supervisor_id', idPorEmail, (email) => idPorEmail.get(email)
    ));
  }
  if (parsed.hojasPresentes.has(SHEET_SUPERVISOR_GESTOR)) {
    acumular(await sincronizarTipoRelacion(
      parsed.supervisorGestor, v.itemsSupGes, parsed.usuarios, usuariosOk, 'supervisor',
      'supervisor_gestor', 'supervisor_id', 'gestor_id', idPorEmail, (email) => gestorIdPorEmail.get(email)
    ));
  }
  if (parsed.hojasPresentes.has(SHEET_SUPERVISOR_GERENTE)) {
    acumular(await sincronizarTipoRelacion(
      parsed.supervisorGerente, v.itemsSupGer, parsed.usuarios, usuariosOk, 'supervisor',
      'supervisor_gerente_zona', 'supervisor_id', 'gerente_zona_id', idPorEmail, (email) => idPorEmail.get(email)
    ));
  }
  if (parsed.hojasPresentes.has(SHEET_GESTOR_PAIS_ZONA)) {
    acumular(await sincronizarTipoPaisZona(
      parsed.gestorPaisZona, v.itemsGesPz, parsed.usuarios, usuariosOk, 'gestor',
      'gestor_pais_zona', 'gestor_id', gestorIdPorEmail, v.ctx.zonaIdPorNombre
    ));
  }
  if (parsed.hojasPresentes.has(SHEET_GERENTE_PAIS_ZONA)) {
    acumular(await sincronizarTipoPaisZona(
      parsed.gerentePaisZona, v.itemsGerPz, parsed.usuarios, usuariosOk, 'gerente_zona',
      'gerente_zona_zona', 'usuario_id', idPorEmail, v.ctx.zonaIdPorNombre
    ));
  }

  resumen.relacionesCreadas = relacionesCreadas;
  resumen.relacionesVigentes = relacionesVigentes;
  resumen.relacionesEliminadas = relacionesEliminadas;

  await registrarAuditoria(actorId, 'IMPORTACION_USUARIOS', 'usuarios', null, {
    total: resumen.total,
    validas: resumen.validas,
    errores: resumen.errores,
    creados: resumen.creaciones,
    actualizados: resumen.actualizaciones,
    activados: resumen.activaciones,
    desactivados: resumen.desactivaciones,
    relacionesCreadas,
    relacionesVigentes,
    relacionesEliminadas,
    soloValidas
  });

  return { resultados, resumen };
};

/* ============================================================================
 * GRUPOS Y NIVELES — visuales (Sección 10). Un renglón por usuario con rol
 * dependiente (liderazgo/supervisor/gestor/gerente_zona), calculado SIEMPRE a
 * partir de las relaciones reales configuradas (nunca de ASIGNACION). Los
 * conteos por País/Zona/Sector se derivan de `cartera` vía el nombre real de
 * cada gestor (mismo puente que usa ScopeService).
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

interface CarteraFila { gestor: string; pais: string; zona: string; sector: string; }

const cargarCarteraResumen = async (): Promise<CarteraFila[]> => {
  const client = getSupabaseClient();
  const pageSize = 1000;
  const out: CarteraFila[] = [];
  for (let page = 0; page < 60; page += 1) {
    const from = page * pageSize;
    const { data, error } = await client.from(SUPABASE_CARTERA_TABLE).select('gestor, pais, zona, sector').range(from, from + pageSize - 1);
    if (error) throw new UsuariosError(`No se pudo leer cartera para el resumen de alcance: ${error.message}`);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    for (const r of rows) {
      out.push({
        gestor: typeof r.gestor === 'string' ? r.gestor.trim() : '',
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

  const nombrePorGestorId = new Map(((gestores ?? []) as Array<{ id: string; nombre_cartera: string | null }>).map((g) => [g.id, g.nombre_cartera ?? '']));
  const gestorIdPorUsuario = new Map(((gestores ?? []) as Array<{ id: string; usuario_id: string | null }>).filter((g) => g.usuario_id).map((g) => [g.usuario_id as string, g.id]));

  const carteraPorGestor = new Map<string, CarteraFila[]>();
  for (const fila of cartera) {
    if (!fila.gestor) continue;
    const key = fila.gestor.toLowerCase();
    const list = carteraPorGestor.get(key) ?? [];
    list.push(fila);
    carteraPorGestor.set(key, list);
  }
  const carteraDe = (nombresGestor: string[]): CarteraFila[] =>
    nombresGestor.flatMap((n) => carteraPorGestor.get(n.toLowerCase()) ?? []);

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

  const items: AlcanceResumenItem[] = perfilRows.map((p) => {
    const roleRaw = Array.isArray(p.roles) ? p.roles[0] : p.roles;
    const roleClave = roleRaw?.clave ?? null;
    const nivel = roleRaw?.nivel ?? null;
    const base: AlcanceResumenItem = { userId: p.id, roleClave, nivel, totalSupervisores: null, totalGestores: null, totalZonas: null, totalSectores: null, paises: [], zonas: [] };

    if (roleClave === 'liderazgo') {
      const supervisorIds = uniq(supervisoresPorLiderazgo.get(p.id) ?? []);
      const gestorIds = uniq(supervisorIds.flatMap((sid) => gestoresPorSupervisor.get(sid) ?? []));
      const nombres = gestorIds.map((gid) => nombrePorGestorId.get(gid) ?? '').filter(Boolean);
      const filas = carteraDe(nombres);
      const gerenteIds = uniq(supervisorIds.flatMap((sid) => gerentesPorSupervisor.get(sid) ?? []));
      const pzGerentes = gerenteIds.flatMap((gid) => paisZonaDeGerente(gid));
      return {
        ...base, totalSupervisores: supervisorIds.length, totalGestores: gestorIds.length,
        paises: uniq([...filas.map((f) => f.pais), ...pzGerentes.map((z) => z.pais)]),
        zonas: uniq([...filas.map((f) => f.zona), ...pzGerentes.map((z) => z.zona)])
      };
    }
    if (roleClave === 'supervisor') {
      const gestorIds = uniq(gestoresPorSupervisor.get(p.id) ?? []);
      const nombres = gestorIds.map((gid) => nombrePorGestorId.get(gid) ?? '').filter(Boolean);
      const filas = carteraDe(nombres);
      const gerenteIds = uniq(gerentesPorSupervisor.get(p.id) ?? []);
      const pzGerentes = gerenteIds.flatMap((gid) => paisZonaDeGerente(gid));
      return {
        ...base, totalGestores: gestorIds.length,
        paises: uniq([...filas.map((f) => f.pais), ...pzGerentes.map((z) => z.pais)]),
        zonas: uniq([...filas.map((f) => f.zona), ...pzGerentes.map((z) => z.zona)])
      };
    }
    if (roleClave === 'gestor') {
      const gestorId = gestorIdPorUsuario.get(p.id);
      const explicit = gestorId ? zonasPorGestorId.get(gestorId) ?? [] : [];
      if (explicit.length > 0) {
        return { ...base, totalZonas: uniq(explicit.map((e) => e.zona)).length, paises: uniq(explicit.map((e) => e.pais)), zonas: uniq(explicit.map((e) => e.zona)) };
      }
      const nombre = gestorId ? nombrePorGestorId.get(gestorId) ?? '' : '';
      const filas = nombre ? carteraDe([nombre]) : [];
      return { ...base, totalZonas: uniq(filas.map((f) => f.zona)).length, paises: uniq(filas.map((f) => f.pais)), zonas: uniq(filas.map((f) => f.zona)) };
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

