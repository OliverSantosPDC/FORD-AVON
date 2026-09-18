'use strict';

/**
 * Continuación de la investigación "Jasmin Ramirez" con Angie Buch — MISMO
 * patrón (una persona del modelo nuevo con múltiples relaciones País-Zona),
 * pero con un matiz adicional que Jasmin no tenía: su fila HUÉRFANA de
 * `gestores` ("ANGIE DYANA BUCH DÍAZ", usuario_id = null) sí tiene miles de
 * coincidencias reales en `cartera.gestor` (2048), mientras que su fila
 * VIGENTE ("Angie Buch", usuario_id vinculado) tiene CERO. Prueba que la
 * cantidad de coincidencias de texto en cartera NUNCA resucita una identidad
 * huérfana ni sustituye su propio gestor_pais_zona.
 *
 * DATOS REALES (Supabase, project vuazzailuqgbjnnbdtrg), no ficticios en
 * este resumen — sí ficticios abajo en el fixture, replicando la MISMA
 * forma exacta:
 *  - usuario_id 1b1406dd-91cc-4807-a296-ec345d8efc37, rol 'gestor', nivel 4.
 *  - gestores.id 9ad362a0-2d1c-40a6-9a5d-d80a0a35814e ("Angie Buch"),
 *    vinculado, activo — 0 coincidencias en cartera.gestor.
 *  - gestores.id 219f16d7-5479-4f9c-a0c9-0c6218c0184d
 *    ("ANGIE DYANA BUCH DÍAZ"), usuario_id = null (huérfano), activo —
 *    2048 coincidencias en cartera.gestor.
 *  - 10 relaciones `gestor_pais_zona` vigentes, todas REPUBLICA DOMINICANA:
 *    zonas 110,118,120,124,126,133,140,143,146,154 — cubren 2047 de esas
 *    2048 cuentas históricas. La cuenta restante (zona 141) NO tiene
 *    relación configurada: es un hueco de DATOS (falta una 11ª relación),
 *    no un defecto de código — con las relaciones actuales, esa 1 cuenta
 *    queda correctamente fuera de su alcance.
 *  - Supervisor real: daniel.monge@grupopdc.com (supervisor_gestor).
 *
 * Ejecutar (tras `npm run build`): node --test test/angie-buch-multi-zona.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const AYER = '2026-09-12';
const ZONAS_ANGIE = ['110', '118', '120', '124', '126', '133', '140', '143', '146', '154'];

const db = {
  acceso_global_temporal: [],
  roles: [],
  zonas: [...ZONAS_ANGIE, '141'].map((z) => ({ id: `zona-${z}`, nombre: z, activo: true })),
  gestores: [
    { id: 'gestor-angie-actual', usuario_id: 'user-angie', nombre_cartera: 'Angie Buch', activo: true },
    // Fila huérfana con el nombre HISTÓRICO/OPERATIVO real (2048 matches en cartera.gestor
    // en producción) — usuario_id = null: por la corrección del commit fa0a0d2, JAMÁS
    // debe contarse como persona, sin importar cuántas filas de cartera coincidan por texto.
    { id: 'gestor-angie-huerfano', usuario_id: null, nombre_cartera: 'ANGIE DYANA BUCH DÍAZ', activo: true }
  ],
  gestor_pais_zona: ZONAS_ANGIE.map((z, i) => ({
    id: `gpz-angie-${i}`, gestor_id: 'gestor-angie-actual', zona_id: `zona-${z}`, pais: 'REPUBLICA DOMINICANA', activo: true, fecha_inicio: AYER, fecha_fin: null
  })),
  gerente_zona_zona: [],
  profiles: [{ id: 'user-angie', activo: true }],
  supervisor_gestor: [],
  supervisor_gerente_zona: [],
  liderazgo_supervisor: []
};

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
const { resolveScopeContext, gestoresEnAlcance, gerentesZonaEnAlcance } = require(path.join(distDir, 'services', 'ScopeService.js'));
const { buildFilterOptions, filterCarteraRows } = require(path.join(distDir, 'utils', 'carteraAggregations.js'));

/* Cartera ficticia: 10 cuentas con el nombre HUÉRFANO (como en producción,
 * 2048 filas reales dicen "ANGIE DYANA BUCH DÍAZ", ninguna dice "Angie
 * Buch") EN sus 10 zonas configuradas, MÁS 1 cuenta en zona 141 (fuera de
 * sus relaciones actuales — el hueco de datos real) y 1 cuenta de otro
 * gestor en Honduras (fuera de alcance total). */
