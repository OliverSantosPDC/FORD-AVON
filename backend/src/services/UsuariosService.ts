import { getSupabaseClient } from '../config/supabaseClient';
import { SUPABASE_CARTERA_TABLE } from '../config/env';
import { registrarAuditoria } from './AuditoriaService';
import { generarPasswordTemporal } from '../utils/password';
import type { FilaImport } from '../utils/usuariosExcel';

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
      if (pais && zona) pares.add(`${pais} ${zona}`);
    }
    if (rows.length < pageSize) break;
  }

  const { data: zonasRows, error: zErr } = await client.from('zonas').select('id, nombre').eq('activo', true);
  if (zErr) throw new UsuariosError(`No se pudo leer el catálogo de zonas: ${zErr.message}`);
  const zonaIdPorNombre = new Map(((zonasRows ?? []) as Array<{ id: string; nombre: string }>).map((z) => [z.nombre, z.id]));

  return Array.from(pares)
    .map((par) => { const [pais, zona] = par.split(' '); return { pais, zona, zonaId: zonaIdPorNombre.get(zona) ?? '' }; })
    .filter((p) => p.zonaId)
    .sort((a, b) => a.pais.localeCompare(b.pais, 'es') || a.zona.localeCompare(b.zona, 'es', { numeric: true }));
};

