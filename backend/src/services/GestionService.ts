import { getSupabaseClient } from '../config/supabaseClient';
import type { ScopeContext } from './ScopeService';

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
const usuariosDelAlcance = async (ctx: ScopeContext): Promise<{ global: boolean; ids: Set<string> }> => {
  if (ctx.isGlobal) return { global: true, ids: new Set() };
  const ids = new Set<string>([ctx.userId]);
  if (ctx.gestorIds.length > 0) {
    const { data } = await client().from('gestores').select('usuario_id').in('id', ctx.gestorIds);
    ((data ?? []) as Array<{ usuario_id: string | null }>).forEach((g) => g.usuario_id && ids.add(g.usuario_id));
  }
  return { global: false, ids };
};

/* ===== Tipificación / gestión ===== */
export const registrarTipificacion = async (codigo: string, tipificacion: string, comentario: string | null, gestorId: string | null) => {
  if (!tipificacion?.trim()) throw new GestionError('La tipificación es obligatoria.');
  const { error } = await client().from('gestion_log').insert({ codigo, tipificacion, comentario: comentario ?? null, gestor_id: gestorId });
  if (error) throw new GestionError(`No se pudo registrar la gestión: ${error.message}`);
};

/* ===== Detalle de cuenta ===== */
export const detalleCuenta = async (codigo: string) => {
  const c = client();
  const [logs, promesas, adjuntos, cartas] = await Promise.all([
    c.from('gestion_log').select('id, tipificacion, comentario, estado, gestor_id, created_at').eq('codigo', codigo).order('created_at', { ascending: false }),
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

/* ===== Cartas ===== */
export const crearCarta = async (codigo: string, tipo: string, comentario: string | null, gestorId: string | null) => {
  if (!tipo?.trim()) throw new GestionError('El tipo de carta es obligatorio.');
  const { data, error } = await client().from('gestion_cartas').insert({
    codigo, tipo, comentario: comentario ?? null, gestor_id: gestorId, estado: 'PENDIENTE_APROBACION'
  }).select('id').single();
  if (error) throw new GestionError(`No se pudo crear la carta: ${error.message}`);
  return { id: String((data as { id: string }).id) };
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
const addRow = (a: Agg, r: Row) => {
  a.cuentas += 1;
  a.saldoLocal += num(r.saldo_actual);
  a.saldoUsd += num(r.saldo_actual_usd);
  a.asignadoUsd += num(r.saldo_inicial_usd);
};
const out = (key: string, a: Agg, extra: Record<string, unknown> = {}) => ({
  ...extra, cuentas: a.cuentas, saldoLocal: a.saldoLocal, saldoUsd: a.saldoUsd,
  asignadoUsd: a.asignadoUsd, recuperadoUsd: a.asignadoUsd - a.saldoUsd, pctRecuperacion: pct(a.asignadoUsd - a.saldoUsd, a.asignadoUsd), key
});

export const aggregarZonasPd = (rows: Row[]) => {
  const zonas = new Map<string, { pais: string; agg: Agg; pds: Map<string, Agg> }>();
  for (const r of rows) {
    const zona = s(r.zona) || 'Sin zona';
    const z = zonas.get(zona) ?? { pais: s(r.pais), agg: emptyAgg(), pds: new Map() };
    addRow(z.agg, r);
    const pd = s(r.pd_actual) || 'Sin PD';
    const pa = z.pds.get(pd) ?? emptyAgg(); addRow(pa, r); z.pds.set(pd, pa);
    zonas.set(zona, z);
  }
  return Array.from(zonas.entries()).map(([zona, z]) => ({
    ...out(zona, z.agg, { zona, pais: z.pais }),
    pds: Array.from(z.pds.entries()).map(([pd, a]) => out(pd, a, { pd })).sort((x, y) => y.saldoUsd - x.saldoUsd)
  })).sort((x, y) => y.saldoLocal - x.saldoLocal);
};

export const aggregarPdCampanas = (rows: Row[]) => {
  const pds = new Map<string, { agg: Agg; camp: Map<string, Agg> }>();
  for (const r of rows) {
    const pd = s(r.pd_actual) || 'Sin PD';
    const p = pds.get(pd) ?? { agg: emptyAgg(), camp: new Map() };
    addRow(p.agg, r);
    const c = s(r.campania_adeuda) || 'Sin campaña';
    const ca = p.camp.get(c) ?? emptyAgg(); addRow(ca, r); p.camp.set(c, ca);
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

export const resolverCarta = async (id: string, aprobar: boolean, comentario: string | null, aprobadoPor: string | null) => {
  const { error } = await client().from('gestion_cartas').update({
    estado: aprobar ? 'APROBADA' : 'RECHAZADA',
    aprobado_por: aprobadoPor,
    comentario_aprobacion: comentario ?? null,
    updated_at: new Date().toISOString()
  }).eq('id', id);
  if (error) throw new GestionError(`No se pudo actualizar la carta: ${error.message}`);
};