const CARTERA = [
  ...ZONAS_ANGIE.map((z) => ({ codigo: `CTA-RD-${z}`, gestor: 'ANGIE DYANA BUCH DÍAZ', pais: 'REPUBLICA DOMINICANA', zona: z })),
  { codigo: 'CTA-RD-141', gestor: 'ANGIE DYANA BUCH DÍAZ', pais: 'REPUBLICA DOMINICANA', zona: '141' },
  { codigo: 'CTA-OTRO', gestor: 'OTRO GESTOR CUALQUIERA', pais: 'HONDURAS', zona: '201' }
];
const EMPTY_FILTERS = { pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] };

test('gestoresEnAlcance (ADMINISTRADOR): Angie aparece UNA vez como "Angie Buch" (su identidad vigente), con sus 10 zonas; el nombre huérfano NUNCA aparece pese a tener miles de coincidencias en cartera', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-admin', roleClave: 'administrador', permissions: [] });
  const gestores = await gestoresEnAlcance(ctx);
  const angie = gestores.filter((g) => g.nombre === 'Angie Buch');
  assert.equal(angie.length, 1);
  assert.deepEqual(angie[0].paisZona.map((pz) => pz.zona).sort(), [...ZONAS_ANGIE].sort());
  assert.ok(!gestores.some((g) => g.nombre === 'ANGIE DYANA BUCH DÍAZ'), 'La fila huérfana no es una persona, sin importar cuántas cuentas de cartera lleven ese texto');
});

test('filterOptions.gestor: "Angie Buch" es la opción (nunca "ANGIE DYANA BUCH DÍAZ", pese a que esta última tiene 2048 filas de cartera y "Angie Buch" tiene 0)', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-admin', roleClave: 'administrador', permissions: [] });
  const personas = { gestores: await gestoresEnAlcance(ctx), gerentes: await gerentesZonaEnAlcance(ctx) };
  const opts = buildFilterOptions(CARTERA, EMPTY_FILTERS, personas);
  assert.ok(opts.gestor.includes('Angie Buch'));
  assert.ok(!opts.gestor.includes('ANGIE DYANA BUCH DÍAZ'));
});

test('Seleccionar "Angie Buch" filtra por SU gestor_pais_zona (10 zonas), NUNCA por el texto "ANGIE DYANA BUCH DÍAZ" que llevan las filas de cartera', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-admin', roleClave: 'administrador', permissions: [] });
  const personas = { gestores: await gestoresEnAlcance(ctx), gerentes: await gerentesZonaEnAlcance(ctx) };
  const filtrado = filterCarteraRows(CARTERA, { ...EMPTY_FILTERS, gestor: ['Angie Buch'] }, personas);
  assert.equal(filtrado.length, ZONAS_ANGIE.length, 'Debe incluir sus 10 zonas configuradas');
  assert.deepEqual(filtrado.map((r) => r.zona).sort(), [...ZONAS_ANGIE].sort());
  // La cuenta de zona 141 (mismo texto "ANGIE DYANA BUCH DÍAZ" pero SIN relación
  // gestor_pais_zona configurada) queda correctamente FUERA: es un hueco de datos
  // real en producción (falta la 11ª relación), no un defecto — el texto de cartera
  // nunca amplía el alcance por sí solo.
  assert.ok(!filtrado.some((r) => r.codigo === 'CTA-RD-141'));
  assert.ok(!filtrado.some((r) => r.codigo === 'CTA-OTRO'));
});
