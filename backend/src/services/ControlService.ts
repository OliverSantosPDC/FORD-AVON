import { getSupabaseClient } from '../config/supabaseClient';
import { registrarAuditoria } from './AuditoriaService';
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

// ===================== CALIDAD DE GESTIÓN =====================
export interface CalidadInput {
  gestorId?: string | null;
  gestorNombre: string;
  pais?: string | null;
  zona?: string | null;
  cuenta?: string | null;
  tipificacion?: string | null;
  criterios: Record<string, number>;       // { item: 0|1 }
  penalizaciones: Record<string, number>;   // { item: puntos a restar }
  observaciones?: string | null;
}
interface CalidadFiltro { pais?: string[]; zona?: string[]; gestor?: string[]; }

/** Nota = promedio de criterios (0..1) * 100 menos penalizaciones, acotada a [0,100]. */
const calcularNota = (criterios: Record<string, number>, penalizaciones: Record<string, number>): number => {
  const vals = Object.values(criterios ?? {}).map(num).filter((n) => Number.isFinite(n));
  const base = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) * 100 : 0;
  const pen = Object.values(penalizaciones ?? {}).map(num).reduce((a, b) => a + b, 0);
  return Math.max(0, Math.min(100, Number((base - pen).toFixed(2))));
};

/** Crea una evaluación de calidad. Requiere permiso control_operativo.calidad.editar (en la ruta). */
export const crearEvaluacionCalidad = async (ctx: ScopeContext, input: CalidadInput): Promise<{ id: string; nota: number }> => {
  if (!input.gestorNombre || !input.gestorNombre.trim()) throw new ControlError('El gestor evaluado es obligatorio.');
  const nota = calcularNota(input.criterios ?? {}, input.penalizaciones ?? {});
  const { data, error } = await c().from('calidad_gestion_evaluaciones').insert({
    gestor_id: input.gestorId ?? null,
    gestor_nombre: input.gestorNombre.trim(),
    pais: input.pais ?? null,
    zona: input.zona ?? null,
    cuenta: input.cuenta ?? null,
    tipificacion: input.tipificacion ?? null,
    evaluador_id: ctx.userId,
    criterios: input.criterios ?? {},
    penalizaciones: input.penalizaciones ?? {},
    nota,
    observaciones: input.observaciones ?? null
  }).select('id').single();
  if (error) throw new ControlError('No se pudo guardar la evaluación.');
  const id = (data as { id: string }).id;
  await registrarAuditoria(ctx.userId, 'calidad.evaluar', 'calidad_gestion_evaluaciones', id, { gestor: input.gestorNombre, nota });
  return { id, nota };
};

/** Lista evaluaciones respetando alcance (global ve todo; el resto lo que evaluó o de sus gestores). */
export const listarEvaluacionesCalidad = async (ctx: ScopeContext, f: CalidadFiltro): Promise<Row[]> => {
  const al = await usuariosAlcance(ctx);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = c().from('calidad_gestion_evaluaciones').select('*').order('created_at', { ascending: false }).limit(1000);
  if (!al.global) {
    const ids = al.ids.length ? al.ids : ['00000000-0000-0000-0000-000000000000'];
    q = q.or(`evaluador_id.in.(${ids.join(',')}),gestor_id.in.(${ids.join(',')})`);
  }
  if (f.pais?.length) q = q.in('pais', f.pais);
  if (f.zona?.length) q = q.in('zona', f.zona);
  if (f.gestor?.length) q = q.in('gestor_nombre', f.gestor);
  const { data, error } = await q;
  if (error) throw new ControlError('No se pudieron cargar las evaluaciones.');
  return (data ?? []) as Row[];
};

/** Resumen de calidad: nota global + por gestor/país/zona + principales penalizaciones. */
export const resumenCalidad = async (ctx: ScopeContext, f: CalidadFiltro) => {
  const rows = await listarEvaluacionesCalidad(ctx, f);
  const avg = (arr: number[]) => (arr.length ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)) : 0);
  const notas = rows.map((r) => num(r.nota));
  const group = (key: string) => {
    const m = new Map<string, number[]>();
    rows.forEach((r) => { const k = s(r[key]) || '—'; const it = m.get(k) ?? []; it.push(num(r.nota)); m.set(k, it); });
    return [...m.entries()].map(([clave, v]) => ({ clave, nota: avg(v), evaluaciones: v.length })).sort((a, b) => b.nota - a.nota);
  };
  const penMap = new Map<string, number>();
  rows.forEach((r) => {
    const p = (r.penalizaciones ?? {}) as Record<string, unknown>;
    Object.entries(p).forEach(([k, val]) => { const n = num(val); if (n > 0) penMap.set(k, (penMap.get(k) ?? 0) + n); });
  });
  const penalizaciones = [...penMap.entries()].map(([clave, total]) => ({ clave, total })).sort((a, b) => b.total - a.total).slice(0, 8);
  return { notaGlobal: avg(notas), evaluaciones: rows.length, porGestor: group('gestor_nombre'), porPais: group('pais'), porZona: group('zona'), penalizaciones };
};

/** Gestores disponibles para evaluar (según alcance). */
export const gestoresParaCalidad = async (ctx: ScopeContext): Promise<Array<{ usuarioId: string | null; nombre: string }>> => {
  const cl = c();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = cl.from('gestores').select('usuario_id, nombre_cartera').eq('activo', true);
  if (!ctx.isGlobal) q = q.in('id', ctx.gestorIds.length ? ctx.gestorIds : ['00000000-0000-0000-0000-000000000000']);
  const { data } = await q;
  return ((data ?? []) as Array<{ usuario_id: string | null; nombre_cartera: string | null }>)
    .filter((g) => g.nombre_cartera)
    .map((g) => ({ usuarioId: g.usuario_id, nombre: g.nombre_cartera as string }));
};
