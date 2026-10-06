import { getSupabaseClient } from '../config/supabaseClient';
import { SUPABASE_CARTERA_TABLE } from '../config/env';
import { applyScope } from './ScopeFilter';
import { gestoresEnAlcance, gerentesZonaEnAlcance, type ScopeContext } from './ScopeService';
import { gestorPorPaisZona, overlayIdentidadReal, usdEquivalente } from '../utils/carteraAggregations';
import { renderizarCarta, type DatosCuentaCarta } from './CartaPdService';
import { urlAsset, storagePathFirmaSupervisor, urlFirmaPorPath } from './ConfigService';

/**
 * Operaciones de gestión de cobranza (tipificación, promesas, adjuntos, cartas).
 * Las visuales (mini dashboard, zonas, PD/campañas, cuentas) reutilizan
 * CarteraService.getDashboard (ya aplica scope). Aquí sólo la escritura + cartas.
 */

export class GestionError extends Error {
  constructor(message: string) { super(message); this.name = 'GestionError'; }
}

const client = () => getSupabaseClient();

/** Ids de usuario visibles para el actor (self + usuarios de sus gestores). */
export const usuariosDelAlcance = async (ctx: ScopeContext): Promise<{ global: boolean; ids: Set<string> }> => {
  if (ctx.isGlobal) return { global: true, ids: new Set() };
  const ids = new Set<string>([ctx.userId]);
  if (ctx.gestorIds.length > 0) {
    const { data } = await client().from('gestores').select('usuario_id').in('id', ctx.gestorIds);
    ((data ?? []) as Array<{ usuario_id: string | null }>).forEach((g) => g.usuario_id && ids.add(g.usuario_id));
  }
  return { global: false, ids };
};

/** true si gestorId (dueño de una carta) cae dentro del alcance del actor. Reutiliza usuariosDelAlcance. */
export const gestorEnAlcance = async (gestorId: string | null, ctx: ScopeContext): Promise<boolean> => {
  const alcance = await usuariosDelAlcance(ctx);
  if (alcance.global) return true;
  return !!gestorId && alcance.ids.has(gestorId);
};

