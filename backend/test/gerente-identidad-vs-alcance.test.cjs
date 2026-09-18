'use strict';

/**
 * Suite de regresión — separación IDENTIDAD vs. ALCANCE GEOGRÁFICO para
 * Gerente de zona (y, en paralelo, Gestor), tras la corrección definitiva de
 * "Sin opciones" (ver `gerente-no-nombre-cartera.test.cjs` para el detalle
 * del caso raíz).
 *
 * Replica el caso real de producción (Supabase, project vuazzailuqgbjnnbdtrg):
 * el supervisor daniel.monge@grupopdc.com tiene 5 Gerentes de zona reales
 * (Cristina Garcia, Ircania Guerrero, Julissa Rodriguez, Leydi Perez,
 * Stephanie German) asignados vía `supervisor_gerente_zona` (activo=true),
 * los 5 con `roles.clave = 'gerente_zona'`, `nivel = 5`, `activo = true`,
 * pero CERO filas en `gerente_zona_zona`.
 *
 * IDENTIDAD = usuario + rol + relación jerárquica (`supervisor_gerente_zona`
 * / `liderazgo_supervisor`) — resuelta por `ScopeService.resolveScopeContext`
 * + `gerentesZonaEnAlcance`, ejercitada aquí de punta a punta (incluye el
 * cálculo real de `ctx.gerenteZonaIds`, NUNCA cartera).
 * ALCANCE GEOGRÁFICO = `gerente_zona_zona` — solo acota el catálogo cuando
 * el usuario tiene un filtro País/Zona explícitamente seleccionado
 * (`opcionesPersonas` en `carteraAggregations.ts`).
 * DATOS = cartera — nunca fuente de identidad ni de catálogo.
 *
 * Ejecutar (tras `npm run build`): node --test test/gerente-identidad-vs-alcance.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const AYER = '2026-09-12';

const db = {
  acceso_global_temporal: [],
  roles: [
    { id: 'role-gerente-zona', clave: 'gerente_zona' },
    { id: 'role-gestor', clave: 'gestor' }
  ],
  zonas: ['133', '140', '154', '126', '146', '999', '201'].map((z) => ({ id: `zona-${z}`, nombre: z, activo: true })),
  // 5 Gerentes reales del caso de producción: rol correcto, activos, 0 zonas.
  // + 1 Gerente CON 1 zona (escenario 1) + 1 Gerente CON múltiples zonas (escenario 2)
  // + 1 Gerente supervisado por OTRO supervisor, fuera del alcance de daniel.monge (escenario 5).
  profiles: [
    { id: 'user-cristina', activo: true, nombre: 'Cristina', apellido: 'Garcia', role_id: 'role-gerente-zona' },
    { id: 'user-ircania', activo: true, nombre: 'Ircania', apellido: 'Guerrero', role_id: 'role-gerente-zona' },
    { id: 'user-julissa', activo: true, nombre: 'Julissa', apellido: 'Rodriguez', role_id: 'role-gerente-zona' },
    { id: 'user-leydi', activo: true, nombre: 'Leydi', apellido: 'Perez', role_id: 'role-gerente-zona' },
    { id: 'user-stephanie', activo: true, nombre: 'Stephanie', apellido: 'German', role_id: 'role-gerente-zona' },
    { id: 'user-gerente-1zona', activo: true, nombre: 'Gerente', apellido: 'UnaZona', role_id: 'role-gerente-zona' },
    { id: 'user-gerente-multizona', activo: true, nombre: 'Gerente', apellido: 'Multizona', role_id: 'role-gerente-zona' },
    { id: 'user-gerente-fuera-alcance', activo: true, nombre: 'Gerente', apellido: 'FueraAlcance', role_id: 'role-gerente-zona' },
    { id: 'user-gestor-multizona', activo: true, nombre: 'Gestor', apellido: 'Multizona', role_id: 'role-gestor' },
    { id: 'user-gestor-sin-zona', activo: true, nombre: 'Gestor', apellido: 'SinZona', role_id: 'role-gestor' }
  ],
  gestores: [
    { id: 'gestor-multizona', usuario_id: 'user-gestor-multizona', nombre_cartera: 'Gestor Multizona', activo: true },
    // Gestor con 0 relaciones gestor_pais_zona (mismo caso que los 5 Gerentes, pero rama Gestor).
    { id: 'gestor-sin-zona', usuario_id: 'user-gestor-sin-zona', nombre_cartera: 'Gestor SinZona', activo: true }
  ],
  gestor_pais_zona: [
    { id: 'gpz-1', gestor_id: 'gestor-multizona', zona_id: 'zona-133', pais: 'REPUBLICA DOMINICANA', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'gpz-2', gestor_id: 'gestor-multizona', zona_id: 'zona-140', pais: 'REPUBLICA DOMINICANA', activo: true, fecha_inicio: AYER, fecha_fin: null }
  ],
  gerente_zona_zona: [
    { id: 'gzz-1zona', usuario_id: 'user-gerente-1zona', zona_id: 'zona-154', pais: 'REPUBLICA DOMINICANA', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'gzz-multi-1', usuario_id: 'user-gerente-multizona', zona_id: 'zona-126', pais: 'REPUBLICA DOMINICANA', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'gzz-multi-2', usuario_id: 'user-gerente-multizona', zona_id: 'zona-146', pais: 'REPUBLICA DOMINICANA', activo: true, fecha_inicio: AYER, fecha_fin: null },
    // Fuera de alcance tiene SU PROPIA zona real — pero al no estar supervisado por daniel.monge, no debe aparecer para él.
    { id: 'gzz-fuera', usuario_id: 'user-gerente-fuera-alcance', zona_id: 'zona-201', pais: 'HONDURAS', activo: true, fecha_inicio: AYER, fecha_fin: null }
  ],
  supervisor_gestor: [
    { id: 'sg-1', supervisor_id: 'user-daniel', gestor_id: 'gestor-multizona', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sg-2', supervisor_id: 'user-daniel', gestor_id: 'gestor-sin-zona', activo: true, fecha_inicio: AYER, fecha_fin: null }
  ],
  // Los 5 Gerentes reales del caso de producción, MÁS el de 1 zona y el multizona,
  // todos supervisados por daniel.monge. "Fuera de alcance" NO está aquí (otro supervisor).
  supervisor_gerente_zona: [
    { id: 'sgz-cristina', supervisor_id: 'user-daniel', gerente_zona_id: 'user-cristina', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sgz-ircania', supervisor_id: 'user-daniel', gerente_zona_id: 'user-ircania', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sgz-julissa', supervisor_id: 'user-daniel', gerente_zona_id: 'user-julissa', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sgz-leydi', supervisor_id: 'user-daniel', gerente_zona_id: 'user-leydi', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sgz-stephanie', supervisor_id: 'user-daniel', gerente_zona_id: 'user-stephanie', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sgz-1zona', supervisor_id: 'user-daniel', gerente_zona_id: 'user-gerente-1zona', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sgz-multizona', supervisor_id: 'user-daniel', gerente_zona_id: 'user-gerente-multizona', activo: true, fecha_inicio: AYER, fecha_fin: null },
    // "Fuera de alcance" supervisado por OTRO supervisor, no por daniel.monge.
    { id: 'sgz-fuera', supervisor_id: 'user-otro-supervisor', gerente_zona_id: 'user-gerente-fuera-alcance', activo: true, fecha_inicio: AYER, fecha_fin: null }
  ],
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

const EMPTY_FILTERS = { pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] };

/* Cartera ficticia: cuentas reales en las zonas de los Gerentes CON relación
 * (154, 126, 146) más cuentas cuyo `gerente_zona` de texto coincide con los
 * nombres de los 5 sin relación (NUNCA debe usarse esa coincidencia). */
