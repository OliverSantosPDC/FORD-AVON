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

/**
 * Plantillas de TEXTO (cartas de cobro por PD): misma fila/clave/version/
 * updated_at/updated_by que una plantilla-archivo, pero el contenido editable
 * vive en la columna `contenido` (texto con variables «Placeholder»), no en
 * Storage — se edita en un textarea, no se "sube un archivo" cada vez.
 */
export interface PlantillaCartaRow {
  contenido: string | null;
  asunto: string | null;
  activo: boolean;
  version: number | null;
  updated_at: string | null;
  updated_by: string | null;
  /** Referencia estable (profiles.id) al supervisor cuya firma usa esta
   *  plantilla — NUNCA la imagen en sí. `null` = "Sin firma" explícito. */
  firma_supervisor_id: string | null;
}

export const leerPlantillaCarta = async (clave: string): Promise<PlantillaCartaRow | null> => {
  const { data, error } = await c().from('config_plantillas').select('contenido, asunto, activo, version, updated_at, updated_by, firma_supervisor_id').eq('clave', clave).maybeSingle();
  if (error) throw new ConfigError(error.message);
  return (data as PlantillaCartaRow | null) ?? null;
};

export const guardarPlantillaCarta = async (
  clave: string,
  patch: { contenido: string; asunto: string; activo: boolean; firmaSupervisorId: string | null },
  actor: string | null
) => {
  const { data: actual } = await c().from('config_plantillas').select('version').eq('clave', clave).maybeSingle();
  const version = (((actual as { version?: number } | null)?.version) ?? 0) + 1;
  const { error } = await c().from('config_plantillas')
    .update({
      contenido: patch.contenido, asunto: patch.asunto, activo: patch.activo, firma_supervisor_id: patch.firmaSupervisorId,
      version, updated_at: new Date().toISOString(), updated_by: actor
    })
    .eq('clave', clave);
  if (error) throw new ConfigError(error.message);
  await c().from('config_plantillas_versiones').insert({
    clave, contenido: patch.contenido, asunto: patch.asunto, firma_supervisor_id: patch.firmaSupervisorId, version, updated_by: actor, url: null
  });
  return { version };
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

/* ===== Firma de cartas, configurable POR SUPERVISOR (nunca global, nunca
 * hardcodeada) ===== Cada una de las 5 plantillas de carta de cobro elige
 * la firma de un supervisor REAL (roles.clave = 'supervisor'); la imagen
 * vive en el mismo bucket privado `config-assets` que logo/firma globales,
 * referenciada por `firmas_supervisor.storage_path` — `config_plantillas.
 * firma_supervisor_id` solo guarda el id del supervisor (profiles.id),
 * nunca la imagen. */

/** id de `roles` para la clave 'supervisor' — única consulta reutilizada
 *  por el resto de funciones de esta sección (nunca una lista hardcodeada
 *  de supervisores ni de roles). */
const idRolSupervisor = async (): Promise<string | null> => {
  const { data, error } = await c().from('roles').select('id').eq('clave', 'supervisor').maybeSingle();
  if (error) throw new ConfigError(error.message);
  return (data as { id?: string } | null)?.id ?? null;
};

/** `true` si `id` es un perfil REAL con rol supervisor (activo o no: una
 *  plantilla puede seguir referenciando a un supervisor que luego se
 *  desactivó — el estado se muestra, nunca bloquea silenciosamente). */
export const esSupervisor = async (id: string): Promise<boolean> => {
  const rolId = await idRolSupervisor();
  if (!rolId) return false;
  const { data } = await c().from('profiles').select('id').eq('id', id).eq('role_id', rolId).maybeSingle();
  return Boolean(data);
};

export interface SupervisorFirmaRow { id: string; nombre: string; apellido: string | null; activo: boolean; tieneFirma: boolean; }

/** Supervisores REALES del sistema (profiles con rol supervisor, activos
 *  o no) con si cada uno ya tiene una imagen de firma configurada —
 *  fuente única para el selector "Firma" de cada plantilla. Nunca una
 *  lista hardcodeada: si se da de alta/baja un supervisor, esta lista
 *  cambia sin tocar código. */
export const listarSupervisoresFirma = async (): Promise<SupervisorFirmaRow[]> => {
  const rolId = await idRolSupervisor();
  if (!rolId) return [];
  const { data: sups, error } = await c().from('profiles').select('id, nombre, apellido, activo').eq('role_id', rolId).order('nombre', { ascending: true });
  if (error) throw new ConfigError(error.message);
  const ids = ((sups ?? []) as Array<{ id: string }>).map((s) => s.id);
  const { data: firmas, error: fErr } = ids.length
    ? await c().from('firmas_supervisor').select('supervisor_id').in('supervisor_id', ids)
    : { data: [] as Array<{ supervisor_id: string }>, error: null };
  if (fErr) throw new ConfigError(fErr.message);
  const conFirma = new Set(((firmas ?? []) as Array<{ supervisor_id: string }>).map((f) => f.supervisor_id));
  return ((sups ?? []) as Array<Record<string, unknown>>).map((s) => ({
    id: String(s.id), nombre: String(s.nombre ?? ''), apellido: (s.apellido as string | null) ?? null,
    activo: Boolean(s.activo), tieneFirma: conFirma.has(String(s.id))
  }));
};

/** Sube/reemplaza la imagen de firma de UN supervisor. Reutiliza el mismo
 *  bucket/validación de imagen que `subirAsset`; `firmas_supervisor` es la
 *  única fuente de verdad de qué archivo le corresponde (upsert por
 *  supervisor_id: nunca dos filas para el mismo supervisor). El archivo
 *  anterior se limpia best-effort SOLO tras confirmar el nuevo guardado,
 *  igual que subirAsset. */
export const subirFirmaSupervisor = async (supervisorId: string, nombreArchivo: string, buffer: Buffer, contentType: string, actor: string | null) => {
  if (!contentType.toLowerCase().startsWith(IMAGE_MIME_PREFIX)) {
    throw new ConfigError('El archivo debe ser una imagen (PNG, JPG, GIF, WEBP, SVG, etc.).');
  }
  if (!(await esSupervisor(supervisorId))) throw new ConfigError('Supervisor no encontrado.');

  const path = `firmas/${supervisorId}_${Date.now()}_${nombreArchivo.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const { data: actual } = await c().from('firmas_supervisor').select('storage_path').eq('supervisor_id', supervisorId).maybeSingle();
  const pathAnterior = (actual as { storage_path?: string } | null)?.storage_path || null;

  const { error: upErr } = await c().storage.from('config-assets').upload(path, buffer, { contentType, upsert: false, cacheControl: '31536000' });
  if (upErr) throw new ConfigError(upErr.message);

  const { error } = await c().from('firmas_supervisor').upsert(
    { supervisor_id: supervisorId, storage_path: path, updated_at: new Date().toISOString(), updated_by: actor },
    { onConflict: 'supervisor_id' }
  );
  if (error) throw new ConfigError(error.message);

  if (pathAnterior && pathAnterior !== path) {
    try { await c().storage.from('config-assets').remove([pathAnterior]); } catch { /* best-effort */ }
  }
  return { path };
};

/** URL firmada de la firma de un supervisor, o `null` si no tiene ninguna
 *  configurada (nunca lanza por "no configurado" — el llamador decide cómo
 *  mostrarlo, ej. "[Firma no configurada]"). `supervisorId` puede ser
 *  `null` (plantilla con "Sin firma" explícito): también devuelve `null`. */
export const urlFirmaSupervisor = async (supervisorId: string | null): Promise<string | null> => {
  if (!supervisorId) return null;
  const { data: row } = await c().from('firmas_supervisor').select('storage_path').eq('supervisor_id', supervisorId).maybeSingle();
  const path = (row as { storage_path?: string } | null)?.storage_path;
  if (!path) return null;
  const { data, error } = await c().storage.from('config-assets').createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
};
