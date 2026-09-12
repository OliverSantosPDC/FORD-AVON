'use strict';

/**
 * Pruebas de extremo a extremo del ScopeService/ScopeFilter POR ROL (Secciones
 * 3, 9-12, 22, 24 de la tarea "conexión definitiva usuarios/scope/filtros").
 *
 * Ejercita el código YA COMPILADO en dist/ (resolveScopeContext + applyScope,
 * funciones REALES) con un cliente Supabase falso en memoria (datos 100%
 * ficticios) para probar, con una jerarquía completa
 * (Liderazgo -> Supervisor -> Gestor/Gerente de zona -> País-Zona):
 *
 *  - ADMINISTRADOR ve todo (isGlobal).
 *  - LIDERAZGO ve exactamente el alcance transitivo de SUS Supervisores
 *    asignados (Gestores + Gerentes de zona + País-Zona), nunca el de un
 *    Liderazgo/Supervisor no relacionado.
 *  - SUPERVISOR ve exactamente sus propios Gestores/Gerentes de zona.
 *  - GESTOR ve exactamente sus propios País-Zona (gestor_pais_zona).
 *  - GERENTE DE ZONA ve exactamente sus propios País-Zona (gerente_zona_zona).
 *  - PRUEBA CRÍTICA (Sección 24): un Gestor cuyo `nombre_cartera` NO existe en
 *    ninguna fila de `cartera.gestor` (la fuente de personas es USUARIOS, no
 *    cartera) sigue viendo su cartera correspondiente a su País-Zona asignado
 *    — nunca depende de la coincidencia de nombre.
 *  - Aislamiento/seguridad: los datos de un Supervisor/Liderazgo NO
 *    relacionado nunca aparecen, sin importar qué se intente "forzar".
 *
 * Ejecutar (tras `npm run build`): node --test test/scope-por-rol.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const HOY = '2026-01-01';
const AYER = '2020-01-01';

/* ===== Base de datos en memoria (100% FICTICIA) ===== */
const db = {
  acceso_global_temporal: [],
  gestores: [
    { id: 'g-A', usuario_id: 'user-gestorA', nombre_cartera: 'GESTOR REAL EN CARTERA', activo: true },
    // gestorB: SU NOMBRE NO EXISTE EN NINGUNA FILA DE cartera.gestor (prueba crítica Sección 24).
    { id: 'g-B', usuario_id: 'user-gestorB', nombre_cartera: 'GESTOR FANTASMA SIN CARTERA', activo: true },
    // gestorC: pertenece a un Supervisor NO relacionado (aislamiento).
    { id: 'g-C', usuario_id: 'user-gestorC', nombre_cartera: 'GESTOR DE OTRO SUPERVISOR', activo: true }
  ],
  gestor_pais_zona: [
    // gestorB NO tiene coincidencia de nombre en cartera: su ÚNICA fuente de alcance es este País-Zona.
    { id: 'gpz-1', gestor_id: 'g-B', zona_id: 'zona-107', pais: 'GUATEMALA', activo: true, fecha_inicio: AYER, fecha_fin: null }
  ],
  gerente_zona_zona: [
    { id: 'gzz-1', usuario_id: 'user-gerente1', zona_id: 'zona-107', pais: 'REPUBLICA DOMINICANA', activo: true, fecha_inicio: AYER, fecha_fin: null },
    // gerente2: de un Supervisor NO relacionado (aislamiento).
    { id: 'gzz-2', usuario_id: 'user-gerente2', zona_id: 'zona-201', pais: 'HONDURAS', activo: true, fecha_inicio: AYER, fecha_fin: null }
  ],
  zonas: [
    { id: 'zona-107', nombre: '107', activo: true },
    { id: 'zona-201', nombre: '201', activo: true }
  ],
  profiles: [
    { id: 'user-sup1', activo: true },
    { id: 'user-sup2', activo: true },
    { id: 'user-gerente1', activo: true },
    { id: 'user-gerente2', activo: true }
  ],
  supervisor_gestor: [
    { id: 'sg-1', supervisor_id: 'user-sup1', gestor_id: 'g-A', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sg-2', supervisor_id: 'user-sup1', gestor_id: 'g-B', activo: true, fecha_inicio: AYER, fecha_fin: null },
    // sup2: Supervisor NO relacionado con sup1/lider1 (aislamiento).
    { id: 'sg-3', supervisor_id: 'user-sup2', gestor_id: 'g-C', activo: true, fecha_inicio: AYER, fecha_fin: null }
  ],
  supervisor_gerente_zona: [
    { id: 'sgz-1', supervisor_id: 'user-sup1', gerente_zona_id: 'user-gerente1', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sgz-2', supervisor_id: 'user-sup2', gerente_zona_id: 'user-gerente2', activo: true, fecha_inicio: AYER, fecha_fin: null }
  ],
  liderazgo_supervisor: [
    { id: 'ls-1', liderazgo_id: 'user-lider1', supervisor_id: 'user-sup1', activo: true, fecha_inicio: AYER, fecha_fin: null }
    // user-sup2 NO está asignado a ningún Liderazgo (aislamiento).
  ]
};

/* ===== Cliente Supabase falso: soporta eq/in/lte/gte/or/limit/select (lo que usa ScopeService) ===== */
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
  constructor(table) { this.table = table; this.filters = []; this.limitN = null; }
  select() { return this; }
  order() { return this; }
  eq(col, val) { this.filters.push((row) => String(row[col]) === String(val)); return this; }
  in(col, vals) { this.filters.push((row) => (vals || []).map(String).includes(String(row[col]))); return this; }
  lte(col, val) { this.filters.push((row) => row[col] !== null && row[col] !== undefined && String(row[col]) <= String(val)); return this; }
  gte(col, val) { this.filters.push((row) => row[col] !== null && row[col] !== undefined && String(row[col]) >= String(val)); return this; }
  or(expr) { const preds = parseOrClause(expr); this.filters.push((row) => preds.some((p) => p(row))); return this; }
  limit(n) { this.limitN = n; return this; }
  _rows() {
    let rows = (db[this.table] || []).filter((row) => this.filters.every((f) => f(row)));
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    return rows.map((r) => ({ ...r }));
  }
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
const { applyScope } = require(path.join(distDir, 'services', 'ScopeFilter.js'));

/* ===== Cartera ficticia. IMPORTANTE: la fila de GUATEMALA/107 usa un nombre
 * de gestor que NO coincide con "GESTOR FANTASMA SIN CARTERA" (gestorB) — su
 * única forma de ver esta fila es por País-Zona, nunca por nombre. ===== */
const CARTERA = [
  { codigo: 'CTA-A', gestor: 'GESTOR REAL EN CARTERA', pais: 'GUATEMALA', zona: '108' },
  { codigo: 'CTA-B-PZ', gestor: 'NOMBRE COMPLETAMENTE DISTINTO EN CARTERA', pais: 'GUATEMALA', zona: '107' },
  { codigo: 'CTA-GERENTE1', gestor: 'OTRO NOMBRE CUALQUIERA', pais: 'REPUBLICA DOMINICANA', zona: '107' },
  { codigo: 'CTA-OTRO-SUP', gestor: 'GESTOR DE OTRO SUPERVISOR', pais: 'HONDURAS', zona: '201' },
  { codigo: 'CTA-OTRO-SUP-PZ', gestor: 'CUALQUIERA', pais: 'HONDURAS', zona: '201' },
  { codigo: 'CTA-SIN-RELACION', gestor: 'NADIE RELACIONADO', pais: 'PANAMA', zona: '607' }
];

const applyOpts = { gestorField: 'gestor', zonaField: 'zona', paisField: 'pais' };
const codigos = (rows) => rows.map((r) => r.codigo).sort();

test('ADMINISTRADOR: isGlobal=true, ve toda la cartera sin restricción', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-admin', roleClave: 'administrador', permissions: [] });
  assert.equal(ctx.isGlobal, true);
  const rows = applyScope(CARTERA, ctx, applyOpts);
  assert.deepEqual(codigos(rows), codigos(CARTERA));
});

test('GESTOR con nombre en cartera.gestor: ve su cartera por nombre', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-gestorA', roleClave: 'gestor', permissions: [] });
  assert.equal(ctx.isGlobal, false);
  const rows = applyScope(CARTERA, ctx, applyOpts);
  assert.deepEqual(codigos(rows), ['CTA-A']);
});

