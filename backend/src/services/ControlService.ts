import { getSupabaseClient } from '../config/supabaseClient';
import type { ScopeContext } from './ScopeService';

/**
 * Control Operativo: monitoreo diario. Reutiliza cartera (vía CarteraService en el
 * controller) y las tablas de gestión existentes (gestion_log/promesas/cartas/adjuntos).
 * No modifica Scope/Auth/Gestión. Las lecturas por usuario respetan el alcance.
 */
export class ControlError extends Error { constructor(m: string) { super(m); this.name = 'ControlError'; } }
const c = () => getSupabaseClient();

type Row = Record<string, unknown>;
const num = (v: unknown): number => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : 0; };
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const pct = (rec: number, asig: number) => (asig === 0 ? 0 : Number(((rec / asig) * 100).toFixed(2)));

interface Agg { cuentas: number; saldoLocal: number; saldoUsd: number; asignadoUsd: number; }
const emptyAgg = (): Agg => ({ cuentas: 0, saldoLocal: 0, saldoUsd: 0, asignadoUsd: 0 });
const add = (a: Agg, r: Row) => { a.cuentas += 1; a.saldoLocal += num(r.saldo_actual); a.saldoUsd += num(r.saldo_actual_usd); a.asignadoUsd += num(r.saldo_inicial_usd); };
const node = (key: string, a: Agg, extra: Record<string, unknown> = {}) => ({ ...extra, key, cuentas: a.cuentas, saldoLocal: a.saldoLocal, saldoUsd: a.saldoUsd, asignadoUsd: a.asignadoUsd, recuperadoUsd: a.asignadoUsd - a.saldoUsd, pctRecuperacion: pct(a.asignadoUsd - a.saldoUsd, a.asignadoUsd) });

/** Gestor → PD (con métricas). */
export const aggGestores = (rows: Row[]) => {
  const g = new Map<string, { agg: Agg; pds: Map<string, Agg> }>();
  for (const r of rows) {
    const gestor = s(r.gestor) || 'Sin gestor';
    const it = g.get(gestor) ?? { agg: emptyAgg(), pds: new Map() };
    add(it.agg, r);
    const pd = s(r.pd_actual) || 'Sin PD'; const pa = it.pds.get(pd) ?? emptyAgg(); add(pa, r); it.pds.set(pd, pa);
    g.set(gestor, it);
  }
  return [...g.entries()].map(([gestor, it]) => ({ ...node(gestor, it.agg, { gestor }), pds: [...it.pds.entries()].map(([pd, a]) => node(pd, a, { pd })).sort((x, y) => y.saldoUsd - x.saldoUsd) })).sort((x, y) => y.saldoLocal - x.saldoLocal);
};

/** Zona → Gestores (con métricas). */
export const aggZonasGestores = (rows: Row[]) => {
  const z = new Map<string, { pais: string; agg: Agg; ges: Map<string, Agg> }>();
  for (const r of rows) {
    const zona = s(r.zona) || 'Sin zona';
    const it = z.get(zona) ?? { pais: s(r.pais), agg: emptyAgg(), ges: new Map() };
    add(it.agg, r);
    const gestor = s(r.gestor) || 'Sin gestor'; const ga = it.ges.get(gestor) ?? emptyAgg(); add(ga, r); it.ges.set(gestor, ga);
    z.set(zona, it);
  }
  return [...z.entries()].map(([zona, it]) => ({ ...node(zona, it.agg, { zona, pais: it.pais }), gestores: [...it.ges.entries()].map(([g, a]) => node(g, a, { gestor: g })).sort((x, y) => y.saldoUsd - x.saldoUsd) })).sort((x, y) => y.saldoLocal - x.saldoLocal);
};

/** PD → Campañas. */
export const aggPdCampanas = (rows: Row[]) => {
  const p = new Map<string, { agg: Agg; camp: Map<string, Agg> }>();
  for (const r of rows) {
    const pd = s(r.pd_actual) || 'Sin PD';
    const it = p.get(pd) ?? { agg: emptyAgg(), camp: new Map() };
    add(it.agg, r);
    const cmp = s(r.campania_adeuda) || 'Sin campaña'; const ca = it.camp.get(cmp) ?? emptyAgg(); add(ca, r); it.camp.set(cmp, ca);
    p.set(pd, it);
  }
  return [...p.entries()].map(([pd, it]) => ({ ...node(pd, it.agg, { pd }), campanas: [...it.camp.entries()].map(([cmp, a]) => node(cmp, a, { campania: cmp })).sort((x, y) => y.saldoUsd - x.saldoUsd) })).sort((x, y) => y.saldoUsd - x.saldoUsd);
};

