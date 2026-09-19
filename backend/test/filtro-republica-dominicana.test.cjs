'use strict';

/**
 * AUDITORÍA REPÚBLICA DOMINICANA (RD) — "el filtro Gerente queda sin
 * opciones al seleccionar RD".
 *
 * Investigación con datos REALES de Supabase (project vuazzailuqgbjnnbdtrg):
 *
 *  - `gestor_pais_zona` SÍ tiene relaciones para RD: 19 filas, exactamente
 *    2 Gestores reales (Angie Buch, supervisada por Daniel Monge; Jasmin
 *    Ramirez, supervisada por Oliver Santos), ambos usuarios activos.
 *    → Gestor + RD SÍ debe devolver opciones (2).
 *
 *  - `gerente_zona_zona` tiene CERO filas con pais='REPUBLICA DOMINICANA'
 *    en TODO el sistema (0/105) — ningún Gerente de zona, de ningún
 *    Supervisor, tiene una relación geográfica configurada para RD.
 *    → Gerente + RD da 0 opciones, para CUALQUIER usuario, incluido
 *      Administrador. Esto NO es un defecto de código: es exactamente el
 *      comportamiento ya validado en esta sesión ("una persona con 0 zonas
 *      se excluye del catálogo cuando el filtro geográfico activo no
 *      coincide con ninguna de sus relaciones").
 *
 *  - Se investigó una hipótesis alterna: 11 filas de `gerente_zona_zona`
 *    con pais='GUATEMALA' usan códigos de zona (107,110,117,118,120,123,
 *    124,126,129,133,139) que son subconjunto exacto de los 19 códigos de
 *    zona de RD, y 9 de esos 11 Gerentes comparten Supervisor con Angie/
 *    Jasmin — un patrón sugerente de error de captura. DESCARTADA con
 *    datos reales: `cartera` tiene cuentas REALES en Guatemala Y en RD
 *    usando los MISMOS códigos numéricos de zona (ej. zona "107": 108
 *    cuentas reales en Guatemala + 379 en RD — poblaciones distintas). El
 *    catálogo de zonas reutiliza números entre países por diseño (ya
 *    documentado en ScopeService: "una misma zona/código puede repetirse
 *    entre países"); las 11 filas de Guatemala son asignaciones legítimas,
 *    no relacionadas con RD.
 *
 *  CAUSA RAÍZ FINAL: hueco de DATOS (falta configurar `gerente_zona_zona`
 *  para RD en Grupos y Niveles), no un defecto de código. No se modificó
 *  ningún archivo de producción ni ningún dato de Supabase.
 *
 * Esta prueba reproduce la estructura real exacta (2 Gestores RD activos,
 * 0 Gerentes con relación RD, más un Gerente de Guatemala con código de
 * zona coincidente para probar que NUNCA se filtra por número de zona sin
 * el país correcto) y protege contra una futura regresión que reintroduzca
 * una "solución" incorrecta (p. ej. ignorar el país y filtrar solo por
 * código de zona, o usar cartera.gerente_zona como respaldo).
 *
 * Ejecutar (tras `npm run build`): node --test test/filtro-republica-dominicana.test.cjs
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
  // Zona "107" existe UNA sola vez en el catálogo (mismo id), pero se usa
  // con pais distinto en cada relación — exactamente como en producción.
  zonas: [{ id: 'zona-107', nombre: '107', activo: true }, { id: 'zona-110', nombre: '110', activo: true }],
  profiles: [
    { id: 'user-daniel', activo: true, nombre: 'Daniel', apellido: 'Monge', role_id: null },
    { id: 'user-oliver', activo: true, nombre: 'Oliver', apellido: 'Santos', role_id: null },
    { id: 'user-angie', activo: true, nombre: 'Angie', apellido: 'Buch', role_id: 'role-gestor' },
    { id: 'user-jasmin', activo: true, nombre: 'Jasmin', apellido: 'Ramirez', role_id: 'role-gestor' },
    // Gerente real de Guatemala, MISMO código de zona "107" que usa RD, pero país distinto.
    { id: 'user-gerente-guatemala', activo: true, nombre: 'Gerente', apellido: 'Guatemala', role_id: 'role-gerente-zona' },
    // Los 5 Gerentes reales del caso ya investigado (0 zonas, ninguna en RD).
    { id: 'user-cristina', activo: true, nombre: 'Cristina', apellido: 'Garcia', role_id: 'role-gerente-zona' }
  ],
  gestores: [
    { id: 'gestor-angie', usuario_id: 'user-angie', nombre_cartera: 'Angie Buch', activo: true },
    { id: 'gestor-jasmin', usuario_id: 'user-jasmin', nombre_cartera: 'Jasmin Ramirez', activo: true }
  ],
  gestor_pais_zona: [
    { id: 'gpz-angie', gestor_id: 'gestor-angie', zona_id: 'zona-110', pais: 'REPUBLICA DOMINICANA', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'gpz-jasmin', gestor_id: 'gestor-jasmin', zona_id: 'zona-107', pais: 'REPUBLICA DOMINICANA', activo: true, fecha_inicio: AYER, fecha_fin: null }
  ],
  gerente_zona_zona: [
    // Gerente de Guatemala: MISMA zona_id "107" que Jasmin usa para RD, pero pais='GUATEMALA'.
    { id: 'gzz-guatemala', usuario_id: 'user-gerente-guatemala', zona_id: 'zona-107', pais: 'GUATEMALA', activo: true, fecha_inicio: AYER, fecha_fin: null }
    // Cristina Garcia: 0 filas (el caso real — ningún Gerente tiene relación RD).
  ],
  supervisor_gestor: [
    { id: 'sg-angie', supervisor_id: 'user-daniel', gestor_id: 'gestor-angie', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sg-jasmin', supervisor_id: 'user-oliver', gestor_id: 'gestor-jasmin', activo: true, fecha_inicio: AYER, fecha_fin: null }
  ],
  supervisor_gerente_zona: [
    { id: 'sgz-guatemala', supervisor_id: 'user-daniel', gerente_zona_id: 'user-gerente-guatemala', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sgz-cristina', supervisor_id: 'user-daniel', gerente_zona_id: 'user-cristina', activo: true, fecha_inicio: AYER, fecha_fin: null }
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
const CARTERA = [
  { codigo: 'CTA-RD-1', gestor: 'ANGIE BUCH TEXTO ERP', pais: 'REPUBLICA DOMINICANA', zona: '110' },
  { codigo: 'CTA-RD-2', gestor: 'JASMIN RAMIREZ TEXTO ERP', pais: 'REPUBLICA DOMINICANA', zona: '107' },
  { codigo: 'CTA-GT-1', gestor: 'OTRO', gerente_zona: 'Gerente Guatemala', pais: 'GUATEMALA', zona: '107' }
];

const obtenerPersonasAdmin = async () => {
  const ctx = await resolveScopeContext({ userId: 'user-admin', roleClave: 'administrador', permissions: [] });
  return { gestores: await gestoresEnAlcance(ctx), gerentes: await gerentesZonaEnAlcance(ctx) };
};

test('Gestor + RD: devuelve opciones reales (Angie Buch, Jasmin Ramirez) — el alcance geográfico RD de Gestor SÍ está configurado', async () => {
  const personas = await obtenerPersonasAdmin();
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, pais: ['REPUBLICA DOMINICANA'] }, personas);
  assert.deepEqual(opts.gestor.slice().sort(), ['Angie Buch', 'Jasmin Ramirez']);
});

test('Gerente + RD: da 0 opciones — CORRECTO, no es un bug: ningún Gerente tiene relación gerente_zona_zona para RD (hueco de datos real, confirmado en Supabase)', async () => {
  const personas = await obtenerPersonasAdmin();
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, pais: ['REPUBLICA DOMINICANA'] }, personas);
  assert.deepEqual(opts.gerente, []);
});

test('El código de zona compartido entre países (RD "107" / Guatemala "107") NUNCA se confunde: el Gerente de Guatemala jamás aparece al filtrar por RD, pese a compartir el número de zona', async () => {
  const personas = await obtenerPersonasAdmin();
  const optsRD = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, pais: ['REPUBLICA DOMINICANA'] }, personas);
  assert.ok(!optsRD.gerente.includes('Gerente Guatemala'));
  const optsGuatemala = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, pais: ['GUATEMALA'] }, personas);
  assert.deepEqual(optsGuatemala.gerente, ['Gerente Guatemala']);
});

test('RD sin seleccionar persona: catálogo completo permitido por alcance (2 Gestores RD; 0 Gerentes, por el hueco de datos real — no vacía el catálogo de OTROS países)', async () => {
  const personas = await obtenerPersonasAdmin();
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, pais: ['REPUBLICA DOMINICANA'] }, personas);
  assert.equal(opts.gestor.length, 2);
  assert.equal(opts.gerente.length, 0);
  // Confirma que el catálogo global (sin filtro) sí incluye al Gerente de Guatemala: el 0 de RD es específico de RD, no un fallo general del catálogo.
  const optsSinFiltro = buildFilterOptions(CARTERA, EMPTY_FILTERS, personas);
  assert.ok(optsSinFiltro.gerente.includes('Gerente Guatemala'));
});

test('RD + Gestor=Angie Buch → Gerente se cruza por GEOGRAFÍA (gestor_pais_zona de Angie): 0 opciones porque ningún Gerente tiene relación gerente_zona_zona en RD — nunca por Supervisor compartido', async () => {
  const personas = await obtenerPersonasAdmin();
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, pais: ['REPUBLICA DOMINICANA'], gestor: ['Angie Buch'] }, personas);
  assert.deepEqual(opts.gerente, [], 'Angie Buch solo tiene REPUBLICA DOMINICANA/110: ningún Gerente tiene esa combinación real, 0 es el resultado correcto (nunca se amplía vía Supervisor)');
});

test('RD + Gerente=Gerente Guatemala → Gestor se cruza por GEOGRAFÍA (gerente_zona_zona de Gerente Guatemala = GUATEMALA/107): 0 opciones, pese a compartir Supervisor con Angie Buch (Daniel Monge)', async () => {
  const personas = await obtenerPersonasAdmin();
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gerente: ['Gerente Guatemala'] }, personas);
  assert.deepEqual(opts.gestor, [], 'Ningún Gestor (Angie/Jasmin, ambos 100% REPUBLICA DOMINICANA) tiene GUATEMALA/107: compartir Supervisor con Gerente Guatemala ya NO es suficiente');
});

test('Seleccionar Gerente=Gerente Guatemala + País=RD nunca devuelve cuentas de Guatemala (0 filas): el cruce por Supervisor nunca amplía el alcance geográfico real de la persona', async () => {
  const personas = await obtenerPersonasAdmin();
  const filtrado = filterCarteraRows(CARTERA, { ...EMPTY_FILTERS, gerente: ['Gerente Guatemala'], pais: ['REPUBLICA DOMINICANA'] }, personas);
  assert.deepEqual(filtrado, []);
});
