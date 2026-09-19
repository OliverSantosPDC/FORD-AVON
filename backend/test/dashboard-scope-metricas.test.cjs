'use strict';

/**
 * Prueba de EXTREMO A EXTREMO de `CarteraService.getDashboard` (el método real
 * que alimenta TODAS las visuales del Dashboard: KPIs, Top Gestores, Top
 * Zonas, Resumen por PD, Resumen por Campaña, Resumen por País, opciones de
 * filtro). No prueba funciones puras aisladas: ejercita la cadena de
 * producción completa —
 *
 *   Usuario (resolveScopeContext) → rol/relaciones → gestor_pais_zona →
 *   ScopeContext → applyScope (frontera de seguridad) → filtros del usuario →
 *   TODAS las agregaciones/visuales del Dashboard
 *
 * — con un `CarteraRepository` falso (filas 100% ficticias, sin red) y el
 * mismo cliente Supabase falso en memoria usado en scope-por-rol.test.cjs
 * para resolver el ScopeContext y el catálogo de personas.
 *
 * Objetivo (Sección 10, ítems G/I/J/K/L/M/N/Q de la tarea "corrección
 * arquitectónica completa"): demostrar que NINGUNA visual del Dashboard
 * puede mostrar datos fuera del alcance, y que "Top Gestores"/"Top Zonas"/
 * "Resumen por PD"/"Resumen por Campaña"/"Resumen por País"/opciones de
 * filtro NUNCA se construyen desde TODA la cartera ni desde un catálogo de
 * personas ajeno al Supervisor conectado.
 *
 * Ejecutar (tras `npm run build`): node --test test/dashboard-scope-metricas.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const HOY = '2026-01-01';
const AYER = '2020-01-01';

/* ===== Base de datos en memoria (100% FICTICIA): un Supervisor con DOS
 * Gestores — uno que coincide por nombre con cartera, otro (el caso
 * Bryan Rodriguez/Angie Buch) que SOLO tiene alcance vía gestor_pais_zona —
 * y una cuenta de un Supervisor NO relacionado, para probar aislamiento. ===== */
const db = {
  acceso_global_temporal: [],
  gestores: [
    { id: 'g-A', usuario_id: 'user-gestorA', nombre_cartera: 'GESTOR REAL EN CARTERA', activo: true },
    { id: 'g-B', usuario_id: 'user-gestorB', nombre_cartera: 'GESTOR FANTASMA SIN CARTERA', activo: true },
    { id: 'g-C', usuario_id: 'user-gestorC', nombre_cartera: 'GESTOR DE OTRO SUPERVISOR', activo: true }
  ],
  gestor_pais_zona: [
    // gestorA: su alcance real es EXCLUSIVAMENTE este País-Zona (el puente de
    // texto por cartera.gestor fue eliminado — nunca autoriza nada).
    { id: 'gpz-0', gestor_id: 'g-A', zona_id: 'zona-108', pais: 'GUATEMALA', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'gpz-1', gestor_id: 'g-B', zona_id: 'zona-107', pais: 'GUATEMALA', activo: true, fecha_inicio: AYER, fecha_fin: null },
    // gestorC (de sup2, NO relacionado con sup1): su alcance real es Honduras/201.
    { id: 'gpz-2', gestor_id: 'g-C', zona_id: 'zona-201', pais: 'HONDURAS', activo: true, fecha_inicio: AYER, fecha_fin: null }
  ],
  gerente_zona_zona: [],
  zonas: [
    { id: 'zona-107', nombre: '107', activo: true },
    { id: 'zona-108', nombre: '108', activo: true },
    { id: 'zona-201', nombre: '201', activo: true }
  ],
  roles: [],
  profiles: [{ id: 'user-sup1', activo: true }, { id: 'user-sup2', activo: true }],
  supervisor_gestor: [
    { id: 'sg-1', supervisor_id: 'user-sup1', gestor_id: 'g-A', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sg-2', supervisor_id: 'user-sup1', gestor_id: 'g-B', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sg-3', supervisor_id: 'user-sup2', gestor_id: 'g-C', activo: true, fecha_inicio: AYER, fecha_fin: null }
  ],
  supervisor_gerente_zona: [],
  liderazgo_supervisor: [],
  asignaciones: []
};

/* ===== Cliente Supabase falso: soporta eq/in/lte/gte/or/limit/select/maybeSingle/order/range ===== */
const parseOrClause = (expr) => expr.split(',').map((clause) => {
  const m = clause.match(/^([\w.]+)\.(is|eq|gte|lte)\.(.+)$/);
  if (!m) return () => false;
  const [, col, op, rawVal] = m;
  return (row) => {
    const v = row[col];
    if (op === 'is') return rawVal === 'null' ? (v === null || v === undefined) : String(v) === rawVal;
    if (op === 'eq') return String(v) === rawVal;
    if (op === 'gte') return v !== null && v !== undefined && String(v) >= rawVal;
    if (op === 'lte') return v !== null && v !== undefined && String(v) <= rawVal;
    return false;
  };
});

