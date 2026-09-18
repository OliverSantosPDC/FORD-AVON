'use strict';

/**
 * Investigación puntual: "Jasmin Ramirez tiene 9 zonas asignadas; el filtro
 * ZONA las muestra las 9, pero el filtro GERENTE solo muestra 4 opciones."
 *
 * HALLAZGO REAL (verificado contra Supabase, project vuazzailuqgbjnnbdtrg):
 * Jasmin Ramirez (usuario_id e87d8161-2df1-4103-b11e-78f12d4fc836) tiene
 * `roles.clave = 'gestor'` (nivel 4), NO 'gerente_zona'. Su fila en
 * `gestores` (id 0ac4a669-de0e-48ff-be9d-9d5415f75edf) está vinculada y
 * activa (una de las 18 filas "reales" tras la corrección de huérfanos del
 * commit fa0a0d2). Sus 9 relaciones están en `gestor_pais_zona` (NO en
 * `gerente_zona_zona`, donde tiene 0 filas), todas en REPUBLICA DOMINICANA,
 * vigentes (fecha_inicio 2026-09-12, fecha_fin null), y las 9 zonas tienen
 * cuentas reales en cartera (1,535 en total) — 0 de ellas coinciden con
 * `cartera.gestor` por nombre (igual que el caso Angie Buch/Bryan Rodriguez
 * ya cubierto: su alcance depende 100% de gestor_pais_zona).
 *
 * Por diseño de la arquitectura (Gestor vs. Gerente de zona son catálogos
 * DISTINTOS, cada uno con su propia tabla de relación), Jasmin JAMÁS puede
 * aparecer en el filtro Gerente — pertenece al filtro Gestor. No se
 * encontró ningún defecto de código (sin DISTINCT/GROUP BY/LIMIT/JOIN que
 * pierda relaciones en `gerentesZonaEnAlcance`/`paisZonaPorGerenteId`; el
 * conteo "4" observado corresponde al alcance de un Supervisor/Liderazgo
 * específico — 137 perfiles gerente_zona activos existen en el sistema, 104
 * con relación vigente, ninguno relacionado con Jasmin).
 *
 * Esta prueba documenta y protege el comportamiento correcto para AMBOS
 * catálogos con personas de MÚLTIPLES zonas (replicando exactamente la
 * forma real de los datos de Jasmin: 9 relaciones, 1 solo país, 0 matches de
 * nombre en cartera.gestor) para que una futura regresión de "una persona
 * con N relaciones se convierte en menos de N zonas / más de 1 persona" se
 * detecte de inmediato.
 *
 * Ejecutar (tras `npm run build`): node --test test/gestor-gerente-multi-zona.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const HOY = '2026-09-18';
const AYER = '2026-09-12';
const ZONAS_JASMIN = ['107', '116', '117', '123', '127', '129', '134', '138', '139'];

const db = {
  acceso_global_temporal: [],
  roles: [{ id: 'role-gerente-zona', clave: 'gerente_zona' }],
  zonas: ZONAS_JASMIN.map((z) => ({ id: `zona-${z}`, nombre: z, activo: true })).concat([
    { id: 'zona-201', nombre: '201', activo: true }
  ]),
  gestores: [
    // Jasmin: EXACTAMENTE la forma real (vinculada, activa, 0 match de nombre en cartera).
    { id: 'gestor-jasmin', usuario_id: 'user-jasmin', nombre_cartera: 'Jasmin Ramirez', activo: true }
  ],
  gestor_pais_zona: ZONAS_JASMIN.map((z, i) => ({
    id: `gpz-jasmin-${i}`, gestor_id: 'gestor-jasmin', zona_id: `zona-${z}`, pais: 'REPUBLICA DOMINICANA', activo: true, fecha_inicio: AYER, fecha_fin: null
  })),
  // Gerente de zona multi-zona (2 relaciones, como el caso real más alto, Patricia Zavaleta) +
  // un SEGUNDO gerente que comparte UNA de esas mismas zonas (Sección 15: zonas compartidas).
  profiles: [
    { id: 'user-gerente-a', activo: true, nombre: 'Gerente', apellido: 'Multizona', role_id: 'role-gerente-zona' },
    { id: 'user-gerente-b', activo: true, nombre: 'Gerente', apellido: 'ZonaCompartida', role_id: 'role-gerente-zona' }
  ],
  gerente_zona_zona: [
    { id: 'gzz-a-1', usuario_id: 'user-gerente-a', zona_id: 'zona-201', pais: 'HONDURAS', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'gzz-a-2', usuario_id: 'user-gerente-a', zona_id: 'zona-107', pais: 'REPUBLICA DOMINICANA', activo: true, fecha_inicio: AYER, fecha_fin: null },
    // gerente-b también autorizado sobre zona-201/HONDURAS: AMBOS deben conservar su relación.
    { id: 'gzz-b-1', usuario_id: 'user-gerente-b', zona_id: 'zona-201', pais: 'HONDURAS', activo: true, fecha_inicio: AYER, fecha_fin: null }
  ],
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

/* Cartera ficticia con cuentas reales en las 9 zonas de Jasmin (nombre de
 * cartera.gestor DELIBERADAMENTE distinto: su alcance depende 100% de
 * gestor_pais_zona, igual que en producción) + cuentas en Honduras/201
 * (zona compartida entre los dos Gerentes) con un gerente_zona de texto que
 * tampoco coincide con ninguno de los dos, para probar que ambos la
 * alcanzan igual por su propia relación. */
