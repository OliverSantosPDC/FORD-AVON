'use strict';

/**
 * REGLA DE NEGOCIO CORREGIDA (esta versión reemplaza la anterior) — cascada
 * Gestor→Gerente y Gerente→Gestor en `buildFilterOptions`/`opcionesPersonas`
 * (carteraAggregations.ts).
 *
 * ANTES: al seleccionar un Gestor, Gerente se acotaba a "todas las personas
 * que comparten AL MENOS UN Supervisor con el Gestor seleccionado" —
 * `PersonaFiltro.supervisorIds` vía `supervisor_gestor`/`supervisor_gerente_zona`.
 * Esto era demostrablemente incorrecto en producción: un Supervisor puede
 * tener decenas de Gerentes (Daniel Monge: 57; Oliver Santos: 67) mientras
 * el Gestor seleccionado solo tiene 5-10 zonas reales — seleccionar ese
 * Gestor mostraba TODO el equipo del Supervisor, no las personas realmente
 * compatibles geográficamente (auditado con datos reales de producción,
 * project vuazzailuqgbjnnbdtrg, caso "Alejandra Diaz").
 *
 * AHORA: la cascada es GEOGRÁFICA. Al seleccionar un Gestor, Gerente se
 * acota a las personas cuyo PROPIO País-Zona (`gerente_zona_zona`)
 * intersecta AL MENOS UNA combinación País-Zona propia del Gestor
 * seleccionado (`gestor_pais_zona`) — nunca por Supervisor compartido. La
 * relación Supervisor→Gestor/Supervisor→Gerente se conserva en el modelo
 * (`PersonaFiltro.supervisorIds` sigue poblándose desde ScopeService) pero
 * ya NO participa en esta cascada — solo en el ALCANCE/autorización previo
 * (`gestoresEnAlcance`/`gerentesZonaEnAlcance`, sin cambios).
 *
 * IMPORTANTE (caso real verificado antes de implementar, sin inventar
 * cifras): REPUBLICA DOMINICANA tiene 0 filas en `gerente_zona_zona` en
 * TODA la base real — por lo tanto un Gestor de RD (p. ej. Angie Buch,
 * Jasmin Ramirez) produce 0 Gerentes compatibles hasta que un administrador
 * configure esas relaciones. Esto NO es un defecto: es la regla ("no
 * fabricar datos ni relaciones", ya establecida explícitamente para RD).
 *
 * Ejecutar (tras `npm run build`): node --test test/gestor-gerente-relacion-supervisor.test.cjs
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
  zonas: ['614', '615', '616', '107', '999'].map((z) => ({ id: `zona-${z}`, nombre: z, activo: true })),
  profiles: [
    { id: 'user-daniel', activo: true, nombre: 'Daniel', apellido: 'Monge', role_id: null },
    // Alejandra Diaz (Gestor real, caso PANAMA/614,615,616 — auditado en producción).
    { id: 'user-alejandra', activo: true, nombre: 'Alejandra', apellido: 'Diaz', role_id: 'role-gestor' },
    // Jasmin Ramirez (Gestor real, caso REPUBLICA DOMINICANA/107 — 0 gerente_zona_zona en RD).
    { id: 'user-jasmin', activo: true, nombre: 'Jasmin', apellido: 'Ramirez', role_id: 'role-gestor' },
    // Gerentes reales compatibles geográficamente con Alejandra (614, 615).
    { id: 'user-evelyn', activo: true, nombre: 'Evelyn', apellido: 'Trotman', role_id: 'role-gerente-zona' },
    { id: 'user-linette', activo: true, nombre: 'Linette', apellido: 'Cardenas', role_id: 'role-gerente-zona' },
    // Gerente con zona PANAMA/999 (Alejandra no tiene esa zona): NO compatible.
    { id: 'user-humberto', activo: true, nombre: 'Humberto', apellido: 'Pinto', role_id: 'role-gerente-zona' },
    // Gerente con el MISMO código numérico de zona (614) pero en OTRO país: NO debe mezclarse.
    { id: 'user-guate614', activo: true, nombre: 'Gerente', apellido: 'GuatemalaSameCode', role_id: 'role-gerente-zona' },
    // Gerente sin ninguna relación gerente_zona_zona (13 casos reales en producción).
    { id: 'user-gerente-sin-zonas', activo: true, nombre: 'Gerente', apellido: 'SinZonas', role_id: 'role-gerente-zona' },
    // Comparten Supervisor con Alejandra (Daniel Monge) pero NO comparten geografía:
    // deben quedar EXCLUIDOS — prueba directa de que ya no se usa Supervisor.
    { id: 'user-mismosupervisor-otrageografia', activo: true, nombre: 'Gerente', apellido: 'MismoSupervisorOtraGeografia', role_id: 'role-gerente-zona' }
  ],
  gestores: [
    { id: 'gestor-alejandra', usuario_id: 'user-alejandra', nombre_cartera: 'Alejandra Diaz', activo: true },
    { id: 'gestor-jasmin', usuario_id: 'user-jasmin', nombre_cartera: 'Jasmin Ramirez', activo: true }
  ],
  gestor_pais_zona: [
    { id: 'gpz-alejandra-1', gestor_id: 'gestor-alejandra', zona_id: 'zona-614', pais: 'PANAMA', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'gpz-alejandra-2', gestor_id: 'gestor-alejandra', zona_id: 'zona-615', pais: 'PANAMA', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'gpz-alejandra-3', gestor_id: 'gestor-alejandra', zona_id: 'zona-616', pais: 'PANAMA', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'gpz-jasmin-1', gestor_id: 'gestor-jasmin', zona_id: 'zona-107', pais: 'REPUBLICA DOMINICANA', activo: true, fecha_inicio: AYER, fecha_fin: null }
  ],
  gerente_zona_zona: [
    { id: 'gzz-evelyn', usuario_id: 'user-evelyn', zona_id: 'zona-614', pais: 'PANAMA', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'gzz-linette', usuario_id: 'user-linette', zona_id: 'zona-615', pais: 'PANAMA', activo: true, fecha_inicio: AYER, fecha_fin: null },
    // Humberto: zona 616 pero -- ver abajo, lo dejamos SIN relación con 616 (usa una zona ajena)
    // para simular "gerente con zona real pero fuera del conjunto de Alejandra": no hay zona-999
    // en este fixture, así que Humberto queda deliberadamente SIN fila (0 relaciones) — ver test.
    // GuatemalaSameCode: MISMO código "614" que Alejandra pero en GUATEMALA (no PANAMA) — nunca debe mezclarse.
    { id: 'gzz-guate614', usuario_id: 'user-guate614', zona_id: 'zona-614', pais: 'GUATEMALA', activo: true, fecha_inicio: AYER, fecha_fin: null },
    // Zona 999 de HONDURAS: no coincide con NINGUNA zona real de Alejandra (PANAMA) ni de Jasmin (REPUBLICA DOMINICANA/107).
    { id: 'gzz-mismosuper', usuario_id: 'user-mismosupervisor-otrageografia', zona_id: 'zona-999', pais: 'HONDURAS', activo: true, fecha_inicio: AYER, fecha_fin: null }
    // Gerente SinZonas: 0 filas (caso real de producción).
  ],
  supervisor_gestor: [
    { id: 'sg-alejandra', supervisor_id: 'user-daniel', gestor_id: 'gestor-alejandra', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sg-jasmin', supervisor_id: 'user-daniel', gestor_id: 'gestor-jasmin', activo: true, fecha_inicio: AYER, fecha_fin: null }
  ],
  supervisor_gerente_zona: [
    // TODOS estos Gerentes comparten el MISMO Supervisor (Daniel Monge) que Alejandra —
    // bajo la regla ANTERIOR (Supervisor) todos aparecerían; bajo la regla NUEVA
    // (geografía) solo Evelyn/Linette deben aparecer para Alejandra.
    { id: 'sgz-evelyn', supervisor_id: 'user-daniel', gerente_zona_id: 'user-evelyn', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sgz-linette', supervisor_id: 'user-daniel', gerente_zona_id: 'user-linette', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sgz-humberto', supervisor_id: 'user-daniel', gerente_zona_id: 'user-humberto', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sgz-guate614', supervisor_id: 'user-daniel', gerente_zona_id: 'user-guate614', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sgz-sinzonas', supervisor_id: 'user-daniel', gerente_zona_id: 'user-gerente-sin-zonas', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sgz-mismosuper', supervisor_id: 'user-daniel', gerente_zona_id: 'user-mismosupervisor-otrageografia', activo: true, fecha_inicio: AYER, fecha_fin: null }
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
const CARTERA = []; // Irrelevante para catálogo de opciones (identidad viene de usuarios, nunca de cartera).

const obtenerPersonasAdmin = async () => {
  const ctx = await resolveScopeContext({ userId: 'user-admin', roleClave: 'administrador', permissions: [] });
  return { gestores: await gestoresEnAlcance(ctx), gerentes: await gerentesZonaEnAlcance(ctx) };
};

test('Auditoría: PersonaFiltro.supervisorIds se conserva (dato de alcance), pero ya NO se usa para la cascada Gestor↔Gerente', async () => {
  const personas = await obtenerPersonasAdmin();
  const alejandra = personas.gestores.find((g) => g.nombre === 'Alejandra Diaz');
  assert.deepEqual(alejandra.supervisorIds, ['user-daniel'], 'La relación Supervisor→Gestor se conserva en el modelo');
});

test('Sin ningún Gestor/Gerente seleccionado: catálogo COMPLETO permitido por el alcance (Administrador ve todos)', async () => {
  const personas = await obtenerPersonasAdmin();
  const opts = buildFilterOptions(CARTERA, EMPTY_FILTERS, personas);
  assert.ok(opts.gestor.includes('Alejandra Diaz') && opts.gestor.includes('Jasmin Ramirez'));
  for (const nombre of ['Evelyn Trotman', 'Linette Cardenas', 'Humberto Pinto', 'Gerente GuatemalaSameCode', 'Gerente SinZonas', 'Gerente MismoSupervisorOtraGeografia']) {
    assert.ok(opts.gerente.includes(nombre), `${nombre} debe estar en el catálogo completo (sin Gestor seleccionado)`);
  }
});

test('CASO ALEJANDRA DIAZ (real, PANAMA 614/615/616): Gerente se acota EXCLUSIVAMENTE a quienes comparten País+Zona real — nunca por Supervisor compartido', async () => {
  const personas = await obtenerPersonasAdmin();
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Alejandra Diaz'] }, personas);
  assert.deepEqual(opts.gerente.slice().sort(), ['Evelyn Trotman', 'Linette Cardenas']);
  // Comparten Supervisor (Daniel Monge) con Alejandra pero NINGUNA geografía en común: excluidos.
  assert.ok(!opts.gerente.includes('Humberto Pinto'), 'Humberto no tiene ninguna zona real: nunca es compatible');
  assert.ok(!opts.gerente.includes('Gerente MismoSupervisorOtraGeografia'), 'Mismo Supervisor pero otra geografía (HONDURAS/999): ya NO es suficiente para aparecer');
  assert.ok(!opts.gerente.includes('Gerente SinZonas'), 'Sin relaciones geográficas propias: nunca compatible con un Gestor seleccionado');
});

test('MISMO código de zona (614) en países distintos NUNCA se mezcla: Gerente GuatemalaSameCode no es compatible con Alejandra (PANAMA)', async () => {
  const personas = await obtenerPersonasAdmin();
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Alejandra Diaz'] }, personas);
  assert.ok(!opts.gerente.includes('Gerente GuatemalaSameCode'), 'GUATEMALA/614 y PANAMA/614 son geografías distintas: PaisZona = País + Zona, nunca solo el código de zona');
});

test('CASO JASMIN RAMIREZ (real, REPUBLICA DOMINICANA/107): 0 Gerentes compatibles — RD no tiene relaciones gerente_zona_zona configuradas, y eso NO se fabrica', async () => {
  const personas = await obtenerPersonasAdmin();
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Jasmin Ramirez'] }, personas);
  assert.deepEqual(opts.gerente, [], 'Ningún Gerente tiene gerente_zona_zona en REPUBLICA DOMINICANA en este fixture (replica el caso real de producción): "Sin opciones" es el resultado correcto');
});

test('RECÍPROCO: seleccionar un Gerente (Evelyn Trotman, PANAMA/614) acota el catálogo de Gestor a quienes comparten esa geografía — Alejandra sí, Jasmin (RD) no', async () => {
  const personas = await obtenerPersonasAdmin();
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gerente: ['Evelyn Trotman'] }, personas);
  assert.deepEqual(opts.gestor, ['Alejandra Diaz']);
});

test('Gerente sin ninguna zona real (Gerente SinZonas) nunca puede acotar el catálogo de Gestor: intersección vacía = 0 opciones, nunca "todos"', async () => {
  const personas = await obtenerPersonasAdmin();
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gerente: ['Gerente SinZonas'] }, personas);
  assert.deepEqual(opts.gestor, []);
});

test('Combinado: Gestor=Alejandra Diaz + Zona=615 acota a Linette Cardenas únicamente (intersección Gestor AND Zona explícita)', async () => {
  const personas = await obtenerPersonasAdmin();
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Alejandra Diaz'], zona: ['615'] }, personas);
  assert.deepEqual(opts.gerente, ['Linette Cardenas']);
});

test('Combinado: Gestor=Alejandra Diaz + País=PANAMA mantiene ambos Gerentes compatibles (su único país real ya es PANAMA)', async () => {
  const personas = await obtenerPersonasAdmin();
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Alejandra Diaz'], pais: ['PANAMA'] }, personas);
  assert.deepEqual(opts.gerente.slice().sort(), ['Evelyn Trotman', 'Linette Cardenas']);
});

test('Gestor + País incompatible entre sí (Alejandra es 100% PANAMA; País=GUATEMALA no tiene ninguna zona real de ella): Gerente queda vacío', async () => {
  const personas = await obtenerPersonasAdmin();
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Alejandra Diaz'], pais: ['GUATEMALA'] }, personas);
  assert.deepEqual(opts.gerente, [], 'Ninguna combinación País-Zona de Alejandra es GUATEMALA: nunca inventa compatibilidad');
});

test('Eliminar el filtro Gestor recalcula Gerente de vuelta al catálogo completo permitido por el alcance', async () => {
  const personas = await obtenerPersonasAdmin();
  const conGestor = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Alejandra Diaz'] }, personas);
  assert.equal(conGestor.gerente.length, 2, 'Con Gestor=Alejandra Diaz: acotado a sus 2 Gerentes geográficamente compatibles');
  const sinGestor = buildFilterOptions(CARTERA, EMPTY_FILTERS, personas);
  assert.equal(sinGestor.gerente.length, 6, 'Al quitar el filtro Gestor, Gerente vuelve a las 6 opciones del alcance completo (Administrador)');
});

test('Eliminar el filtro Zona (dejando Gestor) recalcula Gerente de vuelta a la intersección geográfica completa del Gestor, sin la restricción adicional de Zona', async () => {
  const personas = await obtenerPersonasAdmin();
  const conZona = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Alejandra Diaz'], zona: ['614'] }, personas);
  assert.deepEqual(conZona.gerente, ['Evelyn Trotman']);
  const sinZona = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Alejandra Diaz'] }, personas);
  assert.deepEqual(sinZona.gerente.slice().sort(), ['Evelyn Trotman', 'Linette Cardenas']);
});

test('Cambiar de Gestor recalcula Gerente por completo (Alejandra → Jasmin)', async () => {
  const personas = await obtenerPersonasAdmin();
  const conAlejandra = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Alejandra Diaz'] }, personas);
  assert.deepEqual(conAlejandra.gerente.slice().sort(), ['Evelyn Trotman', 'Linette Cardenas']);
  const conJasmin = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Jasmin Ramirez'] }, personas);
  assert.deepEqual(conJasmin.gerente, []);
});

test('El texto de cartera.gestor/cartera.gerente_zona (aunque venga en las filas) NUNCA se usa para construir el catálogo de Gerente: solo usuarios/roles/relaciones', async () => {
  const personas = await obtenerPersonasAdmin();
  const CARTERA_CON_TEXTO_AJENO = [
    { codigo: 'CTA-X', gestor: 'PERSONA INVENTADA', gerente_zona: 'OTRA PERSONA INVENTADA', pais: 'PANAMA', zona: '614' }
  ];
  const opts = buildFilterOptions(CARTERA_CON_TEXTO_AJENO, { ...EMPTY_FILTERS, gestor: ['Alejandra Diaz'] }, personas);
  assert.ok(!opts.gerente.includes('PERSONA INVENTADA') && !opts.gerente.includes('OTRA PERSONA INVENTADA'));
  assert.deepEqual(opts.gerente.slice().sort(), ['Evelyn Trotman', 'Linette Cardenas']);
});

test('Seleccionar un Gerente de 0 zonas propias (Gerente SinZonas) sigue devolviendo 0 filas de cartera aunque compartiera Supervisor con Alejandra', async () => {
  const personas = await obtenerPersonasAdmin();
  const CARTERA_CON_FILAS = [
    { codigo: 'CTA-1', gestor: 'ALEJANDRA DIAZ', gerente_zona: 'GERENTE SINZONAS', pais: 'PANAMA', zona: '614' }
  ];
  const filtrado = filterCarteraRows(CARTERA_CON_FILAS, { ...EMPTY_FILTERS, gerente: ['Gerente SinZonas'] }, personas);
  assert.deepEqual(filtrado, [], 'Sin gerente_zona_zona propio, nunca hay filas de cartera visibles para ese Gerente');
});