/** Conteos operativos derivados de la cartera (para KPIs). */
export const contadores = (rows: Row[]) => ({
  gestores: new Set(rows.map((r) => s(r.gestor)).filter(Boolean)).size,
  gerentes: new Set(rows.map((r) => s(r.gerente_zona)).filter(Boolean)).size,
  zonas: new Set(rows.map((r) => s(r.zona)).filter(Boolean)).size
});

/** Usuarios visibles según el alcance (self + usuarios de sus gestores). */
const usuariosAlcance = async (ctx: ScopeContext): Promise<{ global: boolean; ids: string[] }> => {
  if (ctx.isGlobal) return { global: true, ids: [] };
  const ids = new Set<string>([ctx.userId]);
  if (ctx.gestorIds.length) {
    const { data } = await c().from('gestores').select('usuario_id').in('id', ctx.gestorIds);
    ((data ?? []) as Array<{ usuario_id: string | null }>).forEach((g) => g.usuario_id && ids.add(g.usuario_id));
  }
  return { global: false, ids: [...ids] };
};

/** Indicadores operativos desde gestion_log/promesas/cartas/adjuntos (por alcance). */
export const indicadores = async (ctx: ScopeContext) => {
  const cl = c();
  const al = await usuariosAlcance(ctx);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flt = (q: any, col: string): any => (al.global ? q : q.in(col, al.ids));
  const [logs, prom, cartas, adj] = await Promise.all([
    flt(cl.from('gestion_log').select('canal, tipificacion', { count: 'exact' }), 'gestor_id'),
    flt(cl.from('gestion_promesas').select('estado', { count: 'exact' }), 'created_by'),
    flt(cl.from('gestion_cartas').select('estado', { count: 'exact' }), 'gestor_id'),
    flt(cl.from('gestion_adjuntos').select('id', { count: 'exact', head: true }), 'subido_por')
  ]);
  const l = (logs.data ?? []) as Array<{ canal: string | null; tipificacion: string | null }>;
  const canal = (n: string) => l.filter((x) => (x.canal ?? '').toLowerCase() === n).length;
  const pr = (prom.data ?? []) as Array<{ estado: string | null }>;
  const ca = (cartas.data ?? []) as Array<{ estado: string | null }>;
  return {
    gestiones: logs.count ?? l.length,
    llamadas: canal('llamada'), sms: canal('sms'), whatsapp: canal('whatsapp'), correos: canal('correo'),
    contactabilidad: l.filter((x) => (x.tipificacion ?? '') !== 'ABANDONO DE LLAMADA' && (x.tipificacion ?? '') !== 'Sin Resultado').length,
    promesas: prom.count ?? pr.length,
    cumplimientoPromesas: pr.filter((x) => x.estado === 'CUMPLIDA').length,
    cartasEmitidas: cartas.count ?? ca.length,
    cartasAprobadas: ca.filter((x) => x.estado === 'APROBADA').length,
    acuerdos: ca.filter((x) => (x.estado ?? '') !== 'RECHAZADA').length,
    adjuntos: adj.count ?? 0
  };
};

/** Pendientes para el panel del supervisor (promesas/cartas/adjuntos) por alcance. */
export const pendientes = async (ctx: ScopeContext) => {
  const cl = c();
  const al = await usuariosAlcance(ctx);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fp = (q: any, col: string): any => (al.global ? q : q.in(col, al.ids));
  const [prom, cartas] = await Promise.all([
    fp(cl.from('gestion_promesas').select('*').eq('estado', 'PENDIENTE').order('created_at', { ascending: false }), 'created_by'),
    fp(cl.from('gestion_cartas').select('*').eq('estado', 'PENDIENTE_APROBACION').order('created_at', { ascending: false }), 'gestor_id')
  ]);
  return { promesas: prom.data ?? [], cartas: cartas.data ?? [] };
};