const CARTERA = [
  { codigo: 'CTA-154', gestor: 'OTRO GESTOR', gerente_zona: 'Gerente UnaZona', pais: 'REPUBLICA DOMINICANA', zona: '154' },
  { codigo: 'CTA-126', gestor: 'OTRO GESTOR', gerente_zona: 'Gerente Multizona', pais: 'REPUBLICA DOMINICANA', zona: '126' },
  { codigo: 'CTA-146', gestor: 'OTRO GESTOR', gerente_zona: 'Gerente Multizona', pais: 'REPUBLICA DOMINICANA', zona: '146' },
  { codigo: 'CTA-CRISTINA-TXT', gestor: 'OTRO GESTOR', gerente_zona: 'Cristina Garcia', pais: 'REPUBLICA DOMINICANA', zona: '999' },
  { codigo: 'CTA-133', gestor: 'Gestor Multizona', pais: 'REPUBLICA DOMINICANA', zona: '133' },
  { codigo: 'CTA-140', gestor: 'Gestor Multizona', pais: 'REPUBLICA DOMINICANA', zona: '140' }
];

const obtenerCtxDaniel = () => resolveScopeContext({ userId: 'user-daniel', roleClave: 'supervisor', permissions: [] });
const obtenerPersonasDaniel = async () => {
  const ctx = await obtenerCtxDaniel();
  return { gestores: await gestoresEnAlcance(ctx), gerentes: await gerentesZonaEnAlcance(ctx) };
};

