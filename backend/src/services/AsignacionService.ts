import { getSupabaseClient } from '../config/supabaseClient';
import { registrarAuditoria } from './AuditoriaService';
import type { ScopeContext } from './ScopeService';

/**
 * Asignación de cartera (Control Operativo). Persiste asignaciones/reasignaciones como
 * historial auditable en `asignaciones` (la cartera se recarga completa desde el ERP,
 * por lo que NO se muta la cartera; esta tabla es la fuente de verdad de la última
 * asignación por cuenta + trazabilidad). Respeta alcance: las filas llegan ya scoped.
 */
export class AsignacionError extends Error { constructor(m: string) { super(m); this.name = 'AsignacionError'; } }
const c = () => getSupabaseClient();
type Row = Record<string, unknown>;
const num = (v: unknown): number => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : 0; };
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const field = (r: Row, ...keys: string[]): unknown => { for (const k of keys) { const v = r[k]; if (v !== null && v !== undefined && String(v).trim() !== '') return v; } return undefined; };
const r2 = (n: number) => Number(n.toFixed(2));

export interface ReglaAsignacion {
  ambito?: 'GLOBAL' | 'PAIS' | 'ZONA';
  grupoPrioritarioPct: number;          // % de cartera al grupo prioritario (p.ej. 80)
  criterio: 'saldo' | 'cuentas';        // orden para definir el grupo prioritario
  gestoresPrioritario: string[];        // gestores del grupo prioritario
  gestoresResto: string[];              // gestores del grupo restante (opcional)
}
interface DistNode { clave: string; cuentas: number; saldoUsd: number; }
export interface SimGestor {
  gestor: string;
  cuentasActuales: number; cuentasPropuestas: number;
  saldoActualUsd: number; saldoPropuestoUsd: number;
  distPD: DistNode[]; distRiesgo: DistNode[]; distPais: DistNode[];
}

const distrib = (rows: Row[], keyFn: (r: Row) => string): DistNode[] => {
  const m = new Map<string, { cuentas: number; saldo: number }>();
  rows.forEach((r) => { const k = keyFn(r) || 'Sin dato'; const it = m.get(k) ?? { cuentas: 0, saldo: 0 }; it.cuentas += 1; it.saldo += num(field(r, 'saldo_actual_usd', 'saldo_actual')); m.set(k, it); });
  return [...m.entries()].map(([clave, v]) => ({ clave, cuentas: v.cuentas, saldoUsd: r2(v.saldo) })).sort((a, b) => b.saldoUsd - a.saldoUsd);
};

/** Calcula gestor propuesto por código según la regla (determinístico). */
const calcularPropuesta = (rows: Row[], regla: ReglaAsignacion): Map<string, string> => {
  const pct = Math.min(100, Math.max(0, num(regla.grupoPrioritarioPct)));
  const prioritario = (regla.gestoresPrioritario ?? []).filter(Boolean);
  const resto = (regla.gestoresResto ?? []).filter(Boolean);
  const propuesta = new Map<string, string>();
  if (prioritario.length === 0 && resto.length === 0) return propuesta;

  // Orden determinístico: por criterio desc y, a igualdad, por código asc.
  const ordenadas = [...rows].sort((a, b) => {
    const va = regla.criterio === 'cuentas' ? 0 : num(field(a, 'saldo_actual_usd', 'saldo_actual'));
    const vb = regla.criterio === 'cuentas' ? 0 : num(field(b, 'saldo_actual_usd', 'saldo_actual'));
    if (vb !== va) return vb - va;
    return s(field(a, 'codigo', 'code')).localeCompare(s(field(b, 'codigo', 'code')));
  });
  const cortePrioritario = Math.round(ordenadas.length * (pct / 100));
  ordenadas.forEach((r, i) => {
    const cod = s(field(r, 'codigo', 'code'));
    if (!cod) return;
    const enPrioritario = i < cortePrioritario;
    const pool = enPrioritario ? (prioritario.length ? prioritario : resto) : (resto.length ? resto : prioritario);
    if (pool.length === 0) return;
    const idxDentro = enPrioritario ? i : i - cortePrioritario;
    propuesta.set(cod, pool[idxDentro % pool.length]);
  });
  return propuesta;
};

/** Simulación: distribución propuesta por gestor (no persiste nada). */
export const simular = (rows: Row[], regla: ReglaAsignacion): { gestores: SimGestor[]; totalCuentas: number } => {
  const propuesta = calcularPropuesta(rows, regla);
  const gestores = new Set<string>([...(regla.gestoresPrioritario ?? []), ...(regla.gestoresResto ?? [])].filter(Boolean));
  rows.forEach((r) => { const g = s(field(r, 'gestor')); if (g) gestores.add(g); });
  const porGestorActual = new Map<string, Row[]>();
  const porGestorPropuesto = new Map<string, Row[]>();
  rows.forEach((r) => {
    const cod = s(field(r, 'codigo', 'code'));
    const actual = s(field(r, 'gestor')) || 'Sin gestor';
    const prop = propuesta.get(cod) ?? actual;
    (porGestorActual.get(actual) ?? porGestorActual.set(actual, []).get(actual)!).push(r);
    (porGestorPropuesto.get(prop) ?? porGestorPropuesto.set(prop, []).get(prop)!).push(r);
  });
  const salida: SimGestor[] = [...gestores].map((g) => {
    const act = porGestorActual.get(g) ?? [];
    const prop = porGestorPropuesto.get(g) ?? [];
    return {
      gestor: g,
      cuentasActuales: act.length, cuentasPropuestas: prop.length,
      saldoActualUsd: r2(act.reduce((a, r) => a + num(field(r, 'saldo_actual_usd', 'saldo_actual')), 0)),
      saldoPropuestoUsd: r2(prop.reduce((a, r) => a + num(field(r, 'saldo_actual_usd', 'saldo_actual')), 0)),
      distPD: distrib(prop, (r) => s(field(r, 'pd_actual', 'pd'))),
      distRiesgo: distrib(prop, (r) => s(field(r, 'riesgo', 'nivel_riesgo', 'riesgo_pd'))),
      distPais: distrib(prop, (r) => s(field(r, 'pais')))
    };
  }).sort((a, b) => b.cuentasPropuestas - a.cuentasPropuestas);
  return { gestores: salida, totalCuentas: rows.length };
};