class Builder {
  constructor(table) { this.table = table; this.filters = []; this.limitN = null; this.rangeArgs = null; }
  select() { return this; }
  order() { return this; }
  eq(col, val) { this.filters.push((row) => String(row[col]) === String(val)); return this; }
  in(col, vals) { this.filters.push((row) => (vals || []).map(String).includes(String(row[col]))); return this; }
  lte(col, val) { this.filters.push((row) => row[col] !== null && row[col] !== undefined && String(row[col]) <= String(val)); return this; }
  gte(col, val) { this.filters.push((row) => row[col] !== null && row[col] !== undefined && String(row[col]) >= String(val)); return this; }
  or(expr) { const preds = parseOrClause(expr); this.filters.push((row) => preds.some((p) => p(row))); return this; }
  limit(n) { this.limitN = n; return this; }
  range(from, to) { this.rangeArgs = [from, to]; return this; }
  _rows() {
    let rows = (db[this.table] || []).filter((row) => this.filters.every((f) => f(row)));
    if (this.rangeArgs) { const [from, to] = this.rangeArgs; rows = rows.slice(from, to + 1); }
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    return rows.map((r) => ({ ...r }));
  }
  maybeSingle() { const rows = this._rows(); return Promise.resolve({ data: rows[0] ?? null, error: null }); }
  then(resolve, reject) { return Promise.resolve({ data: this._rows(), error: null }).then(resolve, reject); }
}

const fakeClient = { from: (t) => new Builder(t) };
const supabaseJsPath = require.resolve('@supabase/supabase-js');
const fakeModule = new Module(supabaseJsPath);
fakeModule.exports = { createClient: () => fakeClient };
fakeModule.loaded = true;
require.cache[supabaseJsPath] = fakeModule;

const distDir = path.join(__dirname, '..', 'dist');
const { resolveScopeContext } = require(path.join(distDir, 'services', 'ScopeService.js'));
const { CarteraService } = require(path.join(distDir, 'services', 'CarteraService.js'));
const { CarteraRepository } = require(path.join(distDir, 'repositories', 'CarteraRepository.js'));

/* ===== Cartera ficticia: CTA-A (dentro del alcance de gestorA por SU
 * gestor_pais_zona; el texto "GESTOR REAL EN CARTERA" es solo exhibición),
 * CTA-B (dentro del alcance de gestorB SOLO por País-Zona — su nombre real de
 * cartera es distinto), CTA-OTRO (de un Supervisor NO relacionado, jamás debe
 * aparecer en ninguna visual de sup1). ===== */
const CARTERA_ROWS = [
  { codigo: 'CTA-A', gestor: 'GESTOR REAL EN CARTERA', pais: 'GUATEMALA', zona: '108', sector: 'S1', pd_actual: 'PD1', campania_adeuda: 'CAMPANIA-1', saldo_inicial_usd: 1000, saldo_actual_usd: 800, saldo_inicial: 1000, saldo_actual: 800 },
  { codigo: 'CTA-B', gestor: 'NOMBRE COMPLETAMENTE DISTINTO EN CARTERA', pais: 'GUATEMALA', zona: '107', sector: 'S2', pd_actual: 'PD2', campania_adeuda: 'CAMPANIA-2', saldo_inicial_usd: 2000, saldo_actual_usd: 500, saldo_inicial: 2000, saldo_actual: 500 },
  { codigo: 'CTA-OTRO', gestor: 'GESTOR DE OTRO SUPERVISOR', pais: 'HONDURAS', zona: '201', sector: 'S3', pd_actual: 'PD1', campania_adeuda: 'CAMPANIA-3', saldo_inicial_usd: 5000, saldo_actual_usd: 1000, saldo_inicial: 5000, saldo_actual: 1000 }
];

const carteraService = new CarteraService(new CarteraRepository({ getCartera: async () => CARTERA_ROWS.map((r) => ({ ...r })) }));

test('getDashboard (Supervisor): KPIs SOLO suman las cuentas de su alcance (G, Q) — nunca la cartera de otro Supervisor', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-sup1', roleClave: 'supervisor', permissions: [] });
  const dash = await carteraService.getDashboard(undefined, ctx);
  assert.equal(dash.kpis.totalCuentas, 2);
  assert.equal(dash.kpis.saldoAsignado, 3000); // 1000 (CTA-A) + 2000 (CTA-B), nunca los 5000 de CTA-OTRO
});