// 1. Gerente con 1 zona: aparece en el catálogo y filtra correctamente su única zona.
test('1) Gerente con 1 zona: aparece en catálogo y selecciona filtra exactamente su zona', async () => {
  const personas = await obtenerPersonasDaniel();
  const opts = buildFilterOptions(CARTERA, EMPTY_FILTERS, personas);
  assert.ok(opts.gerente.includes('Gerente UnaZona'));
  const filtrado = filterCarteraRows(CARTERA, { ...EMPTY_FILTERS, gerente: ['Gerente UnaZona'] }, personas);
  assert.deepEqual(filtrado.map((r) => r.codigo), ['CTA-154']);
});

// 2. Gerente con múltiples zonas: aparece una vez, filtra ambas zonas.
test('2) Gerente con múltiples zonas: aparece una vez, selecciona filtra AMBAS zonas', async () => {
  const personas = await obtenerPersonasDaniel();
  const opts = buildFilterOptions(CARTERA, EMPTY_FILTERS, personas);
  assert.equal(opts.gerente.filter((n) => n === 'Gerente Multizona').length, 1);
  const filtrado = filterCarteraRows(CARTERA, { ...EMPTY_FILTERS, gerente: ['Gerente Multizona'] }, personas);
  assert.deepEqual(filtrado.map((r) => r.codigo).sort(), ['CTA-126', 'CTA-146']);
});

// 3. Gerente con 0 zonas: aparece en el catálogo (sin filtro geográfico activo).
test('3) Gerente con 0 zonas (Cristina Garcia): aparece en el catálogo sin filtro geográfico activo', async () => {
  const personas = await obtenerPersonasDaniel();
  const opts = buildFilterOptions(CARTERA, EMPTY_FILTERS, personas);
  assert.ok(opts.gerente.includes('Cristina Garcia'));
});

// 4. Gerente con relación jerárquica (supervisor_gerente_zona) pero 0 zonas: identidad viene de la jerarquía, no de la geografía.
test('4) Los 5 Gerentes con relación jerárquica pero 0 zonas: TODOS aparecen (identidad = jerarquía, no geografía)', async () => {
  const personas = await obtenerPersonasDaniel();
  const opts = buildFilterOptions(CARTERA, EMPTY_FILTERS, personas);
  for (const nombre of ['Cristina Garcia', 'Ircania Guerrero', 'Julissa Rodriguez', 'Leydi Perez', 'Stephanie German']) {
    assert.ok(opts.gerente.includes(nombre), `${nombre} debe aparecer`);
  }
});

