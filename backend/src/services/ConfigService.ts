import { getSupabaseClient } from '../config/supabaseClient';

export class ConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'ConfigError'; }
}
const c = () => getSupabaseClient();

/* ===== General ===== */
export const getGeneral = async (): Promise<Record<string, string>> => {
  const { data, error } = await c().from('config_general').select('clave, valor');
  if (error) throw new ConfigError(error.message);
  const o: Record<string, string> = {};
  ((data ?? []) as Array<{ clave: string; valor: string | null }>).forEach((r) => (o[r.clave] = r.valor ?? ''));
  return o;
};
export const setGeneral = async (patch: Record<string, string>, actor: string | null) => {
  const rows = Object.entries(patch).map(([clave, valor]) => ({ clave, valor: valor ?? '', updated_at: new Date().toISOString(), updated_by: actor }));
  if (!rows.length) return;
  const { error } = await c().from('config_general').upsert(rows, { onConflict: 'clave' });
  if (error) throw new ConfigError(error.message);
};

/* ===== Catálogos ===== */
export const listCatalogos = async (catalogo?: string) => {
  let q = c().from('config_catalogos').select('*').order('catalogo').order('orden');
  if (catalogo) q = q.eq('catalogo', catalogo);
  const { data, error } = await q;
  if (error) throw new ConfigError(error.message);
  return data ?? [];
};

/** Devuelve solo los valores ACTIVOS de un catálogo, ordenados. Fuente única para Gestión/Control. */
export const listCatalogoActivo = async (catalogo: string): Promise<Array<{ codigo: string | null; nombre: string }>> => {
  const { data, error } = await c()
    .from('config_catalogos')
    .select('codigo, nombre, activo, orden')
    .eq('catalogo', catalogo)
    .eq('activo', true)
    .order('orden');
  if (error) throw new ConfigError(error.message);
  return ((data ?? []) as Array<{ codigo: string | null; nombre: string }>).map((x) => ({ codigo: x.codigo, nombre: x.nombre }));
};
export const crearCatalogo = async (b: Record<string, unknown>) => {
  if (!b.catalogo || !b.nombre) throw new ConfigError('Catálogo y nombre son obligatorios.');
  const { data, error } = await c().from('config_catalogos').insert({ catalogo: b.catalogo, codigo: b.codigo ?? null, nombre: b.nombre, activo: b.activo ?? true, orden: b.orden ?? 0 }).select('id').single();
  if (error) throw new ConfigError(error.message);
  return { id: String((data as { id: string }).id) };
};
export const actualizarCatalogo = async (id: string, b: Record<string, unknown>) => {
  const patch: Record<string, unknown> = {};
  ['nombre', 'codigo', 'activo', 'orden'].forEach((k) => { if (b[k] !== undefined) patch[k] = b[k]; });
  const { error } = await c().from('config_catalogos').update(patch).eq('id', id);
  if (error) throw new ConfigError(error.message);
};
export const eliminarCatalogo = async (id: string) => {
  const { error } = await c().from('config_catalogos').delete().eq('id', id);
  if (error) throw new ConfigError(error.message);
};

/* ===== Variables ===== */
export const listVariables = async () => {
  const { data, error } = await c().from('config_variables').select('*').order('nombre');
  if (error) throw new ConfigError(error.message);
  return data ?? [];
};
export const crearVariable = async (b: Record<string, unknown>) => {
  if (!b.nombre) throw new ConfigError('El nombre es obligatorio.');
  const { data, error } = await c().from('config_variables').insert({ nombre: b.nombre, valor: b.valor ?? '', tipo: b.tipo ?? 'texto', descripcion: b.descripcion ?? null, activo: b.activo ?? true }).select('id').single();
  if (error) throw new ConfigError(error.message);
  return { id: String((data as { id: string }).id) };
};
export const actualizarVariable = async (id: string, b: Record<string, unknown>) => {
  const patch: Record<string, unknown> = {};
  ['valor', 'descripcion', 'activo', 'nombre', 'tipo'].forEach((k) => { if (b[k] !== undefined) patch[k] = b[k]; });
  const { error } = await c().from('config_variables').update(patch).eq('id', id);
  if (error) throw new ConfigError(error.message);
};