test('Top Gestores (J): nunca incluye al gestor de un Supervisor no relacionado, aunque exista en cartera', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-sup1', roleClave: 'supervisor', permissions: [] });
  const dash = await carteraService.getDashboard(undefined, ctx);
  const nombres = dash.topGestores.map((g) => g.nombre);
  assert.ok(!nombres.includes('GESTOR DE OTRO SUPERVISOR'), `Top Gestores no debe incluir cartera fuera de alcance: ${JSON.stringify(nombres)}`);
  const totalCuentas = dash.topGestores.reduce((a, g) => a + g.cuentas, 0);
  assert.equal(totalCuentas, 2);
});

test('Top Zonas (K): solo zonas dentro del alcance (nunca Honduras/201, fuera del alcance de sup1)', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-sup1', roleClave: 'supervisor', permissions: [] });
  const dash = await carteraService.getDashboard(undefined, ctx);
  const zonas = dash.topZonas.map((z) => z.zona);
  assert.deepEqual(zonas.sort(), ['107', '108']);
});

test('Resumen por PD (L) y Resumen por Campaña (M): respetan el alcance del Supervisor', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-sup1', roleClave: 'supervisor', permissions: [] });
  const dash = await carteraService.getDashboard(undefined, ctx);
  assert.equal(dash.resumenPD.reduce((a, p) => a + p.cuentas, 0), 2);
  assert.equal(dash.resumenCampania.reduce((a, c) => a + c.cuentas, 0), 2);
  assert.ok(!dash.resumenCampania.some((c) => c.campania === 'CAMPANIA-3'));
});

test('Cuentas (N) y Resumen por País: nunca exponen la fila fuera de alcance', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-sup1', roleClave: 'supervisor', permissions: [] });
  const dash = await carteraService.getDashboard(undefined, ctx);
  assert.deepEqual(dash.cuentas.map((c) => c.codigo).sort(), ['CTA-A', 'CTA-B']);
  const paisesResumen = dash.countrySummary.map((p) => p.pais);
  assert.ok(!paisesResumen.includes('Honduras'));
});

test('Opciones de filtro Gestor (Sección 2): catálogo de PERSONAS del Supervisor — incluye al Gestor sin match de nombre en cartera, excluye al de otro Supervisor', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-sup1', roleClave: 'supervisor', permissions: [] });
  const dash = await carteraService.getDashboard(undefined, ctx);
  assert.ok(dash.filterOptions.gestor.includes('GESTOR FANTASMA SIN CARTERA'), 'Debe aparecer aunque cartera.gestor diga otra cosa en su fila (alcance vía gestor_pais_zona).');
  assert.ok(dash.filterOptions.gestor.includes('GESTOR REAL EN CARTERA'));
  assert.ok(!dash.filterOptions.gestor.includes('GESTOR DE OTRO SUPERVISOR'), 'Un Gestor fuera del alcance del Supervisor NUNCA debe aparecer como opción.');
  // El texto crudo de cartera.gestor (sin persona real detrás) tampoco es una opción válida.
  assert.ok(!dash.filterOptions.gestor.includes('NOMBRE COMPLETAMENTE DISTINTO EN CARTERA'));
});

test('Seleccionar al Gestor sin match de nombre filtra la cartera por SU gestor_pais_zona, no por texto', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-sup1', roleClave: 'supervisor', permissions: [] });
  const dash = await carteraService.getDashboard({ gestor: 'GESTOR FANTASMA SIN CARTERA' }, ctx);
  assert.deepEqual(dash.cuentas.map((c) => c.codigo), ['CTA-B']);
});

test('Supervisor NO relacionado (sup2): ve EXCLUSIVAMENTE su propia cartera (aislamiento total)', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-sup2', roleClave: 'supervisor', permissions: [] });
  const dash = await carteraService.getDashboard(undefined, ctx);
  assert.equal(dash.kpis.totalCuentas, 1);
  assert.deepEqual(dash.cuentas.map((c) => c.codigo), ['CTA-OTRO']);
  assert.deepEqual(dash.filterOptions.gestor, ['GESTOR DE OTRO SUPERVISOR']);
});

test('Manipular el request con un gestor fuera de alcance nunca amplía el resultado (seguridad, Sección 19)', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-sup1', roleClave: 'supervisor', permissions: [] });
  // sup1 intenta pedir el gestor de sup2, que NO está en su catálogo de personas.
  const dash = await carteraService.getDashboard({ gestor: 'GESTOR DE OTRO SUPERVISOR' }, ctx);
  assert.deepEqual(dash.cuentas, []);
});