// 5. Gerente fuera del alcance del usuario actual (supervisado por otro supervisor): NO aparece.
test('5) Gerente fuera de alcance (supervisado por OTRO supervisor): NO aparece para daniel.monge', async () => {
  const personas = await obtenerPersonasDaniel();
  assert.ok(!personas.gerentes.some((g) => g.nombre === 'Gerente FueraAlcance'));
  const opts = buildFilterOptions(CARTERA, EMPTY_FILTERS, personas);
  assert.ok(!opts.gerente.includes('Gerente FueraAlcance'));
});

// 6. Gestor con múltiples zonas: aparece, filtra correctamente (comportamiento ya correcto, sin cambios).
test('6) Gestor con múltiples zonas: aparece y filtra sus 2 zonas', async () => {
  const personas = await obtenerPersonasDaniel();
  const opts = buildFilterOptions(CARTERA, EMPTY_FILTERS, personas);
  assert.ok(opts.gestor.includes('Gestor Multizona'));
  const filtrado = filterCarteraRows(CARTERA, { ...EMPTY_FILTERS, gestor: ['Gestor Multizona'] }, personas);
  assert.deepEqual(filtrado.map((r) => r.codigo).sort(), ['CTA-133', 'CTA-140']);
});

// 7. Persona en cartera sin usuario real (solo texto en gerente_zona): nunca aparece como opción.
test('7) Nombre presente solo como texto en cartera.gerente_zona, sin usuario real detrás: nunca aparece como opción de Gerente', async () => {
  const personas = await obtenerPersonasDaniel();
  const carteraConTexto = [...CARTERA, { codigo: 'CTA-FANTASMA', gerente_zona: 'Persona Fantasma Sin Usuario', pais: 'REPUBLICA DOMINICANA', zona: '133' }];
  const opts = buildFilterOptions(carteraConTexto, EMPTY_FILTERS, personas);
  assert.ok(!opts.gerente.includes('Persona Fantasma Sin Usuario'));
});

// 8. Usuario Gerente en cartera (coincidencia de texto) sin relación geográfica: aparece en catálogo, pero selecciona da 0 filas.
test('8) Cristina Garcia (0 zonas) coincide por texto con CTA-CRISTINA-TXT: aparece en catálogo, pero seleccionarla da 0 filas (nunca por texto)', async () => {
  const personas = await obtenerPersonasDaniel();
  const opts = buildFilterOptions(CARTERA, EMPTY_FILTERS, personas);
  assert.ok(opts.gerente.includes('Cristina Garcia'));
  const filtrado = filterCarteraRows(CARTERA, { ...EMPTY_FILTERS, gerente: ['Cristina Garcia'] }, personas);
  assert.deepEqual(filtrado, []);
});

// 9. Rol incorrecto: Gestor nunca aparece como opción de Gerente y viceversa.
test('9) Rol incorrecto: Gestor Multizona nunca aparece en opts.gerente; Gerente Multizona nunca aparece en opts.gestor', async () => {
  const personas = await obtenerPersonasDaniel();
  const opts = buildFilterOptions(CARTERA, EMPTY_FILTERS, personas);
  assert.ok(!opts.gerente.includes('Gestor Multizona'));
  assert.ok(!opts.gestor.includes('Gerente Multizona'));
});

// 10. Seleccionar Gerente sin zonas: 0 resultados de cartera siempre.
test('10) Seleccionar cualquiera de los 5 Gerentes sin zonas: 0 resultados de cartera', async () => {
  const personas = await obtenerPersonasDaniel();
  for (const nombre of ['Cristina Garcia', 'Ircania Guerrero', 'Julissa Rodriguez', 'Leydi Perez', 'Stephanie German']) {
    const filtrado = filterCarteraRows(CARTERA, { ...EMPTY_FILTERS, gerente: [nombre] }, personas);
    assert.deepEqual(filtrado, [], `${nombre} debe devolver 0 filas`);
  }
});