/** Filtra una lista de códigos, devolviendo sólo los que están dentro del alcance del actor. */
export const filtrarCodigosEnAlcance = async (codigos: string[], ctx: ScopeContext): Promise<string[]> => {
  if (codigos.length === 0) return [];
  if (ctx.isGlobal) return codigos;
  const { data, error } = await getSupabaseClient().from(SUPABASE_CARTERA_TABLE).select('codigo, zona, pais').in('codigo', codigos);
  if (error) throw new GestionError(`No se pudo validar el alcance: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const scoped = applyScope(rows, ctx, { zonaField: 'zona', paisField: 'pais' });
  return scoped.map((r) => String(r.codigo));
};

/** Código de cuenta asociado a una promesa (o null si la promesa no existe). */
export const codigoDePromesa = async (id: string): Promise<string | null> => {
  const { data, error } = await client().from('gestion_promesas').select('codigo').eq('id', id).limit(1);
  if (error) throw new GestionError(`No se pudo leer la promesa: ${error.message}`);
  const rows = (data ?? []) as Array<{ codigo: string | null }>;
  return rows[0]?.codigo ?? null;
};

/** Código de cuenta asociado a un adjunto (o null si el adjunto no existe). */
export const codigoDeAdjunto = async (id: string): Promise<string | null> => {
  const { data, error } = await client().from('gestion_adjuntos').select('codigo').eq('id', id).limit(1);
  if (error) throw new GestionError(`No se pudo leer el adjunto: ${error.message}`);
  const rows = (data ?? []) as Array<{ codigo: string | null }>;
  return rows[0]?.codigo ?? null;
};

/** Datos mínimos (gestor_id) de una carta por id, o null si la carta no existe. */
export const gestorDeCarta = async (id: string): Promise<{ gestorId: string | null; codigo: string; pd: string | null } | null> => {
  const { data, error } = await client().from('gestion_cartas').select('gestor_id, codigo, pd').eq('id', id).limit(1);
  if (error) throw new GestionError(`No se pudo leer la carta: ${error.message}`);
  const rows = (data ?? []) as Array<{ gestor_id: string | null; codigo: string; pd: string | null }>;
  return rows.length ? { gestorId: rows[0].gestor_id, codigo: rows[0].codigo, pd: rows[0].pd } : null;
};

/* ===== Tipificación / gestión ===== */
export const registrarTipificacion = async (
  codigo: string, tipificacion: string, comentario: string | null,
  tipoContacto: string | null, canal: string | null, gestorId: string | null
) => {
  if (!tipificacion?.trim()) throw new GestionError('La tipificación es obligatoria.');
  const { error } = await client().from('gestion_log').insert({
    codigo, tipificacion, comentario: comentario ?? null,
    tipo_contacto: tipoContacto ?? null, canal: canal ?? null, gestor_id: gestorId
  });
  if (error) throw new GestionError(`No se pudo registrar la gestión: ${error.message}`);
};

/** Gestor EFECTIVO vigente para UN código (mismo criterio que
 *  `CarteraService.getAsignacionesVigentes`, acotado a una sola cuenta):
 *  `asignaciones.gestor_nuevo_id` más reciente → `gestores.nombre_cartera`,
 *  re-validado (`usuario_id`/`activo`) en la lectura. Nunca texto crudo. */
const gestorEfectivoDeCodigo = async (codigo: string): Promise<string | null> => {
  const { data } = await getSupabaseClient()
    .from('asignaciones')
    .select('gestor_nuevo_id, created_at')
    .eq('codigo', codigo)
    .order('created_at', { ascending: false })
    .limit(1);
  const gestorId = (data as Array<{ gestor_nuevo_id: string | null }> | null)?.[0]?.gestor_nuevo_id;
  if (!gestorId) return null;
  const { data: gestorRows } = await getSupabaseClient()
    .from('gestores')
    .select('nombre_cartera, usuario_id')
    .eq('id', gestorId)
    .eq('activo', true)
    .limit(1);
  const gestor = (gestorRows as Array<{ nombre_cartera: string | null; usuario_id: string | null }> | null)?.[0];
  return gestor?.nombre_cartera && gestor?.usuario_id ? gestor.nombre_cartera : null;
};

/* ===== Información completa de la cuenta (fila cruda de cartera, con scope
 * + IDENTIDAD REAL de Gestor/Gerente de zona — nunca cartera.gestor/gerente_zona crudos) ===== */
export const infoCuenta = async (codigo: string, ctx: ScopeContext): Promise<Record<string, unknown> | null> => {
  const { data, error } = await getSupabaseClient().from(SUPABASE_CARTERA_TABLE).select('*').eq('codigo', codigo).limit(1);
  if (error) throw new GestionError(`No se pudo leer la cuenta: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const scoped = applyScope(rows, ctx, { zonaField: 'zona', paisField: 'pais' });
  const row = scoped[0];
  if (!row) return null;

  const [gestores, gerentes, gestorEfectivo] = await Promise.all([
    gestoresEnAlcance(ctx),
    gerentesZonaEnAlcance(ctx),
    gestorEfectivoDeCodigo(codigo)
  ]);
  const overlaid = gestorEfectivo ? { ...row, gestor: gestorEfectivo, _gestorEfectivoOverride: true } : row;
  const [resuelto] = overlayIdentidadReal([overlaid], gestorPorPaisZona(gestores), gestorPorPaisZona(gerentes));
  return resuelto;
};

/* ===== Detalle de cuenta ===== */
export const detalleCuenta = async (codigo: string) => {
  const c = client();
  const [logs, promesas, adjuntos, cartas] = await Promise.all([
    c.from('gestion_log').select('id, tipificacion, comentario, estado, tipo_contacto, canal, gestor_id, created_at').eq('codigo', codigo).order('created_at', { ascending: false }),
    c.from('gestion_promesas').select('*').eq('codigo', codigo).order('created_at', { ascending: false }),
    c.from('gestion_adjuntos').select('*').eq('codigo', codigo).order('created_at', { ascending: false }),
    c.from('gestion_cartas').select('*').eq('codigo', codigo).order('created_at', { ascending: false })
  ]);
  return {
    historial: logs.data ?? [],
    promesas: promesas.data ?? [],
    adjuntos: adjuntos.data ?? [],
    cartas: cartas.data ?? []
  };
};

/* ===== Promesas ===== */
export const crearPromesa = async (codigo: string, body: Record<string, unknown>, createdBy: string | null) => {
  if (!body.fechaPromesa) throw new GestionError('La fecha de promesa es obligatoria.');
  if (body.monto !== undefined && body.monto !== null && Number(body.monto) <= 0) throw new GestionError('El monto debe ser mayor a cero.');
  const { data, error } = await client().from('gestion_promesas').insert({
    codigo,
    fecha_promesa: body.fechaPromesa,
    monto: body.monto ?? null,
    moneda: body.moneda ?? null,
    comentario: body.comentario ?? null,
    estado: (body.estado as string) ?? 'PENDIENTE',
    created_by: createdBy
  }).select('id').single();
  if (error) throw new GestionError(`No se pudo crear la promesa: ${error.message}`);
  return { id: String((data as { id: string }).id) };
};

export const actualizarPromesa = async (id: string, body: Record<string, unknown>) => {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.fechaPromesa !== undefined) patch.fecha_promesa = body.fechaPromesa;
  if (body.monto !== undefined) patch.monto = body.monto;
  if (body.moneda !== undefined) patch.moneda = body.moneda;
  if (body.comentario !== undefined) patch.comentario = body.comentario;
  if (body.estado !== undefined) patch.estado = body.estado;
  const { error } = await client().from('gestion_promesas').update(patch).eq('id', id);
  if (error) throw new GestionError(`No se pudo actualizar la promesa: ${error.message}`);
};