test('PRUEBA CRÍTICA (Sección 24) — GESTOR sin coincidencia en cartera.gestor: ve su cartera SOLO por País-Zona (gestor_pais_zona), nunca por nombre', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-gestorB', roleClave: 'gestor', permissions: [] });
  assert.equal(ctx.isGlobal, false);
  // Su nombre "GESTOR FANTASMA SIN CARTERA" no existe en NINGUNA fila real de cartera.
  assert.ok(!CARTERA.some((r) => r.gestor === 'GESTOR FANTASMA SIN CARTERA'));
  // Su alcance real proviene de gestor_pais_zona (GUATEMALA/107), como concesión OR independiente.
  assert.deepEqual(ctx.scope.paisZonaGrant, [{ pais: 'GUATEMALA', zona: '107' }]);
  const rows = applyScope(CARTERA, ctx, applyOpts);
  assert.deepEqual(codigos(rows), ['CTA-B-PZ']);
});

test('GERENTE DE ZONA: ve exclusivamente su País-Zona asignado (gerente_zona_zona)', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-gerente1', roleClave: 'gerente_zona', permissions: [] });
  const rows = applyScope(CARTERA, ctx, applyOpts);
  assert.deepEqual(codigos(rows), ['CTA-GERENTE1']);
});

test('SUPERVISOR: ve la UNIÓN de sus Gestores (por nombre y por País-Zona) y sus Gerentes de zona — nunca lo de otro Supervisor', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-sup1', roleClave: 'supervisor', permissions: [] });
  assert.equal(ctx.isGlobal, false);
  assert.deepEqual([...ctx.gestorIds].sort(), ['g-A', 'g-B']);
  const rows = applyScope(CARTERA, ctx, applyOpts);
  // CTA-A (gestorA por nombre) + CTA-B-PZ (gestorB por País-Zona) + CTA-GERENTE1 (su gerente de zona).
  assert.deepEqual(codigos(rows), ['CTA-A', 'CTA-B-PZ', 'CTA-GERENTE1']);
  // Aislamiento: nunca ve lo del Supervisor NO relacionado (sup2 -> gestorC/gerente2).
  assert.ok(!codigos(rows).includes('CTA-OTRO-SUP'));
  assert.ok(!codigos(rows).includes('CTA-OTRO-SUP-PZ'));
});