// 11. Seleccionar Gerente con zonas: resultados correctos.
test('11) Seleccionar Gerente UnaZona: resultado correcto (1 cuenta, su única zona)', async () => {
  const personas = await obtenerPersonasDaniel();
  const filtrado = filterCarteraRows(CARTERA, { ...EMPTY_FILTERS, gerente: ['Gerente UnaZona'] }, personas);
  assert.deepEqual(filtrado.map((r) => r.codigo), ['CTA-154']);
});

// 12. Gerente + filtro Zona válida (coincide con su relación): aparece y filtra correctamente.
test('12) Gerente UnaZona + filtro Zona=154 (coincide): aparece en catálogo y filtra correctamente', async () => {
  const personas = await obtenerPersonasDaniel();
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, zona: ['154'] }, personas);
  assert.ok(opts.gerente.includes('Gerente UnaZona'));
  const filtrado = filterCarteraRows(CARTERA, { ...EMPTY_FILTERS, gerente: ['Gerente UnaZona'], zona: ['154'] }, personas);
  assert.deepEqual(filtrado.map((r) => r.codigo), ['CTA-154']);
});

// 13. Gerente + filtro Zona fuera de su alcance: excluido del catálogo de opciones.
test('13) Gerente UnaZona + filtro Zona=126 (fuera de su alcance): excluido del catálogo de opciones', async () => {
  const personas = await obtenerPersonasDaniel();
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, zona: ['126'] }, personas);
  assert.ok(!opts.gerente.includes('Gerente UnaZona'), 'Gerente UnaZona no tiene relación sobre zona 126: no debe aparecer con ese filtro activo');
  assert.ok(opts.gerente.includes('Gerente Multizona'), 'Gerente Multizona sí tiene relación sobre zona 126: debe aparecer');
});

// 14. Intersección Gestor+Gerente: ambos filtros activos simultáneamente aplican AND correcto.
test('14) Gestor Multizona + Gerente Multizona simultáneos: AND correcto (cada uno filtra su propia dimensión, intersección vacía en este fixture)', async () => {
  const personas = await obtenerPersonasDaniel();
  const filtrado = filterCarteraRows(CARTERA, { ...EMPTY_FILTERS, gestor: ['Gestor Multizona'], gerente: ['Gerente Multizona'] }, personas);
  // Gestor Multizona alcanza CTA-133/CTA-140; Gerente Multizona alcanza CTA-126/CTA-146.
  // Ninguna cuenta satisface AMBOS criterios simultáneamente en este fixture (AND, no OR).
  assert.deepEqual(filtrado, []);
});

/**
 * Sección 20 — tabla comparativa de los 5 Gerentes reales del caso de
 * producción: todos deben tener el MISMO resultado (aparecen en el filtro,
 * 0 resultados de cartera al seleccionarlos individualmente sin relación).
 */
test('Tabla comparativa: los 5 Gerentes reales (Cristina, Ircania, Julissa, Leydi, Stephanie) — mismo rol, mismo supervisor, 0 zonas — TODOS aparecen en el filtro y TODOS devuelven 0 cartera al seleccionarse', async () => {
  const personas = await obtenerPersonasDaniel();
  const opts = buildFilterOptions(CARTERA, EMPTY_FILTERS, personas);
  const tabla = ['Cristina Garcia', 'Ircania Guerrero', 'Julissa Rodriguez', 'Leydi Perez', 'Stephanie German'].map((nombre) => ({
    nombre,
    apareceFiltro: opts.gerente.includes(nombre),
    filasAlSeleccionar: filterCarteraRows(CARTERA, { ...EMPTY_FILTERS, gerente: [nombre] }, personas).length
  }));
  for (const fila of tabla) {
    assert.equal(fila.apareceFiltro, true, `${fila.nombre} debe aparecer en el filtro`);
    assert.equal(fila.filasAlSeleccionar, 0, `${fila.nombre} debe devolver 0 filas al seleccionarse (0 relaciones gerente_zona_zona)`);
  }
});
