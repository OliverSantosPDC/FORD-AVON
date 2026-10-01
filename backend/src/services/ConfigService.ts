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

/* ===== Tasas de conversión ===== */
export const listTasasConversion = async () => {
  const { data, error } = await c().from('config_tasas_conversion').select('*').order('codigo');
  if (error) throw new ConfigError(error.message);
  // Postgres devuelve "numeric" como string vía PostgREST; se normaliza a number aquí
  // (fuente única) para que ningún consumidor (admin o Dashboard) reciba un tipo distinto.
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({ ...row, tasa: Number(row.tasa) }));
};
export const actualizarTasaConversion = async (id: string, b: Record<string, unknown>, actor: string | null) => {
  const tasa = Number(b.tasa);
  if (!Number.isFinite(tasa) || tasa <= 0) throw new ConfigError('La tasa debe ser un número mayor que 0.');
  const { error } = await c().from('config_tasas_conversion').update({ tasa, updated_at: new Date().toISOString(), updated_by: actor }).eq('id', id);
  if (error) throw new ConfigError(error.message);
  tasasPorMonedaCache = null; // invalida el caché corto: un cambio guardado se refleja de inmediato, no hasta que expire el TTL.
};

/**
 * CORRECCIÓN DE CONVERSIÓN MONETARIA (auditoría FORD-AVON): fuente única de
 * tasas VIGENTES para todo cálculo backend que convierta saldo local → USD
 * (ver getUsdEquivalente en utils/carteraAggregations.ts). Nunca usar las
 * columnas congeladas `saldo_actual_usd`/`saldo_inicial_usd` de `cartera`
 * como fuente — solo esta función, que lee `config_tasas_conversion` en
 * vivo. Caché corta (15 s, misma cadencia que el polling de
 * useTasasConversion en el frontend) para no repetir la consulta en cada
 * una de las varias agregaciones que corren dentro de un mismo request,
 * manteniendo la frescura muy por encima de "congelado desde la
 * importación". Fallback SEGURO ante fallo de Supabase: reutiliza el último
 * valor cacheado si existe (aunque haya expirado) antes que reventar todo
 * el dashboard; solo si nunca hubo un valor válido cae a `{ USD: 1 }`
 * (deja los saldos ya-en-USD intactos y evita una división por una tasa
 * inventada), y siempre registra el error en consola — nunca falla en
 * silencio.
 */
const TASAS_CACHE_TTL_MS = 15_000;
let tasasPorMonedaCache: { map: Record<string, number>; expires: number } | null = null;

export const getTasasPorMoneda = async (): Promise<Record<string, number>> => {
  const now = Date.now();
  if (tasasPorMonedaCache && tasasPorMonedaCache.expires > now) return tasasPorMonedaCache.map;

  try {
    const rows = await listTasasConversion();
    const map: Record<string, number> = {};
    for (const row of rows as Array<{ codigo?: string; tasa?: number }>) {
      if (row.codigo) map[row.codigo] = Number(row.tasa);
    }
    tasasPorMonedaCache = { map, expires: now + TASAS_CACHE_TTL_MS };
    return map;
  } catch (err) {
    console.error('[TASAS] getTasasPorMoneda: fallo al leer config_tasas_conversion', err instanceof Error ? err.message : err);
    if (tasasPorMonedaCache) return tasasPorMonedaCache.map;
    return { USD: 1 };
  }
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

/* ===== Assets (logos/fondos) =====
 * Formatos: cualquier image/* (PNG/JPEG/GIF/WEBP/SVG/BMP/TIFF/AVIF/...), nunca
 * otro tipo de archivo — validado por contentType (MIME), no por extensión ni
 * por el nombre original. SVG se admite igual que cualquier otra imagen: se
 * sirve siempre vía <img src="signedUrl">, nunca como documento navegado
 * directamente ni insertado con <object>/<iframe>, así que el navegador lo
 * trata como "contexto de imagen" y NUNCA ejecuta scripts embebidos en él
 * (restricción del propio navegador, no de este código) — no hace falta
 * sanitizar su XML para poder aceptarlo con seguridad.
 */
const IMAGE_MIME_PREFIX = 'image/';

export const subirAsset = async (clave: string, nombreArchivo: string, buffer: Buffer, contentType: string, actor: string | null) => {
  if (!contentType.toLowerCase().startsWith(IMAGE_MIME_PREFIX)) {
    throw new ConfigError('El archivo debe ser una imagen (PNG, JPG, GIF, WEBP, SVG, etc.).');
  }

  // Path estable y seguro: nunca depende de que el nombre original sea único
  // ni "limpio" (espacios/acentos/mayúsculas/caracteres especiales) — la
  // identidad real es `clave` + timestamp; el nombre original solo se anexa,
  // saneado, como sufijo legible.
  const path = `assets/${clave}_${Date.now()}_${nombreArchivo.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  // Se lee el path anterior ANTES de subir/guardar el nuevo, para poder
  // limpiarlo después — pero solo se borra tras confirmar que el nuevo quedó
  // guardado (ver más abajo): nunca se borra la imagen anterior por adelantado.
  const { data: actual } = await c().from('config_general').select('valor').eq('clave', clave).maybeSingle();
  const pathAnterior = (actual as { valor?: string } | null)?.valor || null;

  // cacheControl largo porque el path es único por subida (incluye
  // Date.now()): el objeto en esa ruta nunca cambia, así que cachearlo
  // agresivamente en el navegador es seguro y nunca sirve una versión vieja.
  const { error: upErr } = await c().storage.from('config-assets').upload(path, buffer, { contentType, upsert: false, cacheControl: '31536000' });
  if (upErr) throw new ConfigError(upErr.message);

  // Persistencia de la referencia en la MISMA operación (no dos pasos que
  // puedan desincronizarse): si esto falla, el archivo ya subido queda
  // huérfano pero la configuración sigue apuntando al anterior — nunca a una
  // referencia rota.
  await setGeneral({ [clave]: path }, actor);

  // Limpieza best-effort del archivo REEMPLAZADO — solo después de confirmar
  // que el nuevo path ya quedó guardado en config_general. Nunca debe romper
  // la respuesta al usuario: la subida ya es válida aunque esto falle.
  if (pathAnterior && pathAnterior !== path) {
    try { await c().storage.from('config-assets').remove([pathAnterior]); } catch { /* best-effort */ }
  }

  return { path };
};

/** URL firmada temporal para previsualizar/mostrar un asset (bucket privado:
 *  nunca se genera una URL pública). `null` si la clave no tiene archivo
 *  configurado o si Storage no puede firmar el path guardado — nunca lanza
 *  por "no configurado", solo por un error real de consulta. */
export const urlAsset = async (clave: string): Promise<string | null> => {
  const { data: row } = await c().from('config_general').select('valor').eq('clave', clave).maybeSingle();
  const path = (row as { valor?: string } | null)?.valor;
  if (!path) return null;
  const { data, error } = await c().storage.from('config-assets').createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
};
