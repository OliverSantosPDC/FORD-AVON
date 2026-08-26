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

export interface UsuarioDetalle extends UsuarioListItem {
  /** Para rol gestor: su nombre_cartera (puente con cartera.gestor). */
  nombreCartera: string | null;
  /** Para rol supervisor: ids de gestores.id supervisados. */
  gestorIds: string[];
  /** Para rol gerente_zona: ids de zonas.id asignadas. */
  zonaIds: string[];
}

export interface Catalogos {
  roles: Array<{ id: string; clave: string; nombre: string }>;
  zonas: Array<{ id: string; nombre: string; codigo: string | null }>;
  gestores: Array<{ id: string; nombreCartera: string | null; usuarioId: string | null }>;
  /** Valores distintos reales de cartera.gestor (para asignar nombre_cartera). */
  carteraGestores: string[];
}

export interface CrearUsuarioInput {
  email: string;
  nombre: string;
  apellido?: string | null;
  roleId: string;
  activo?: boolean;
  /** Contraseña inicial definida por el administrador. Si se omite, se genera una temporal. */
  password?: string;
  // NOTA: nombreCartera/gestorIds/zonaIds se conservan por compatibilidad de firma pero
  // la gestión de Usuarios ya NO los define; la asignación de cartera es semimanual
  // (módulo Asignación → tabla asignaciones → gestor efectivo en CarteraService).
  nombreCartera?: string | null;
  gestorIds?: string[];
  zonaIds?: string[];
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

const roleRefOf = (roles: unknown): RoleRef | null => {
  const r = Array.isArray(roles) ? roles[0] : roles;
  const rr = r as { clave?: string; nombre?: string } | null;
  return rr && rr.clave ? { clave: rr.clave, nombre: rr.nombre ?? rr.clave } : null;
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
    .select('id, nombre, apellido, email, activo, role_id, roles ( clave, nombre )')
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
    .select('id, nombre, apellido, email, activo, role_id, roles ( clave, nombre )')
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

  const { data: gestorRow } = await client.from('gestores').select('nombre_cartera').eq('usuario_id', id).eq('activo', true).limit(1);
  const { data: supRows } = await client.from('supervisor_gestor').select('gestor_id').eq('supervisor_id', id).eq('activo', true);
  const { data: gerRows } = await client.from('gerente_zona_zona').select('zona_id').eq('usuario_id', id).eq('activo', true);

  return {
    ...base,
    nombreCartera: ((gestorRow ?? [])[0] as { nombre_cartera?: string } | undefined)?.nombre_cartera ?? null,
    gestorIds: ((supRows ?? []) as Array<{ gestor_id: string }>).map((r) => r.gestor_id),
    zonaIds: ((gerRows ?? []) as Array<{ zona_id: string }>).map((r) => r.zona_id)
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

export const obtenerCatalogos = async (): Promise<Catalogos> => {
  const client = getSupabaseClient();

  const [{ data: roles, error: rErr }, { data: zonas, error: zErr }, { data: gestores, error: gErr }, carteraGestores] =
    await Promise.all([
      client.from('roles').select('id, clave, nombre').order('nombre', { ascending: true }),
      client.from('zonas').select('id, nombre, codigo').eq('activo', true).order('nombre', { ascending: true }),
      client.from('gestores').select('id, nombre_cartera, usuario_id').eq('activo', true),
      distinctCarteraGestores()
    ]);

  if (rErr) throw new UsuariosError(`No se pudieron leer los roles: ${rErr.message}`);
  if (zErr) throw new UsuariosError(`No se pudieron leer las zonas: ${zErr.message}`);
  if (gErr) throw new UsuariosError(`No se pudieron leer los gestores: ${gErr.message}`);

  return {
    roles: ((roles ?? []) as Array<Record<string, unknown>>).map((r) => ({ id: String(r.id), clave: String(r.clave), nombre: String(r.nombre) })),
    zonas: ((zonas ?? []) as Array<Record<string, unknown>>).map((z) => ({ id: String(z.id), nombre: String(z.nombre), codigo: (z.codigo as string | null) ?? null })),
    gestores: ((gestores ?? []) as Array<Record<string, unknown>>).map((g) => ({ id: String(g.id), nombreCartera: (g.nombre_cartera as string | null) ?? null, usuarioId: (g.usuario_id as string | null) ?? null })),
    carteraGestores
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
    await client.from('gestores').update({ usuario_id: null }).eq('usuario_id', userId);
  }
  if (roleClave !== 'supervisor') {
    await client.from('supervisor_gestor').update({ activo: false }).eq('supervisor_id', userId);
  }
  if (roleClave !== 'gerente_zona') {
    await client.from('gerente_zona_zona').update({ activo: false }).eq('usuario_id', userId);
  }
};

/** Sincroniza las relaciones de alcance según el rol (reemplazo idempotente). */
const sincronizarRelaciones = async (
  userId: string,
  roleClave: string | null,
  input: { nombreCartera?: string | null; gestorIds?: string[]; zonaIds?: string[] }
): Promise<void> => {
  await limpiarRelacionesAjenas(userId, roleClave);
  const client = getSupabaseClient();

  // gestor → gestores.usuario_id + nombre_cartera (puente con cartera.gestor)
  if (roleClave === 'gestor' && input.nombreCartera) {
    // Desvincula cualquier gestor previo de este usuario y (re)asigna el elegido.
    await client.from('gestores').update({ usuario_id: null }).eq('usuario_id', userId);
    const { data: existente } = await client.from('gestores').select('id').eq('nombre_cartera', input.nombreCartera).limit(1);
    const row = (existente ?? [])[0] as { id?: string } | undefined;
    if (row?.id) {
      const { error } = await client.from('gestores').update({ usuario_id: userId, activo: true }).eq('id', row.id);
      if (error) throw new UsuariosError(`No se pudo vincular el gestor: ${error.message}`);
    } else {
      const { error } = await client.from('gestores').insert({ usuario_id: userId, nombre_cartera: input.nombreCartera, activo: true });
      if (error) throw new UsuariosError(`No se pudo crear el gestor: ${error.message}`);
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

  // gerente_zona → gerente_zona_zona (reemplaza asignaciones vigentes)
  if (roleClave === 'gerente_zona' && input.zonaIds) {
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
const ROLES_SIN_RELACION = ['administrador', 'liderazgo'];
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