/* ===== Adjuntos (metadatos; el archivo va a Storage) ===== */
export const registrarAdjunto = async (codigo: string, tipoDocumento: string | null, nombre: string, url: string, subidoPor: string | null) => {
  const { data, error } = await client().from('gestion_adjuntos').insert({ codigo, tipo_documento: tipoDocumento, nombre, url, subido_por: subidoPor }).select('id').single();
  if (error) throw new GestionError(`No se pudo registrar el adjunto: ${error.message}`);
  return { id: String((data as { id: string }).id) };
};

export const eliminarAdjunto = async (id: string) => {
  const { error } = await client().from('gestion_adjuntos').delete().eq('id', id);
  if (error) throw new GestionError(`No se pudo eliminar el adjunto: ${error.message}`);
};

export const subirArchivoStorage = async (nombre: string, buffer: Buffer, contentType: string): Promise<string> => {
  const path = `${Date.now()}_${nombre.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const { error } = await client().storage.from('gestion-adjuntos').upload(path, buffer, { contentType, upsert: false });
  if (error) throw new GestionError(`No se pudo subir el archivo: ${error.message}`);
  return path;
};

/* ===== Cartas de cobro por PD ===== */

/** Vista previa SIN guardar nada: usa el PD y los datos ACTUALES de la cuenta
 *  (saldo, tasas, etc., siempre en vivo) — nunca una plantilla elegida por el
 *  cliente. Si el PD actual no tiene carta (PD0, o un PD no reconocido),
 *  `disponible` viene en `false` y no hay nada que previsualizar ni generar. */
export const previsualizarCarta = async (row: Record<string, unknown>, tasas: Record<string, number>) => {
  const datos: DatosCuentaCarta = {
    pais: row.pais, nombre: row.nombre, codigo: row.codigo, zona: row.zona,
    saldoActual: row.saldo_actual, campaniaAdeuda: row.campania_adeuda, pdActual: row.pd_actual
  };
  return renderizarCarta(datos, tasas);
};

/**
 * Genera y guarda la carta. El PD y la plantilla los decide ÚNICAMENTE el
 * backend a partir del PD ACTUAL de la cuenta (`row.pd_actual`, ya validado
 * en el alcance del actor por el caller) — el cliente NUNCA elige la
 * plantilla ni el tipo de carta. El contenido ya renderizado se guarda como
 * snapshot (no se recalcula después si cambian tasas/plantillas/variables).
 */
export const crearCarta = async (row: Record<string, unknown>, tasas: Record<string, number>, comentario: string | null, gestorId: string | null) => {
  const render = await previsualizarCarta(row, tasas);
  if (!render.disponible || !render.contenido) {
    if (render.variablesFaltantes.includes('plantilla_inactiva')) {
      throw new GestionError(`La plantilla de carta para ${render.pd ?? 'este PD'} está desactivada en Configuración.`);
    }
    throw new GestionError(`No hay plantilla de carta disponible para ${render.pd ?? 'este PD'}.`);
  }
  const { data, error } = await client().from('gestion_cartas').insert({
    codigo: row.codigo, tipo: render.plantillaClave, pd: render.pd, plantilla_clave: render.plantillaClave,
    contenido: render.contenido, comentario: comentario ?? null, gestor_id: gestorId, estado: 'PENDIENTE_APROBACION'
    // firma_supervisor_id NO se fija aquí: la firma la determina el
    // SUPERVISOR QUE AUTORIZA, no la plantilla ni el momento de creación —
    // ver resolverCarta/resolverCartasMasivo, que la snapshotean recién al
    // aprobar (queda null mientras la carta está PENDIENTE_APROBACION).
  }).select('id').single();
  if (error) throw new GestionError(`No se pudo crear la carta: ${error.message}`);
  return { id: String((data as { id: string }).id) };
};

/** Detalle de una carta YA guardada, con logo/firma SOLO si estado==='APROBADA'
 *  (nunca por un flag del cliente ni por el rol que consulta — el gate es
 *  exclusivamente el estado real de la carta, así que ni una llamada directa
 *  al endpoint ni un Gestor sin permiso de aprobar pueden obtenerlos antes). */
export const obtenerCarta = async (id: string) => {
  const { data, error } = await client().from('gestion_cartas').select('*').eq('id', id).limit(1);
  if (error) throw new GestionError(`No se pudo leer la carta: ${error.message}`);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const autorizada = row.estado === 'APROBADA';
  // La firma de una carta ya aprobada se resuelve EXCLUSIVAMENTE desde el
  // snapshot `firma_storage_path` (la ruta vigente en el momento exacto de
  // autorizar) — nunca releyendo la firma ACTUAL del supervisor por su id,
  // para que un cambio posterior de su firma predeterminada nunca altere
  // retroactivamente una carta ya aprobada.
  const [logoUrl, firmaUrl] = autorizada
    ? await Promise.all([urlAsset('logo_principal'), urlFirmaPorPath((row.firma_storage_path as string | null) ?? null)])
    : [null, null];
  return { ...row, logoUrl, firmaUrl, descargable: autorizada };
};

export const listarCartas = async (ctx: ScopeContext, filtros: { estado?: string; codigo?: string } = {}) => {
  let q = client().from('gestion_cartas').select('*').order('created_at', { ascending: false });
  if (filtros.estado) q = q.eq('estado', filtros.estado);
  if (filtros.codigo) q = q.eq('codigo', filtros.codigo);
  const { data, error } = await q;
  if (error) throw new GestionError(`No se pudieron leer las cartas: ${error.message}`);
  const alcance = await usuariosDelAlcance(ctx);
  let rows = (data ?? []) as Array<Record<string, unknown>>;
  if (!alcance.global) rows = rows.filter((c) => { const g = c.gestor_id as string | null; return g ? alcance.ids.has(g) : false; });
  return rows;
};

/* ===== Agregaciones jerárquicas y estado por cuenta ===== */
type Row = Record<string, unknown>;
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const pct = (rec: number, asig: number) => (asig === 0 ? 0 : Number(((rec / asig) * 100).toFixed(2)));
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

interface Agg { cuentas: number; saldoLocal: number; saldoUsd: number; asignadoUsd: number; }
const emptyAgg = (): Agg => ({ cuentas: 0, saldoLocal: 0, saldoUsd: 0, asignadoUsd: 0 });
/**
 * CORRECCIÓN DE CONVERSIÓN MONETARIA: `saldoUsd`/`asignadoUsd` se derivan
 * SIEMPRE de `saldo_actual`/`saldo_inicial` (moneda local real de la fila)
 * divididos entre la tasa vigente de la moneda del país de esa fila — nunca
 * de las columnas congeladas `saldo_actual_usd`/`saldo_inicial_usd` (ver
 * usdEquivalente en utils/carteraAggregations.ts). `saldoLocal` sigue siendo
 * el campo local crudo, sin tocar.
 */
const addRow = (a: Agg, r: Row, tasas: Record<string, number>) => {
  a.cuentas += 1;
  a.saldoLocal += num(r.saldo_actual);
  a.saldoUsd += usdEquivalente(num(r.saldo_actual), r.pais, tasas);
  a.asignadoUsd += usdEquivalente(num(r.saldo_inicial), r.pais, tasas);
};
const out = (key: string, a: Agg, extra: Record<string, unknown> = {}) => ({
  ...extra, cuentas: a.cuentas, saldoLocal: a.saldoLocal, saldoUsd: a.saldoUsd,
  asignadoUsd: a.asignadoUsd, recuperadoUsd: a.asignadoUsd - a.saldoUsd, pctRecuperacion: pct(a.asignadoUsd - a.saldoUsd, a.asignadoUsd), key
});

export const aggregarZonasPd = (rows: Row[], tasas: Record<string, number>) => {
  const zonas = new Map<string, { pais: string; agg: Agg; pds: Map<string, Agg> }>();
  for (const r of rows) {
    const zona = s(r.zona) || 'Sin zona';
    const z = zonas.get(zona) ?? { pais: s(r.pais), agg: emptyAgg(), pds: new Map() };
    addRow(z.agg, r, tasas);
    const pd = s(r.pd_actual) || 'Sin PD';
    const pa = z.pds.get(pd) ?? emptyAgg(); addRow(pa, r, tasas); z.pds.set(pd, pa);
    zonas.set(zona, z);
  }
  return Array.from(zonas.entries()).map(([zona, z]) => ({
    ...out(zona, z.agg, { zona, pais: z.pais }),
    pds: Array.from(z.pds.entries()).map(([pd, a]) => out(pd, a, { pd })).sort((x, y) => y.saldoUsd - x.saldoUsd)
  })).sort((x, y) => y.saldoLocal - x.saldoLocal);
};

export const aggregarPdCampanas = (rows: Row[], tasas: Record<string, number>) => {
  const pds = new Map<string, { agg: Agg; camp: Map<string, Agg> }>();
  for (const r of rows) {
    const pd = s(r.pd_actual) || 'Sin PD';
    const p = pds.get(pd) ?? { agg: emptyAgg(), camp: new Map() };
    addRow(p.agg, r, tasas);
    const c = s(r.campania_adeuda) || 'Sin campaña';
    const ca = p.camp.get(c) ?? emptyAgg(); addRow(ca, r, tasas); p.camp.set(c, ca);
    pds.set(pd, p);
  }
  return Array.from(pds.entries()).map(([pd, p]) => ({
    ...out(pd, p.agg, { pd }),
    campanas: Array.from(p.camp.entries()).map(([c, a]) => out(c, a, { campania: c })).sort((x, y) => y.saldoUsd - x.saldoUsd)
  })).sort((x, y) => y.saldoUsd - x.saldoUsd);
};

export const estadoCuentas = async (codigos: string[]): Promise<Record<string, { ultimaTipificacion: string | null; ultimaFecha: string | null; promesaVigente: string | null }>> => {
  const map: Record<string, { ultimaTipificacion: string | null; ultimaFecha: string | null; promesaVigente: string | null }> = {};
  if (codigos.length === 0) return map;
  const c = client();
  const [logs, proms] = await Promise.all([
    c.from('gestion_log').select('codigo, tipificacion, created_at').in('codigo', codigos).order('created_at', { ascending: false }),
    c.from('gestion_promesas').select('codigo, fecha_promesa, estado, created_at').in('codigo', codigos).eq('estado', 'PENDIENTE').order('created_at', { ascending: false })
  ]);
  ((logs.data ?? []) as Array<{ codigo: string; tipificacion: string; created_at: string }>).forEach((l) => {
    if (!map[l.codigo]) map[l.codigo] = { ultimaTipificacion: l.tipificacion, ultimaFecha: l.created_at, promesaVigente: null };
  });
  ((proms.data ?? []) as Array<{ codigo: string; fecha_promesa: string }>).forEach((p) => {
    map[p.codigo] = map[p.codigo] ?? { ultimaTipificacion: null, ultimaFecha: null, promesaVigente: null };
    if (!map[p.codigo].promesaVigente) map[p.codigo].promesaVigente = p.fecha_promesa;
  });
  return map;
};

export interface CuentaTipificada {
  codigo: string; nombre: string; pais: string; zona: string; gestor: string;
  pdActual: string; campaniaAdeuda: string; saldoActual: number;
  tipificacion: string | null;
  fechaGestion: string | null;
  comentarioGestion: string | null;
  tipoContacto: string | null;
  canal: string | null;
  fechaPromesa: string | null;
  montoPromesa: number | null;
  monedaPromesa: string | null;
  estadoPromesa: string | null;
  telefono: string | null;
}

/**
 * Clasifica cada cuenta YA ESCALADA/filtrada (`cuentasScoped`, de
 * `CarteraService.listCartera`, idéntica a la que ya usa la pestaña
 * Operación) por su ÚLTIMA gestión registrada (la fila más reciente de
 * `gestion_log` para ese código) y la enriquece con su promesa más
 * reciente (`gestion_promesas`), si tiene alguna — fuente para
 * Gestión > Tipificaciones. `gestion_log`/`gestion_promesas` se leen
 * COMPLETAS, sin filtrar por código ni por tipificación (son tablas
 * pequeñas: una sola lectura de cada una en total, nunca N consultas), y
 * el alcance queda garantizado porque solo se devuelven filas de esas dos
 * tablas cuyo código coincide con una fila YA presente en `cuentasScoped`
 * (que llegó aquí ya filtrada por alcance/filtros) — ninguna fila fuera de
 * alcance se expone, ni siquiera en la respuesta JSON cruda.
 * Gestión no tiene (todavía) un filtro de fecha/período propio, así que
 * "el período seleccionado" es, por ahora, el historial completo — ver la
 * nota equivalente en el frontend (Gestion/index.tsx, pestaña Tipificaciones).
 */
export const tipificacionesCuentas = async (cuentasScoped: Row[]): Promise<CuentaTipificada[]> => {
  const c = client();
  const [logs, proms] = await Promise.all([
    c.from('gestion_log').select('codigo, tipificacion, comentario, tipo_contacto, canal, created_at').order('created_at', { ascending: false }),
    c.from('gestion_promesas').select('codigo, fecha_promesa, monto, moneda, estado, created_at').order('created_at', { ascending: false })
  ]);
  if (logs.error) throw new GestionError(`No se pudo leer el historial de gestión: ${logs.error.message}`);
  if (proms.error) throw new GestionError(`No se pudieron leer las promesas: ${proms.error.message}`);

  type LogRow = { codigo: string; tipificacion: string; comentario: string | null; tipo_contacto: string | null; canal: string | null; created_at: string };
  type PromRow = { codigo: string; fecha_promesa: string; monto: number | string | null; moneda: string | null; estado: string; created_at: string };
  // Ambas listas vienen ordenadas por created_at DESC: la primera fila que
  // se ve por código es, por construcción, la más reciente ("última gestión").
  const ultimoLog = new Map<string, LogRow>();
  ((logs.data ?? []) as LogRow[]).forEach((l) => { if (!ultimoLog.has(l.codigo)) ultimoLog.set(l.codigo, l); });
  const ultimaPromesa = new Map<string, PromRow>();
  ((proms.data ?? []) as PromRow[]).forEach((p) => { if (!ultimaPromesa.has(p.codigo)) ultimaPromesa.set(p.codigo, p); });

  return cuentasScoped.map((r) => {
    const codigo = s(r.codigo);
    const log = ultimoLog.get(codigo);
    const prom = ultimaPromesa.get(codigo);
    // No existe un campo distinto de "WhatsApp" en el modelo de cartera:
    // se reutiliza el mismo teléfono celular (el único contacto móvil real
    // disponible) — nunca se inventa una columna nueva.
    const telefono = (s(r.telefono_celular) || s(r.telefono_casa) || s(r.telefono_trabajo)) || null;
    return {
      codigo, nombre: s(r.nombre), pais: s(r.pais), zona: s(r.zona), gestor: s(r.gestor),
      pdActual: s(r.pd_actual), campaniaAdeuda: s(r.campania_adeuda), saldoActual: num(r.saldo_actual),
      tipificacion: log ? log.tipificacion : null,
      fechaGestion: log ? log.created_at : null,
      comentarioGestion: log ? log.comentario : null,
      tipoContacto: log ? log.tipo_contacto : null,
      canal: log ? log.canal : null,
      fechaPromesa: prom ? prom.fecha_promesa : null,
      montoPromesa: prom ? num(prom.monto) : null,
      monedaPromesa: prom ? prom.moneda : null,
      estadoPromesa: prom ? prom.estado : null,
      telefono
    };
  });
};

/** Mensaje EXACTO cuando quien autoriza no tiene su firma predeterminada
 *  configurada — compartido por resolverCarta y resolverCartasMasivo para
 *  que el bloqueo sea idéntico en el flujo individual y en el masivo. */
export const SIN_FIRMA_AUTORIZACION_MSG = 'No tienes una firma de autorización configurada. Configura tu firma predeterminada antes de autorizar cartas.';

/**
 * Aprueba/rechaza UNA carta. Al APROBAR, la firma SIEMPRE es la firma
 * predeterminada de quien autoriza (`aprobadoPor`) — nunca una elegida por
 * plantilla ni por el Gestor — y se snapshotea EN ESTE MISMO MOMENTO en dos
 * columnas: `firma_supervisor_id` (quién autorizó, para auditoría) y
 * `firma_storage_path` (la RUTA EXACTA del archivo de firma vigente en ese
 * instante — la única fuente real de la imagen). Un cambio posterior de la
 * firma predeterminada del supervisor NO debe alterar retroactivamente una
 * carta ya aprobada, y como `firma_storage_path` queda fijo, no lo hace. Si
 * quien autoriza no tiene firma configurada, se rechaza la operación ANTES
 * de tocar la carta (nunca una aprobación parcial/sin firma).
 */
export const resolverCarta = async (id: string, aprobar: boolean, comentario: string | null, aprobadoPor: string | null) => {
  const patch: Record<string, unknown> = {
    estado: aprobar ? 'APROBADA' : 'RECHAZADA',
    aprobado_por: aprobadoPor,
    comentario_aprobacion: comentario ?? null,
    updated_at: new Date().toISOString()
  };
  if (aprobar) {
    if (!aprobadoPor) throw new GestionError('No se pudo identificar al supervisor que autoriza.');
    const path = await storagePathFirmaSupervisor(aprobadoPor);
    if (!path) throw new GestionError(SIN_FIRMA_AUTORIZACION_MSG);
    patch.firma_supervisor_id = aprobadoPor;
    patch.firma_storage_path = path;
  }
  const { error } = await client().from('gestion_cartas').update(patch).eq('id', id);
  if (error) throw new GestionError(`No se pudo actualizar la carta: ${error.message}`);
};

export interface ResolverCartasMasivoResultado {
  autorizadas: string[];
  omitidas: Array<{ id: string; motivo: string }>;
  /** `{id, codigo, gestorId}` de cada carta EFECTIVAMENTE autorizada — para
   *  que el caller (controller) pueda notificar a cada gestor sin una
   *  segunda consulta; nunca incluye las omitidas. */
  detalleAutorizadas: Array<{ id: string; codigo: string; gestorId: string | null }>;
}

/**
 * Autoriza EN LOTE una selección de cartas pendientes — mismo criterio de
 * firma que `resolverCarta` (snapshot de la firma predeterminada de
 * `actor` en el momento de autorizar), pero re-validando CADA carta contra
 * el alcance real de `actor` (nunca confía en que el frontend ya filtró
 * correctamente) y de forma atómica contra condiciones de carrera: el
 * UPDATE solo toca filas que SIGAN en PENDIENTE_APROBACION en el momento
 * exacto de ejecutarse (`.eq('estado', 'PENDIENTE_APROBACION')`), así que
 * una carta resuelta por alguien más entre la selección y el clic de
 * autorizar queda automáticamente en "omitidas", nunca sobrescrita.
 */
export const resolverCartasMasivo = async (
  ids: string[], comentario: string | null, actor: string, ctx: ScopeContext
): Promise<ResolverCartasMasivoResultado> => {
  const idsUnicos = Array.from(new Set(ids.filter((x) => typeof x === 'string' && x.trim())));
  if (idsUnicos.length === 0) return { autorizadas: [], omitidas: [], detalleAutorizadas: [] };

  const firmaPath = await storagePathFirmaSupervisor(actor);
  if (!firmaPath) throw new GestionError(SIN_FIRMA_AUTORIZACION_MSG);

  const { data: filas, error } = await client().from('gestion_cartas').select('id, gestor_id, codigo, estado').in('id', idsUnicos);
  if (error) throw new GestionError(`No se pudieron leer las cartas: ${error.message}`);
  const encontradas = new Map(((filas ?? []) as Array<{ id: string; gestor_id: string | null; codigo: string; estado: string }>).map((f) => [f.id, f]));

  const alcance = await usuariosDelAlcance(ctx);
  const omitidas: Array<{ id: string; motivo: string }> = [];
  const candidatas: string[] = [];
  for (const id of idsUnicos) {
    const fila = encontradas.get(id);
    if (!fila) { omitidas.push({ id, motivo: 'Carta no encontrada.' }); continue; }
    const enAlcance = alcance.global || (fila.gestor_id ? alcance.ids.has(fila.gestor_id) : false);
    if (!enAlcance) { omitidas.push({ id, motivo: 'Fuera de tu alcance.' }); continue; }
    if (fila.estado !== 'PENDIENTE_APROBACION') { omitidas.push({ id, motivo: `Ya está en estado ${fila.estado}.` }); continue; }
    candidatas.push(id);
  }
  if (candidatas.length === 0) return { autorizadas: [], omitidas, detalleAutorizadas: [] };

  const { data: actualizadas, error: updErr } = await client().from('gestion_cartas')
    .update({
      estado: 'APROBADA', aprobado_por: actor, comentario_aprobacion: comentario ?? null,
      updated_at: new Date().toISOString(), firma_supervisor_id: actor, firma_storage_path: firmaPath
    })
    .in('id', candidatas)
    .eq('estado', 'PENDIENTE_APROBACION')
    .select('id');
  if (updErr) throw new GestionError(`No se pudieron autorizar las cartas: ${updErr.message}`);

  const autorizadas = ((actualizadas ?? []) as Array<{ id: string }>).map((r) => r.id);
  const autorizadasSet = new Set(autorizadas);
  candidatas.forEach((id) => { if (!autorizadasSet.has(id)) omitidas.push({ id, motivo: 'Cambió de estado justo antes de autorizar.' }); });
  const detalleAutorizadas = autorizadas.map((id) => {
    const fila = encontradas.get(id)!;
    return { id, codigo: fila.codigo, gestorId: fila.gestor_id };
  });

  return { autorizadas, omitidas, detalleAutorizadas };
};