export const obtenerCatalogos = async (): Promise<Catalogos> => {
  const client = getSupabaseClient();

  const [{ data: roles, error: rErr }, { data: zonas, error: zErr }, { data: gestores, error: gErr }, carteraGestores, carteraPaisZona, { data: supervisores, error: sErr }] =
    await Promise.all([
      client.from('roles').select('id, clave, nombre, nivel').order('nivel', { ascending: true, nullsFirst: false }),
      client.from('zonas').select('id, nombre, codigo').eq('activo', true).order('nombre', { ascending: true }),
      client.from('gestores').select('id, nombre_cartera, usuario_id').eq('activo', true),
      distinctCarteraGestores(),
      distinctCarteraPaisZona(),
      client.from('profiles').select('id, nombre, apellido, roles!inner ( clave )').eq('activo', true).eq('roles.clave', 'supervisor')
    ]);

  if (rErr) throw new UsuariosError(`No se pudieron leer los roles: ${rErr.message}`);
  if (zErr) throw new UsuariosError(`No se pudieron leer las zonas: ${zErr.message}`);
  if (gErr) throw new UsuariosError(`No se pudieron leer los gestores: ${gErr.message}`);
  if (sErr) throw new UsuariosError(`No se pudieron leer los supervisores: ${sErr.message}`);

  return {
    roles: ((roles ?? []) as Array<Record<string, unknown>>).map((r) => ({ id: String(r.id), clave: String(r.clave), nombre: String(r.nombre), nivel: (r.nivel as number | null) ?? null })),
    zonas: ((zonas ?? []) as Array<Record<string, unknown>>).map((z) => ({ id: String(z.id), nombre: String(z.nombre), codigo: (z.codigo as string | null) ?? null })),
    gestores: ((gestores ?? []) as Array<Record<string, unknown>>).map((g) => ({ id: String(g.id), nombreCartera: (g.nombre_cartera as string | null) ?? null, usuarioId: (g.usuario_id as string | null) ?? null })),
    carteraGestores,
    carteraPaisZona,
    supervisores: ((supervisores ?? []) as Array<Record<string, unknown>>).map((s) => ({ id: String(s.id), nombre: String(s.nombre ?? ''), apellido: (s.apellido as string | null) ?? null }))
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
  if (error) throw new UsuariosError(`No se pudo restablecer la contraseña: ${error.message}`);
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

/**
 * Elimina un usuario: limpia relaciones, borra de Supabase Auth y de profiles.
 * No permite auto-eliminación. Devuelve datos para auditoría.
 */
export const eliminarUsuario = async (id: string, actorId: string | null): Promise<{ email: string; roleClave: string | null }> => {
  if (actorId && actorId === id) throw new UsuariosError('No puedes eliminar tu propia cuenta.');
  const client = getSupabaseClient();

  const { data: perfil } = await client.from('profiles').select('id, email, roles ( clave )').eq('id', id).single();
  if (!perfil) throw new UsuariosError('Usuario no encontrado.');
  const email = String((perfil as Record<string, unknown>).email ?? '');
  const roleClave = roleRefOf((perfil as Record<string, unknown>).roles)?.clave ?? null;

  // 1) Limpia relaciones de alcance para que no quede acceso residual.
  await client.from('gestores').update({ usuario_id: null }).eq('usuario_id', id);
  await client.from('supervisor_gestor').delete().eq('supervisor_id', id);
  await client.from('gerente_zona_zona').delete().eq('usuario_id', id);

  // 2) Elimina de Supabase Auth (Admin API).
  const { error: authError } = await client.auth.admin.deleteUser(id);
  if (authError && !/not.*found/i.test(authError.message)) {
    throw new UsuariosError(`No se pudo eliminar el usuario de Auth: ${authError.message}`);
  }

  // 3) Elimina el perfil (por si no hubo cascada).
  await client.from('profiles').delete().eq('id', id);

  return { email, roleClave };
};

/* ============================================================================
 * CARGA MASIVA DE USUARIOS (módulo Repositorio)
 * Reutiliza crearUsuario/actualizarUsuario; no duplica la lógica de alta.
 * ========================================================================== */

const ACCIONES_VALIDAS = ['CREAR', 'ACTUALIZAR', 'ACTIVAR', 'DESACTIVAR'];
/** Administrador es el único rol sin relación de alcance (Nivel 1, sin dependencia). */
const ROLES_SIN_RELACION = ['administrador'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const splitMulti = (value: string): string[] =>
  value.split(';').map((v) => v.trim()).filter(Boolean);

const normEmail = (email: string): string => email.trim().toLowerCase();

export interface PreviewItem {
  fila: number;
  accion: string;
  email: string;
  rol: string;
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
}

export interface ResultadoAplicarItem {
  fila: number;
  accion: string;
  email: string;
  nombre: string;
  apellido: string;
  rol: string;
  resultado: 'OK' | 'ERROR';
  /** Solo para CREAR; vacío en ACTUALIZAR/ACTIVAR/DESACTIVAR. No se persiste. */
  password: string;
  mensaje: string;
}

interface ContextoValidacion {
  rolesPorClave: Map<string, string>; // clave -> id
  carteraGestores: Set<string>; // valores reales de cartera.gestor (lower)
  zonas: Set<string>; // nombre/codigo (lower)
  emailsExistentes: Set<string>; // profiles.email (lower)
}

const cargarContexto = async (): Promise<ContextoValidacion> => {
  const client = getSupabaseClient();
  const catalogos = await obtenerCatalogos();

  const { data: perfiles, error } = await client.from('profiles').select('email');
  if (error) throw new UsuariosError(`No se pudieron leer los usuarios existentes: ${error.message}`);

  const zonasSet = new Set<string>();
  for (const z of catalogos.zonas) {
    zonasSet.add(z.nombre.trim().toLowerCase());
    if (z.codigo) zonasSet.add(z.codigo.trim().toLowerCase());
  }

  return {
    rolesPorClave: new Map(catalogos.roles.map((r) => [r.clave, r.id])),
    carteraGestores: new Set(catalogos.carteraGestores.map((g) => g.toLowerCase())),
    zonas: zonasSet,
    emailsExistentes: new Set(((perfiles ?? []) as Array<{ email?: string }>).map((p) => normEmail(String(p.email ?? ''))).filter(Boolean))
  };
};

/** Valida una fila SIN tocar la BD y devuelve su mensaje de error (o '' si es válida). */
const validarFila = (fila: FilaImport, ctx: ContextoValidacion, vistosEnExcel: Set<string>): string => {
  const accion = fila.accion.toUpperCase();
  if (!ACCIONES_VALIDAS.includes(accion)) return `Acción no válida: "${fila.accion}".`;

  const email = normEmail(fila.email);
  if (!email) return 'EMAIL es obligatorio.';
  if (!EMAIL_RE.test(email)) return 'EMAIL inválido.';
  if (vistosEnExcel.has(email)) return 'EMAIL duplicado dentro del archivo.';

  const existe = ctx.emailsExistentes.has(email);

  if (accion === 'CREAR') {
    if (existe) return 'El usuario ya existe (email duplicado).';
    if (!fila.nombre.trim()) return 'NOMBRE es obligatorio.';
    if (!fila.apellido.trim()) return 'APELLIDO es obligatorio.';
    if (!fila.rol) return 'ROL es obligatorio.';
    if (!ctx.rolesPorClave.has(fila.rol)) return `ROL no válido: "${fila.rol}".`;
    const relError = validarRelacion(fila, ctx);
    if (relError) return relError;
    return '';
  }

  // ACTUALIZAR / ACTIVAR / DESACTIVAR requieren usuario existente.
  if (!existe) return 'Usuario no encontrado.';

  if (accion === 'ACTUALIZAR' && fila.rol) {
    if (!ctx.rolesPorClave.has(fila.rol)) return `ROL no válido: "${fila.rol}".`;
    const relError = validarRelacion(fila, ctx);
    if (relError) return relError;
  }
  return '';
};

/** Valida las relaciones exigidas por el rol (cartera/zonas). */
const validarRelacion = (fila: FilaImport, ctx: ContextoValidacion): string => {
  if (fila.rol === 'gestor') {
    if (!fila.nombreCartera.trim()) return 'NOMBRE_CARTERA es obligatorio para gestor.';
    if (!ctx.carteraGestores.has(fila.nombreCartera.trim().toLowerCase())) {
      return `NOMBRE_CARTERA no existe en cartera: "${fila.nombreCartera}".`;
    }
  }
  if (fila.rol === 'supervisor' && fila.nombreCartera.trim()) {
    for (const g of splitMulti(fila.nombreCartera)) {
      if (!ctx.carteraGestores.has(g.toLowerCase())) return `Gestor no existe en cartera: "${g}".`;
    }
  }
  if (fila.rol === 'gerente_zona' && fila.zona.trim()) {
    for (const z of splitMulti(fila.zona)) {
      if (!ctx.zonas.has(z.toLowerCase())) return `Zona no encontrada: "${z}".`;
    }
  }
  if (ROLES_SIN_RELACION.includes(fila.rol)) {
    // Sin relaciones requeridas; se ignoran NOMBRE_CARTERA/ZONA si vinieran.
    return '';
  }
  return '';
};

const contarResumen = (items: PreviewItem[], filas: FilaImport[]): ResumenImport => {
  const resumen: ResumenImport = { total: filas.length, validas: 0, errores: 0, creaciones: 0, actualizaciones: 0, activaciones: 0, desactivaciones: 0 };
  items.forEach((it) => {
    if (it.estado === 'VALIDO') {
      resumen.validas += 1;
      const a = it.accion.toUpperCase();
      if (a === 'CREAR') resumen.creaciones += 1;
      else if (a === 'ACTUALIZAR') resumen.actualizaciones += 1;
      else if (a === 'ACTIVAR') resumen.activaciones += 1;
      else if (a === 'DESACTIVAR') resumen.desactivaciones += 1;
    } else {
      resumen.errores += 1;
    }
  });
  return resumen;
};

export const validarImportacion = async (filas: FilaImport[]): Promise<{ items: PreviewItem[]; resumen: ResumenImport }> => {
  const ctx = await cargarContexto();
  const vistos = new Set<string>();
  const items: PreviewItem[] = filas.map((fila) => {
    const mensaje = validarFila(fila, ctx, vistos);
    const email = normEmail(fila.email);
    if (email) vistos.add(email);
    return {
      fila: fila.fila,
      accion: fila.accion.toUpperCase(),
      email: fila.email.trim(),
      rol: fila.rol,
      estado: mensaje ? 'ERROR' : 'VALIDO',
      mensaje: mensaje || 'OK'
    };
  });
  return { items, resumen: contarResumen(items, filas) };
};

/** Asegura filas en `gestores` para los nombre_cartera dados y devuelve sus ids. */
const resolverGestorIds = async (nombres: string[]): Promise<string[]> => {
  const client = getSupabaseClient();
  const ids: string[] = [];
  for (const nombre of nombres) {
    const { data } = await client.from('gestores').select('id').eq('nombre_cartera', nombre).limit(1);
    const row = (data ?? [])[0] as { id?: string } | undefined;
    if (row?.id) {
      ids.push(row.id);
    } else {
      const { data: inserted, error } = await client.from('gestores').insert({ nombre_cartera: nombre, activo: true }).select('id').single();
      if (error) throw new UsuariosError(`No se pudo registrar el gestor "${nombre}": ${error.message}`);
      ids.push(String((inserted as { id: string }).id));
    }
  }
  return ids;
};

/** Resuelve ids de zona por nombre o código (sin inventar zonas). */
const resolverZonaIds = async (nombres: string[]): Promise<string[]> => {
  const client = getSupabaseClient();
  const ids: string[] = [];
  for (const nombre of nombres) {
    const { data } = await client.from('zonas').select('id, nombre, codigo').eq('activo', true);
    const match = ((data ?? []) as Array<{ id: string; nombre: string; codigo: string | null }>).find(
      (z) => z.nombre.trim().toLowerCase() === nombre.toLowerCase() || (z.codigo ?? '').trim().toLowerCase() === nombre.toLowerCase()
    );
    if (!match) throw new UsuariosError(`Zona no encontrada: "${nombre}".`);
    ids.push(match.id);
  }
  return ids;
};

/** Ejecuta una sola fila válida reutilizando crearUsuario/actualizarUsuario.
 *  Devuelve la contraseña temporal SOLO para CREAR (vacío en el resto). */
const aplicarFila = async (fila: FilaImport, ctx: ContextoValidacion): Promise<string> => {
  const accion = fila.accion.toUpperCase();
  const email = normEmail(fila.email);
  const roleId = fila.rol ? ctx.rolesPorClave.get(fila.rol) : undefined;
  const activoFlag = fila.activo ? fila.activo.toUpperCase() === 'SI' : undefined;

  const relaciones = async () => {
    const out: { nombreCartera?: string | null; gestorIds?: string[]; zonaIds?: string[] } = {};
    if (fila.rol === 'gestor') out.nombreCartera = fila.nombreCartera.trim() || null;
    if (fila.rol === 'supervisor') out.gestorIds = await resolverGestorIds(splitMulti(fila.nombreCartera));
    if (fila.rol === 'gerente_zona') out.zonaIds = await resolverZonaIds(splitMulti(fila.zona));
    return out;
  };

  if (accion === 'CREAR') {
    if (!roleId) throw new UsuariosError('Rol no resuelto.');
    const rel = await relaciones();
    const { password } = await crearUsuario({ email, nombre: fila.nombre, apellido: fila.apellido, roleId, activo: activoFlag ?? true, ...rel });
    return password;
  }

  // Localiza el usuario existente por email.
  const perfil = await buscarPerfilPorEmail(email);
  if (!perfil) throw new UsuariosError('Usuario no encontrado.');

  if (accion === 'ACTIVAR') {
    await actualizarUsuario(perfil.id, { activo: true });
    return '';
  }
  if (accion === 'DESACTIVAR') {
    await actualizarUsuario(perfil.id, { activo: false });
    return '';
  }

  // ACTUALIZAR
  const patch: ActualizarUsuarioInput = {};
  if (fila.nombre.trim()) patch.nombre = fila.nombre.trim();
  if (fila.apellido.trim()) patch.apellido = fila.apellido.trim();
  if (roleId) patch.roleId = roleId;
  if (activoFlag !== undefined) patch.activo = activoFlag;
  const rel = await relaciones();
  Object.assign(patch, rel);
  await actualizarUsuario(perfil.id, patch);
  return '';
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
    { data: lidSup, error: lsErr }, { data: gerZona, error: gzErr }, { data: gesPZ, error: gpzErr }, cartera] =
    await Promise.all([
      client.from('profiles').select('id, activo, role_id, roles ( clave, nivel )'),
      client.from('gestores').select('id, usuario_id, nombre_cartera').eq('activo', true),
      client.from('supervisor_gestor').select('supervisor_id, gestor_id').eq('activo', true),
      client.from('liderazgo_supervisor').select('liderazgo_id, supervisor_id').eq('activo', true),
      client.from('gerente_zona_zona').select('usuario_id, zona_id, pais, zonas ( nombre )').eq('activo', true),
      client.from('gestor_pais_zona').select('gestor_id, pais, zonas ( nombre )').eq('activo', true),
      cargarCarteraResumen()
    ]);

  if (pErr) throw new UsuariosError(`No se pudieron leer los usuarios: ${pErr.message}`);
  if (gErr) throw new UsuariosError(`No se pudieron leer los gestores: ${gErr.message}`);
  if (sgErr) throw new UsuariosError(`No se pudo leer supervisor_gestor: ${sgErr.message}`);
  if (lsErr) throw new UsuariosError(`No se pudo leer liderazgo_supervisor: ${lsErr.message}`);
  if (gzErr) throw new UsuariosError(`No se pudo leer gerente_zona_zona: ${gzErr.message}`);
  if (gpzErr) throw new UsuariosError(`No se pudo leer gestor_pais_zona: ${gpzErr.message}`);

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
      return { ...base, totalSupervisores: supervisorIds.length, totalGestores: gestorIds.length, paises: uniq(filas.map((f) => f.pais)), zonas: uniq(filas.map((f) => f.zona)) };
    }
    if (roleClave === 'supervisor') {
      const gestorIds = uniq(gestoresPorSupervisor.get(p.id) ?? []);
      const nombres = gestorIds.map((gid) => nombrePorGestorId.get(gid) ?? '').filter(Boolean);
      const filas = carteraDe(nombres);
      return { ...base, totalGestores: gestorIds.length, paises: uniq(filas.map((f) => f.pais)), zonas: uniq(filas.map((f) => f.zona)) };
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
      const paisZonaSet = new Set(asignadas.map((a) => `${a.pais} ${a.zona}`));
      const filas = cartera.filter((f) => paisZonaSet.has(`${f.pais} ${f.zona}`));
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

export const aplicarImportacion = async (
  filas: FilaImport[],
  soloValidas: boolean,
  actorId: string | null
): Promise<{ resultados: ResultadoAplicarItem[]; resumen: ResumenImport }> => {
  const ctx = await cargarContexto();
  const vistos = new Set<string>();

  // Re-validación (fuente de verdad del servidor; nunca confía en el cliente).
  const validaciones = filas.map((fila) => {
    const mensaje = validarFila(fila, ctx, vistos);
    const email = normEmail(fila.email);
    if (email) vistos.add(email);
    return { fila, valido: !mensaje, mensaje };
  });

  const hayErrores = validaciones.some((v) => !v.valido);
  if (hayErrores && !soloValidas) {
    throw new UsuariosError('El archivo tiene filas con error. Corrígelas o usa "Procesar solo válidas".');
  }

  const resultados: ResultadoAplicarItem[] = [];
  const resumen: ResumenImport = { total: filas.length, validas: 0, errores: 0, creaciones: 0, actualizaciones: 0, activaciones: 0, desactivaciones: 0 };

  for (const v of validaciones) {
    const base = {
      fila: v.fila.fila,
      accion: v.fila.accion.toUpperCase(),
      email: v.fila.email.trim(),
      nombre: v.fila.nombre.trim(),
      apellido: v.fila.apellido.trim(),
      rol: v.fila.rol
    };
    if (!v.valido) {
      resultados.push({ ...base, resultado: 'ERROR', password: '', mensaje: v.mensaje });
      resumen.errores += 1;
      continue;
    }
    try {
      const password = await aplicarFila(v.fila, ctx);
      resultados.push({ ...base, resultado: 'OK', password, mensaje: 'Procesado correctamente.' });
      resumen.validas += 1;
      const a = base.accion;
      if (a === 'CREAR') resumen.creaciones += 1;
      else if (a === 'ACTUALIZAR') resumen.actualizaciones += 1;
      else if (a === 'ACTIVAR') resumen.activaciones += 1;
      else if (a === 'DESACTIVAR') resumen.desactivaciones += 1;
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'Error al procesar la fila.';
      resultados.push({ ...base, resultado: 'ERROR', password: '', mensaje });
      resumen.errores += 1;
    }
  }

  await registrarAuditoria(actorId, 'IMPORTACION_USUARIOS', 'usuarios', null, {
    total: resumen.total,
    creados: resumen.creaciones,
    actualizados: resumen.actualizaciones,
    activados: resumen.activaciones,
    desactivados: resumen.desactivaciones,
    errores: resumen.errores,
    soloValidas
  });

  return { resultados, resumen };
};