/* ===== Roles y permisos (reutiliza tablas existentes) ===== */
export const getRolesPermisos = async () => {
  const client = c();
  const [roles, permisos, rp] = await Promise.all([
    client.from('roles').select('id, clave, nombre').order('nombre'),
    client.from('permissions').select('id, clave, descripcion').order('clave'),
    client.from('role_permissions').select('role_id, permission_id')
  ]);
  return { roles: roles.data ?? [], permisos: permisos.data ?? [], asignaciones: rp.data ?? [] };
};
export const setRolPermisos = async (roleId: string, permissionIds: string[]) => {
  const client = c();
  const { error: delErr } = await client.from('role_permissions').delete().eq('role_id', roleId);
  if (delErr) throw new ConfigError(delErr.message);
  if (permissionIds.length) {
    const rows = permissionIds.map((pid) => ({ role_id: roleId, permission_id: pid }));
    const { error } = await client.from('role_permissions').insert(rows);
    if (error) throw new ConfigError(error.message);
  }
};

/* ===== Plantillas ===== */
export const listPlantillas = async () => {
  const { data, error } = await c().from('config_plantillas').select('*').order('nombre');
  if (error) throw new ConfigError(error.message);
  return data ?? [];
};
export const subirPlantilla = async (clave: string, nombreArchivo: string, buffer: Buffer, contentType: string, actor: string | null) => {
  const path = `plantillas/${clave}_${Date.now()}_${nombreArchivo.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const { error: upErr } = await c().storage.from('config-assets').upload(path, buffer, { contentType, upsert: false });
  if (upErr) throw new ConfigError(upErr.message);
  const { data: actual } = await c().from('config_plantillas').select('version').eq('clave', clave).single();
  const version = (((actual as { version?: number } | null)?.version) ?? 0) + 1;
  const { error } = await c().from('config_plantillas').update({ url: path, version, updated_at: new Date().toISOString(), updated_by: actor }).eq('clave', clave);
  if (error) throw new ConfigError(error.message);
  await c().from('config_plantillas_versiones').insert({ clave, url: path, version, updated_by: actor });
  return { path, version };
};

export const urlPlantilla = async (clave: string): Promise<string> => {
  const { data: row } = await c().from('config_plantillas').select('url').eq('clave', clave).single();
  const path = (row as { url?: string } | null)?.url;
  if (!path) throw new ConfigError('La plantilla no tiene archivo.');
  const { data, error } = await c().storage.from('config-assets').createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new ConfigError('No se pudo generar el enlace de descarga.');
  return data.signedUrl;
};

/* ===== Auditoría (solo consulta) ===== */
export interface AuditoriaFiltros { usuario?: string; entidad?: string; accion?: string; desde?: string; hasta?: string; search?: string; limit?: number; offset?: number; }
export const listAuditoria = async (f: AuditoriaFiltros) => {
  let q = c().from('auditoria').select('*', { count: 'exact' }).order('created_at', { ascending: false });
  if (f.usuario) q = q.eq('actor_id', f.usuario);
  if (f.entidad) q = q.eq('entidad', f.entidad);
  if (f.accion) q = q.eq('accion', f.accion);
  if (f.desde) q = q.gte('created_at', f.desde);
  if (f.hasta) q = q.lte('created_at', `${f.hasta}T23:59:59`);
  if (f.search) q = q.ilike('accion', `%${f.search}%`);
  const from = f.offset ?? 0;
  q = q.range(from, from + (f.limit ?? 50) - 1);
  const { data, error, count } = await q;
  if (error) throw new ConfigError(error.message);
  return { items: data ?? [], total: count ?? 0 };
};

/* ===== Assets (logos/fondos) ===== */
export const subirAsset = async (clave: string, nombreArchivo: string, buffer: Buffer, contentType: string, actor: string | null) => {
  const path = `assets/${clave}_${Date.now()}_${nombreArchivo.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const { error: upErr } = await c().storage.from('config-assets').upload(path, buffer, { contentType, upsert: false });
  if (upErr) throw new ConfigError(upErr.message);
  await setGeneral({ [clave]: path }, actor);
  return { path };
};