/** Aplica la asignación: registra en `asignaciones` solo las cuentas que cambian de gestor. */
export const aplicar = async (ctx: ScopeContext, rows: Row[], regla: ReglaAsignacion): Promise<{ afectadas: number }> => {
  const propuesta = calcularPropuesta(rows, regla);
  const registros: Array<Record<string, unknown>> = [];
  rows.forEach((r) => {
    const cod = s(field(r, 'codigo', 'code'));
    const actual = s(field(r, 'gestor'));
    const nuevo = propuesta.get(cod);
    if (!cod || !nuevo || nuevo === actual) return;
    registros.push({ codigo: cod, gestor_anterior: actual || null, gestor_nuevo: nuevo, tipo: 'AUTO', regla: regla as unknown as Record<string, unknown>, pais: s(field(r, 'pais')) || null, asignado_por: ctx.userId });
  });
  if (registros.length === 0) return { afectadas: 0 };
  // Inserción por lotes (evita payloads enormes).
  for (let i = 0; i < registros.length; i += 1000) {
    const { error } = await c().from('asignaciones').insert(registros.slice(i, i + 1000));
    if (error) throw new AsignacionError(`No se pudo persistir la asignación: ${error.message}`);
  }
  await registrarAuditoria(ctx.userId, 'asignacion.aplicar', 'asignaciones', null, { afectadas: registros.length, regla });
  return { afectadas: registros.length };
};

/** Reasignación manual de una cuenta. Valida gestor destino activo. */
export const reasignarManual = async (
  ctx: ScopeContext,
  input: { codigo: string; gestorNuevo: string; motivo: string; gestorAnterior?: string | null; pais?: string | null }
): Promise<{ id: string }> => {
  const codigo = (input.codigo ?? '').trim();
  const gestorNuevo = (input.gestorNuevo ?? '').trim();
  const motivo = (input.motivo ?? '').trim();
  if (!codigo) throw new AsignacionError('La cuenta es obligatoria.');
  if (!gestorNuevo) throw new AsignacionError('El gestor destino es obligatorio.');
  if (!motivo) throw new AsignacionError('El motivo es obligatorio.');
  const { data: gestorRow } = await c().from('gestores').select('id').eq('nombre_cartera', gestorNuevo).eq('activo', true).limit(1);
  if (!gestorRow || (gestorRow as unknown[]).length === 0) throw new AsignacionError('El gestor destino no existe o está inactivo.');
  const { data, error } = await c().from('asignaciones').insert({
    codigo, gestor_anterior: input.gestorAnterior ?? null, gestor_nuevo: gestorNuevo, tipo: 'MANUAL', motivo, pais: input.pais ?? null, asignado_por: ctx.userId
  }).select('id').single();
  if (error) throw new AsignacionError(`No se pudo registrar la reasignación: ${error.message}`);
  const id = (data as { id: string }).id;
  await registrarAuditoria(ctx.userId, 'asignacion.reasignar', 'asignaciones', id, { codigo, gestorNuevo, motivo });
  return { id };
};

export interface HistorialFiltro { desde?: string; hasta?: string; pais?: string; gestorAnterior?: string; gestorNuevo?: string; tipo?: string; }
/** Historial de asignaciones (respeta alcance por país para roles no globales). */
export const listarHistorial = async (ctx: ScopeContext, f: HistorialFiltro): Promise<Row[]> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = c().from('asignaciones').select('*').order('created_at', { ascending: false }).limit(2000);
  if (!ctx.isGlobal && ctx.scope.paises.length) q = q.in('pais', ctx.scope.paises);
  if (f.pais) q = q.eq('pais', f.pais);
  if (f.gestorAnterior) q = q.eq('gestor_anterior', f.gestorAnterior);
  if (f.gestorNuevo) q = q.eq('gestor_nuevo', f.gestorNuevo);
  if (f.tipo) q = q.eq('tipo', f.tipo);
  if (f.desde) q = q.gte('created_at', f.desde);
  if (f.hasta) q = q.lte('created_at', `${f.hasta}T23:59:59`);
  const { data, error } = await q;
  if (error) throw new AsignacionError(`No se pudo cargar el historial: ${error.message}`);
  const rows = (data ?? []) as Row[];
  // Nombre del usuario que ejecutó (aditivo).
  const ids = [...new Set(rows.map((r) => r.asignado_por).filter((v): v is string => typeof v === 'string'))];
  if (ids.length) {
    const { data: perf } = await c().from('profiles').select('id, nombre, apellido').in('id', ids);
    const mapa = new Map<string, string>();
    ((perf ?? []) as Array<{ id: string; nombre: string | null; apellido: string | null }>).forEach((p) => mapa.set(p.id, [p.nombre, p.apellido].filter(Boolean).join(' ').trim()));
    return rows.map((r) => ({ ...r, asignado_por_nombre: typeof r.asignado_por === 'string' ? (mapa.get(r.asignado_por) || null) : null }));
  }
  return rows;
};
