import { getSupabaseClient } from '../config/supabaseClient';
import type { ScopeContext } from './ScopeService';
import { listarEventos } from './CalendarService';

/**
 * Centro de Inteligencia: agrega en el backend (una sola carga) métricas ejecutivas
 * sobre datos REALES ya existentes: cartera (scoped), gestion_promesas, calendar_events,
 * calidad_gestion_evaluaciones, metas e histórico. No duplica lógica de otros módulos;
 * los consume. Respeta ScopeService (las filas de cartera llegan ya scoped+filtradas).
 */
const c = () => getSupabaseClient();
type Row = Record<string, unknown>;

const num = (v: unknown): number => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : 0; };
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const field = (r: Row, ...keys: string[]): unknown => { for (const k of keys) { const v = r[k]; if (v !== null && v !== undefined && String(v).trim() !== '') return v; } return undefined; };
const pct = (part: number, whole: number) => (whole === 0 ? 0 : Number(((part / whole) * 100).toFixed(2)));
const round2 = (n: number) => Number(n.toFixed(2));

export interface CentroFiltros { pais?: string[]; zona?: string[]; pd?: string[]; gestor?: string[]; sector?: string[]; riesgo?: string[]; }
export interface Hallazgo { categoria: 'Gestión' | 'Cartera' | 'Calendario' | 'Operación'; nivel: 'Crítico' | 'Atención' | 'Informativo' | 'Positivo'; titulo: string; detalle: string; valor?: string; }

interface Grupo { clave: string; saldoAsignadoUsd: number; saldoActualUsd: number; recuperadoUsd: number; cuentas: number; pctRecuperacion: number; }

const agrupar = (rows: Row[], keyFn: (r: Row) => string): Grupo[] => {
  const m = new Map<string, { asig: number; act: number; cuentas: number }>();
  for (const r of rows) {
    const k = keyFn(r) || 'Sin dato';
    const it = m.get(k) ?? { asig: 0, act: 0, cuentas: 0 };
    it.asig += num(field(r, 'saldo_inicial_usd', 'saldo_inicial'));
    it.act += num(field(r, 'saldo_actual_usd', 'saldo_actual'));
    it.cuentas += 1;
    m.set(k, it);
  }
  return [...m.entries()].map(([clave, v]) => ({
    clave, saldoAsignadoUsd: round2(v.asig), saldoActualUsd: round2(v.act),
    recuperadoUsd: round2(v.asig - v.act), cuentas: v.cuentas, pctRecuperacion: pct(v.asig - v.act, v.asig)
  })).sort((a, b) => b.saldoActualUsd - a.saldoActualUsd);
};