test('SUPERVISOR no relacionado (sup2): ve SOLO lo suyo, aislado de sup1', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-sup2', roleClave: 'supervisor', permissions: [] });
  const rows = applyScope(CARTERA, ctx, applyOpts);
  assert.deepEqual(codigos(rows), ['CTA-OTRO-SUP', 'CTA-OTRO-SUP-PZ']);
});

test('LIDERAZGO: ve el alcance TRANSITIVO de sus Supervisores asignados (Gestores + Gerentes + País-Zona), nunca el de un Supervisor no asignado', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-lider1', roleClave: 'liderazgo', permissions: [] });
  assert.equal(ctx.isGlobal, false);
  const rows = applyScope(CARTERA, ctx, applyOpts);
  // Mismo alcance que sup1 (su único Supervisor asignado), nunca el de sup2.
  assert.deepEqual(codigos(rows), ['CTA-A', 'CTA-B-PZ', 'CTA-GERENTE1']);
  assert.ok(!codigos(rows).includes('CTA-OTRO-SUP'));
});

test('LIDERAZGO sin Supervisores asignados: scope vacío (fail-closed, nunca global)', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-lider-sin-supervisores', roleClave: 'liderazgo', permissions: [] });
  assert.equal(ctx.isGlobal, false);
  const rows = applyScope(CARTERA, ctx, applyOpts);
  assert.deepEqual(rows, []);
});

test('Seguridad: applyScope nunca depende de datos enviados por el cliente — un ScopeContext ajeno jamás produce filas de otro alcance', async () => {
  // Simula "un usuario intenta obtener datos de otro" reutilizando su propio
  // ScopeContext (el único origen válido, resuelto en el backend) contra TODA
  // la cartera: el resultado nunca puede exceder su propio alcance real.
  const ctxGestorB = await resolveScopeContext({ userId: 'user-gestorB', roleClave: 'gestor', permissions: [] });
  const rows = applyScope(CARTERA, ctxGestorB, applyOpts);
  assert.ok(rows.every((r) => codigos([r])[0] === 'CTA-B-PZ'));
});