const CARTERA = [
  ...ZONAS_JASMIN.map((z, i) => ({ codigo: `CTA-RD-${z}`, gestor: 'NOMBRE HISTORICO SIN RELACION', pais: 'REPUBLICA DOMINICANA', zona: z })),
  { codigo: 'CTA-HN-1', gerente_zona: 'NOMBRE HISTORICO GERENTE', pais: 'HONDURAS', zona: '201' },
  { codigo: 'CTA-HN-2', gerente_zona: 'NOMBRE HISTORICO GERENTE', pais: 'HONDURAS', zona: '201' }
];
const EMPTY_FILTERS = { pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] };

test('gestoresEnAlcance (ADMINISTRADOR): Jasmin (9 relaciones gestor_pais_zona) aparece UNA SOLA VEZ con SUS 9 zonas, nunca como 9 personas ni con menos de 9 zonas', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-admin', roleClave: 'administrador', permissions: [] });
  const gestores = await gestoresEnAlcance(ctx);
  const ocurrencias = gestores.filter((g) => g.nombre === 'Jasmin Ramirez');
  assert.equal(ocurrencias.length, 1, 'Jasmin debe aparecer EXACTAMENTE una vez (una persona, no una fila por relación)');
  const zonasJasmin = ocurrencias[0].paisZona.map((pz) => pz.zona).sort();
  assert.deepEqual(zonasJasmin, [...ZONAS_JASMIN].sort(), 'Debe conservar las 9 zonas asignadas, ninguna perdida');
  assert.ok(ocurrencias[0].paisZona.every((pz) => pz.pais === 'REPUBLICA DOMINICANA'));
});

test('filterOptions.gestor: Jasmin aparece como opción del filtro Gestor (nunca del filtro Gerente, porque su rol es gestor)', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-admin', roleClave: 'administrador', permissions: [] });
  const personas = { gestores: await gestoresEnAlcance(ctx), gerentes: await gerentesZonaEnAlcance(ctx) };
  const opts = buildFilterOptions(CARTERA, EMPTY_FILTERS, personas);
  assert.ok(opts.gestor.includes('Jasmin Ramirez'), 'Debe aparecer en el catálogo de Gestor pese a 0 coincidencias de nombre en cartera.gestor');
  assert.ok(!opts.gerente.includes('Jasmin Ramirez'), 'NUNCA debe aparecer en el catálogo de Gerente: su rol real es gestor, no gerente_zona');
});

test('Seleccionar a Jasmin filtra la cartera a EXACTAMENTE sus 9 zonas (1,535 cuentas reales en producción; aquí 1 cuenta ficticia por zona = 9)', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-admin', roleClave: 'administrador', permissions: [] });
  const personas = { gestores: await gestoresEnAlcance(ctx), gerentes: await gerentesZonaEnAlcance(ctx) };
  const filtrado = filterCarteraRows(CARTERA, { ...EMPTY_FILTERS, gestor: ['Jasmin Ramirez'] }, personas);
  assert.equal(filtrado.length, ZONAS_JASMIN.length);
  assert.deepEqual(filtrado.map((r) => r.zona).sort(), [...ZONAS_JASMIN].sort());
  assert.ok(!filtrado.some((r) => r.pais === 'HONDURAS'), 'Nunca debe ampliarse a zonas fuera de sus 9 relaciones');
});

test('gerentesZonaEnAlcance (ADMINISTRADOR): un Gerente con 2 zonas aparece UNA vez con AMBAS; la zona compartida con otro Gerente NO se pierde para ninguno de los dos', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-admin', roleClave: 'administrador', permissions: [] });
  const gerentes = await gerentesZonaEnAlcance(ctx);

  const a = gerentes.filter((g) => g.nombre === 'Gerente Multizona');
  assert.equal(a.length, 1);
  assert.deepEqual(a[0].paisZona.map((pz) => pz.zona).sort(), ['107', '201']);

  const b = gerentes.filter((g) => g.nombre === 'Gerente ZonaCompartida');
  assert.equal(b.length, 1);
  assert.deepEqual(b[0].paisZona.map((pz) => pz.zona), ['201']);
  // Zona compartida (Sección 15): ambos Gerentes conservan su propia relación sobre zona 201 — no es un DISTINCT sobre la zona.
});

test('Seleccionar cada Gerente de la zona compartida filtra la MISMA cartera (ninguno pierde acceso por el otro)', async () => {
  const ctx = await resolveScopeContext({ userId: 'user-admin', roleClave: 'administrador', permissions: [] });
  const personas = { gestores: await gestoresEnAlcance(ctx), gerentes: await gerentesZonaEnAlcance(ctx) };
  const filaA = filterCarteraRows(CARTERA, { ...EMPTY_FILTERS, gerente: ['Gerente Multizona'] }, personas);
  const filaB = filterCarteraRows(CARTERA, { ...EMPTY_FILTERS, gerente: ['Gerente ZonaCompartida'] }, personas);
  // Gerente Multizona tiene DOS relaciones (Honduras/201 Y República Dominicana/107):
  // alcanza CTA-HN-1/2 (zona compartida) MÁS CTA-RD-107 (su otra zona, propia).
  assert.deepEqual(filaA.map((r) => r.codigo).sort(), ['CTA-HN-1', 'CTA-HN-2', 'CTA-RD-107']);
  // Gerente ZonaCompartida solo tiene la relación de Honduras/201: nunca alcanza CTA-RD-107.
  assert.deepEqual(filaB.map((r) => r.codigo).sort(), ['CTA-HN-1', 'CTA-HN-2']);
});