export const getCentroInteligencia = async (ctx: ScopeContext, filtros: CentroFiltros, rows: Row[]) => {
  const now = new Date();
  const periodo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const diasTotal = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const diasTranscurridos = Math.max(1, now.getDate());
  const diasRestantes = Math.max(0, diasTotal - now.getDate());

  // ---- KPIs monetarios (USD y local) ----
  let asigUsd = 0, actUsd = 0, asigLocal = 0, actLocal = 0;
  for (const r of rows) {
    asigUsd += num(field(r, 'saldo_inicial_usd', 'saldo_inicial'));
    actUsd += num(field(r, 'saldo_actual_usd', 'saldo_actual'));
    asigLocal += num(field(r, 'saldo_inicial'));
    actLocal += num(field(r, 'saldo_actual'));
  }
  const recUsd = asigUsd - actUsd;
  const recLocal = asigLocal - actLocal;
  const kpis = {
    saldoAsignadoUsd: round2(asigUsd), saldoActualUsd: round2(actUsd), recuperadoUsd: round2(recUsd),
    saldoAsignadoLocal: round2(asigLocal), saldoActualLocal: round2(actLocal), recuperadoLocal: round2(recLocal),
    cuentas: rows.length, pctRecuperacion: pct(recUsd, asigUsd)
  };

  const recPorPais = agrupar(rows, (r) => s(field(r, 'pais')));
  const recPorPD = agrupar(rows, (r) => s(field(r, 'pd_actual', 'pd')));
  const porZona = agrupar(rows, (r) => s(field(r, 'zona')));
  const porSector = agrupar(rows, (r) => s(field(r, 'sector')));
  const porRiesgo = agrupar(rows, (r) => s(field(r, 'riesgo', 'nivel_riesgo', 'riesgo_pd')));
  const porGestor = agrupar(rows, (r) => s(field(r, 'gestor')));

  // ---- Metas (tabla configurable) ----
  const { data: metasRaw } = await c().from('metas').select('ambito, clave, monto_meta').eq('periodo', periodo);
  const metas = (metasRaw ?? []) as Array<{ ambito: string; clave: string | null; monto_meta: number }>;
  const metaGlobal = metas.find((m) => m.ambito === 'GLOBAL')?.monto_meta ?? null;
  const metasPorPais = metas.filter((m) => m.ambito === 'PAIS').map((m) => ({ pais: s(m.clave), montoUsd: num(m.monto_meta) }));
  const metasPorPD = metas.filter((m) => m.ambito === 'PD').map((m) => ({ pd: s(m.clave), montoUsd: num(m.monto_meta) }));
  const unicoPais = (filtros.pais ?? []).length === 1 ? (filtros.pais as string[])[0] : null;
  const metaContexto = unicoPais
    ? (metasPorPais.find((m) => m.pais.toUpperCase() === unicoPais.toUpperCase())?.montoUsd ?? null)
    : metaGlobal;
  const meta = { definida: metaContexto !== null && metaContexto !== undefined, montoUsd: metaContexto ?? null, ambito: unicoPais ? 'PAIS' : 'GLOBAL' };
  const cumplimientoPct = meta.definida && (meta.montoUsd as number) > 0 ? pct(recUsd, meta.montoUsd as number) : null;

  // ---- Promesas (gestion_promesas ↔ cartera por codigo, respeta scope vía set de codigos) ----
  const codigoInfo = new Map<string, { pais: string; pd: string }>();
  for (const r of rows) { const cod = s(field(r, 'codigo', 'code')); if (cod) codigoInfo.set(cod, { pais: s(field(r, 'pais')), pd: s(field(r, 'pd_actual', 'pd')) }); }
  const { data: promRaw } = await c().from('gestion_promesas').select('codigo, monto, fecha_promesa, estado').limit(100000);
  const hoyStr = now.toISOString().slice(0, 10);
  let promTotal = 0, promVigentes = 0, promVencidas = 0, promCumplidas = 0, cntTotal = 0, cntVig = 0, cntVen = 0, cntCum = 0;
  const promPaisMap = new Map<string, number>(); const promPDMap = new Map<string, number>();
  ((promRaw ?? []) as Array<{ codigo: string; monto: number | null; fecha_promesa: string; estado: string | null }>).forEach((p) => {
    const info = codigoInfo.get(p.codigo);
    if (!info) return; // fuera de alcance/filtros
    const monto = num(p.monto);
    promTotal += monto; cntTotal += 1;
    promPaisMap.set(info.pais, (promPaisMap.get(info.pais) ?? 0) + monto);
    promPDMap.set(info.pd, (promPDMap.get(info.pd) ?? 0) + monto);
    const estado = (p.estado ?? '').toUpperCase();
    if (estado === 'CUMPLIDA') { promCumplidas += monto; cntCum += 1; }
    else if (p.fecha_promesa && p.fecha_promesa < hoyStr) { promVencidas += monto; cntVen += 1; }
    else { promVigentes += monto; cntVig += 1; }
  });
  const promesas = {
    totalUsd: round2(promTotal), vigentesUsd: round2(promVigentes), vencidasUsd: round2(promVencidas), cumplidasUsd: round2(promCumplidas),
    cantidad: cntTotal, cantidadVigentes: cntVig, cantidadVencidas: cntVen, cantidadCumplidas: cntCum,
    porPais: [...promPaisMap.entries()].map(([clave, monto]) => ({ clave: clave || 'Sin dato', montoUsd: round2(monto) })).sort((a, b) => b.montoUsd - a.montoUsd),
    porPD: [...promPDMap.entries()].map(([clave, monto]) => ({ clave: clave || 'Sin dato', montoUsd: round2(monto) })).sort((a, b) => b.montoUsd - a.montoUsd)
  };

  // ---- Proyección (ritmo diario × días del mes) ----
  const ritmoDiario = recUsd / diasTranscurridos;
  const proyeccionUsd = round2(ritmoDiario * diasTotal);
  const proyeccionCumplimiento = meta.definida && (meta.montoUsd as number) > 0 ? pct(proyeccionUsd, meta.montoUsd as number) : null;
  const estadoProyeccion = proyeccionCumplimiento === null ? 'Sin meta definida'
    : proyeccionCumplimiento >= 100 ? 'Meta proyectada a cumplir'
    : proyeccionCumplimiento >= 90 ? 'Cercano al cumplimiento' : 'Riesgo de incumplimiento';
  const proyeccion = {
    recuperacionActualUsd: round2(recUsd), ritmoDiarioUsd: round2(ritmoDiario), recuperacionProyectadaUsd: proyeccionUsd,
    diferenciaVsMetaUsd: meta.definida ? round2(proyeccionUsd - (meta.montoUsd as number)) : null,
    cumplimientoProyectadoPct: proyeccionCumplimiento, estado: estadoProyeccion
  };

  // ---- Calidad (best-effort; honesto si no hay evaluaciones) ----
  let calNota: number | null = null; let calEval = 0; const penMap = new Map<string, number>();
  try {
    let q = c().from('calidad_gestion_evaluaciones').select('nota, penalizaciones, pais');
    if ((filtros.pais ?? []).length) q = q.in('pais', filtros.pais as string[]);
    const { data: calRaw } = await q.limit(100000);
    const cal = (calRaw ?? []) as Array<{ nota: number | null; penalizaciones: Record<string, unknown> | null }>;
    calEval = cal.length;
    if (cal.length) calNota = round2(cal.reduce((a, x) => a + num(x.nota), 0) / cal.length);
    cal.forEach((x) => Object.entries(x.penalizaciones ?? {}).forEach(([k, v]) => { const n = num(v); if (n > 0) penMap.set(k, (penMap.get(k) ?? 0) + n); }));
  } catch { /* tabla puede no existir aún */ }
  const calidad = { notaGlobal: calNota, evaluaciones: calEval, penalizaciones: [...penMap.entries()].map(([clave, total]) => ({ clave, total })).sort((a, b) => b.total - a.total).slice(0, 6) };

  // ---- Calendario (eventos reales dentro del alcance) ----
  const finMes = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const iniMes = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  let eventos: Array<Record<string, unknown>> = [];
  try { eventos = await listarEventos(ctx, { desde: iniMes, hasta: finMes }); } catch { eventos = []; }
  const esTipo = (e: Row, ...keys: string[]) => { const t = (e.event_types as { codigo?: string; nombre?: string } | null); const txt = `${t?.codigo ?? ''} ${t?.nombre ?? ''}`.toUpperCase(); return keys.some((k) => txt.includes(k)); };
  const asuetos = eventos.filter((e) => esTipo(e, 'ASUETO', 'FERIADO'));
  const incapacidades = eventos.filter((e) => esTipo(e, 'INCAP'));
  const proximos = eventos.filter((e) => s(field(e, 'fecha_inicio')) >= hoyStr).sort((a, b) => s(field(a, 'fecha_inicio')).localeCompare(s(field(b, 'fecha_inicio')))).slice(0, 8);

  // ---- HALLAZGOS (solo con datos reales) ----
  const hallazgos: Hallazgo[] = [];
  // Cartera
  if (recPorPais.length) { const top = recPorPais[0]; hallazgos.push({ categoria: 'Cartera', nivel: 'Informativo', titulo: 'País con mayor saldo actual', detalle: `${top.clave} concentra el mayor saldo actual de la cartera filtrada.`, valor: `$${top.saldoActualUsd.toLocaleString()}` }); }
  if (porZona.length) { const z = porZona[0]; hallazgos.push({ categoria: 'Cartera', nivel: 'Atención', titulo: 'Zona con mayor concentración', detalle: `La zona ${z.clave} concentra el mayor saldo actual.`, valor: `$${z.saldoActualUsd.toLocaleString()} · ${z.cuentas} cuentas` }); }
  if (porSector.length && porSector[0].clave !== 'Sin dato') { const se = porSector[0]; hallazgos.push({ categoria: 'Cartera', nivel: 'Informativo', titulo: 'Sector con mayor saldo', detalle: `El sector ${se.clave} presenta el mayor saldo actual.`, valor: `$${se.saldoActualUsd.toLocaleString()}` }); }
  if (recPorPD.length) { const pdCrit = [...recPorPD].sort((a, b) => a.pctRecuperacion - b.pctRecuperacion)[0]; hallazgos.push({ categoria: 'Cartera', nivel: pdCrit.pctRecuperacion < 20 ? 'Crítico' : 'Atención', titulo: 'PD con menor recuperación', detalle: `${pdCrit.clave} muestra el menor % de recuperación entre los PD.`, valor: `${pdCrit.pctRecuperacion}%` }); }
  if (porRiesgo.length && porRiesgo[0].clave !== 'Sin dato') { const rg = porRiesgo[0]; hallazgos.push({ categoria: 'Cartera', nivel: 'Atención', titulo: 'Mayor exposición por riesgo', detalle: `El nivel de riesgo ${rg.clave} concentra el mayor saldo.`, valor: `$${rg.saldoActualUsd.toLocaleString()}` }); }
  // Gestión
  if (porGestor.length) { const mej = porGestor.slice().sort((a, b) => b.recuperadoUsd - a.recuperadoUsd)[0]; if (mej && mej.recuperadoUsd > 0) hallazgos.push({ categoria: 'Gestión', nivel: 'Positivo', titulo: 'Gestor con mayor recuperación', detalle: `${mej.clave} lidera la recuperación en el alcance filtrado.`, valor: `$${mej.recuperadoUsd.toLocaleString()}` }); }
  if (cntVen > 0) hallazgos.push({ categoria: 'Gestión', nivel: 'Crítico', titulo: 'Promesas vencidas', detalle: `Existen promesas de pago vencidas que requieren seguimiento.`, valor: `${cntVen} · $${round2(promVencidas).toLocaleString()}` });
  if (cntVig > 0) hallazgos.push({ categoria: 'Gestión', nivel: 'Informativo', titulo: 'Promesas vigentes', detalle: `Promesas de pago vigentes pendientes de cumplimiento.`, valor: `${cntVig} · $${round2(promVigentes).toLocaleString()}` });
  // Calendario
  if (asuetos.length) { hallazgos.push({ categoria: 'Calendario', nivel: 'Atención', titulo: 'Asuetos en el período', detalle: `El período contiene asuetos/feriados que reducen días operativos.`, valor: `${asuetos.length}` }); }
  if (incapacidades.length) { hallazgos.push({ categoria: 'Calendario', nivel: 'Atención', titulo: 'Incapacidades en el período', detalle: `Hay incapacidades registradas que afectan la capacidad operativa.`, valor: `${incapacidades.length}` }); }
  if (proximos.length) { const px = proximos[0]; hallazgos.push({ categoria: 'Calendario', nivel: 'Informativo', titulo: 'Próximo evento relevante', detalle: `${s(field(px, 'titulo'))} el ${s(field(px, 'fecha_inicio'))}.`, valor: s((px.event_types as { nombre?: string } | null)?.nombre) || undefined }); }
  // Operación
  if (calNota !== null) { hallazgos.push({ categoria: 'Operación', nivel: calNota >= 75 ? 'Positivo' : calNota >= 60 ? 'Atención' : 'Crítico', titulo: 'Nota global de calidad', detalle: `Calidad de gestión promedio (fuente: Control Operativo).`, valor: `${calNota} / 100 · ${calEval} eval.` }); }
  if (calidad.penalizaciones.length) { const p0 = calidad.penalizaciones[0]; hallazgos.push({ categoria: 'Operación', nivel: 'Atención', titulo: 'Principal penalización de calidad', detalle: `${p0.clave} es la penalización más frecuente en las evaluaciones.`, valor: `${p0.total}` }); }

  // ---- Histórico mensual (real; vacío si no hay snapshots) ----
  let histQuery = c().from('inteligencia_historico_mensual').select('periodo, pais, saldo_asignado_usd, saldo_actual_usd, recuperado_usd, cuentas, meta_usd').order('periodo');
  if (!ctx.isGlobal && ctx.scope.paises.length) histQuery = histQuery.in('pais', ctx.scope.paises);
  if ((filtros.pais ?? []).length) histQuery = histQuery.in('pais', filtros.pais as string[]);
  const { data: histRaw } = await histQuery.limit(1000);
  const histAgg = new Map<string, { asig: number; act: number; rec: number; cuentas: number; meta: number | null }>();
  ((histRaw ?? []) as Array<{ periodo: string; saldo_asignado_usd: number; saldo_actual_usd: number; recuperado_usd: number; cuentas: number; meta_usd: number | null }>).forEach((h) => {
    const it = histAgg.get(h.periodo) ?? { asig: 0, act: 0, rec: 0, cuentas: 0, meta: null };
    it.asig += num(h.saldo_asignado_usd); it.act += num(h.saldo_actual_usd); it.rec += num(h.recuperado_usd); it.cuentas += num(h.cuentas);
    if (h.meta_usd !== null && h.meta_usd !== undefined) it.meta = (it.meta ?? 0) + num(h.meta_usd);
    histAgg.set(h.periodo, it);
  });
  const historico = [...histAgg.entries()].map(([per, v]) => ({
    periodo: per, saldoAsignadoUsd: round2(v.asig), saldoActualUsd: round2(v.act), recuperadoUsd: round2(v.rec), cuentas: v.cuentas,
    pctRecuperacion: pct(v.rec, v.asig), metaUsd: v.meta, cumplimientoPct: v.meta && v.meta > 0 ? pct(v.rec, v.meta) : null
  })).sort((a, b) => a.periodo.localeCompare(b.periodo));

  return {
    periodo,
    dias: { transcurridos: now.getDate(), total: diasTotal, restantes: diasRestantes },
    kpis,
    meta,
    metasPorPais,
    metasPorPD,
    cumplimiento: { pct: cumplimientoPct },
    recuperacion: { porPais: recPorPais, porPD: recPorPD, porZona, porSector, porRiesgo },
    promesas,
    proyeccion,
    hallazgos,
    historico,
    calidad,
    filtros
  };
};
