'use strict';

/**
 * AUDITORÍA REAL DE SUPABASE (project vuazzailuqgbjnnbdtrg) — estructura de
 * Gerentes agrupada por Gestor.
 *
 * Consultadas directamente las tablas profiles/roles/gestores/
 * supervisor_gestor/supervisor_gerente_zona/gestor_pais_zona/
 * gerente_zona_zona: NO EXISTE una tabla de relación directa Gestor→Gerente
 * de zona en el modelo actual. La única relación real es estructural:
 *
 *   Supervisor
 *   ├── Gestores   (supervisor_gestor)
 *   └── Gerentes de zona (supervisor_gerente_zona)
 *
 * (Posibilidad B del análisis, confirmada con datos reales: 18 Gestores
 * activos repartidos en 2 Supervisores — Daniel Monge: 9 Gestores/57
 * Gerentes; Oliver Santos: 9 Gestores/67 Gerentes —, 0 con más de un
 * Supervisor, 0 relaciones `gestor→gerente` de ningún tipo.)
 *
 * Caso real: Angie Buch (Gestor) → Supervisor Daniel Monge. Los 5 Gerentes
 * "Cristina Garcia, Ircania Guerrero, Julissa Rodriguez, Leydi Perez,
 * Stephanie German" (0 relaciones gerente_zona_zona) también son de Daniel
 * Monge — por eso, y SOLO por eso (compartir Supervisor), es correcto que
 * aparezcan como opciones al seleccionar Angie Buch. Jasmin Ramirez (Gestor)
 * → Supervisor Oliver Santos: sus Gerentes son un conjunto DISJUNTO — ningún
 * Gerente de Daniel Monge debe aparecer al seleccionar Jasmin, y viceversa.
 *
 * Antes de esta corrección, `opcionesPersonas` no aplicaba ningún recorte por
 * Gestor seleccionado: mostraba el catálogo COMPLETO del alcance del usuario
 * conectado (todos los Gerentes de AMBOS Supervisores, si es Administrador)
 * sin importar qué Gestor estuviera seleccionado — violando "todo debe ser
 * intersección, nunca una selección debe recuperar información fuera del
 * alcance autorizado". Ahora `PersonaFiltro.supervisorIds` (ScopeService) +
 * el recorte cruzado en `opcionesPersonas` (carteraAggregations.ts) hacen que
 * seleccionar un Gestor acote el catálogo de Gerente a los que comparten AL
 * MENOS UN Supervisor — y viceversa — nunca vía cartera/ASIGNACION.
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
  zonas: ['133', '140', '154', '126', '146', '201', '210'].map((z) => ({ id: `zona-${z}`, nombre: z, activo: true })),
  profiles: [
    { id: 'user-daniel', activo: true, nombre: 'Daniel', apellido: 'Monge', role_id: null },
    { id: 'user-oliver', activo: true, nombre: 'Oliver', apellido: 'Santos', role_id: null },
    // Rama Daniel Monge: Angie Buch (Gestor) + 5 Gerentes reales SIN zonas + 1 con zona.
    { id: 'user-angie', activo: true, nombre: 'Angie', apellido: 'Buch', role_id: 'role-gestor' },
    { id: 'user-cristina', activo: true, nombre: 'Cristina', apellido: 'Garcia', role_id: 'role-gerente-zona' },
    { id: 'user-ircania', activo: true, nombre: 'Ircania', apellido: 'Guerrero', role_id: 'role-gerente-zona' },
    { id: 'user-julissa', activo: true, nombre: 'Julissa', apellido: 'Rodriguez', role_id: 'role-gerente-zona' },
    { id: 'user-leydi', activo: true, nombre: 'Leydi', apellido: 'Perez', role_id: 'role-gerente-zona' },
    { id: 'user-stephanie', activo: true, nombre: 'Stephanie', apellido: 'German', role_id: 'role-gerente-zona' },
    { id: 'user-gerente-daniel-con-zona', activo: true, nombre: 'Gerente', apellido: 'DeDaniel', role_id: 'role-gerente-zona' },
    // Rama Oliver Santos: Jasmin Ramirez (Gestor) + 2 Gerentes.
    { id: 'user-jasmin', activo: true, nombre: 'Jasmin', apellido: 'Ramirez', role_id: 'role-gestor' },
    { id: 'user-gerente-oliver-1', activo: true, nombre: 'Gerente', apellido: 'DeOliverUno', role_id: 'role-gerente-zona' },
    { id: 'user-gerente-oliver-2', activo: true, nombre: 'Gerente', apellido: 'DeOliverDos', role_id: 'role-gerente-zona' },
    // Gerente sin Supervisor asignado (13 casos reales en producción).
    { id: 'user-gerente-sin-supervisor', activo: true, nombre: 'Gerente', apellido: 'SinSupervisor', role_id: 'role-gerente-zona' }
  ],
  gestores: [
    { id: 'gestor-angie', usuario_id: 'user-angie', nombre_cartera: 'Angie Buch', activo: true },
    { id: 'gestor-jasmin', usuario_id: 'user-jasmin', nombre_cartera: 'Jasmin Ramirez', activo: true }
  ],
  gestor_pais_zona: [
    { id: 'gpz-angie-1', gestor_id: 'gestor-angie', zona_id: 'zona-133', pais: 'REPUBLICA DOMINICANA', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'gpz-jasmin-1', gestor_id: 'gestor-jasmin', zona_id: 'zona-201', pais: 'HONDURAS', activo: true, fecha_inicio: AYER, fecha_fin: null }
  ],
  gerente_zona_zona: [
    { id: 'gzz-daniel-1', usuario_id: 'user-gerente-daniel-con-zona', zona_id: 'zona-146', pais: 'REPUBLICA DOMINICANA', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'gzz-oliver-1', usuario_id: 'user-gerente-oliver-1', zona_id: 'zona-201', pais: 'HONDURAS', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'gzz-oliver-2', usuario_id: 'user-gerente-oliver-2', zona_id: 'zona-210', pais: 'HONDURAS', activo: true, fecha_inicio: AYER, fecha_fin: null }
    // Cristina/Ircania/Julissa/Leydi/Stephanie: 0 filas (el caso real de producción).
    // Gerente SinSupervisor: 0 filas (irrelevante, no tiene Supervisor de todas formas).
  ],
  supervisor_gestor: [
    { id: 'sg-angie', supervisor_id: 'user-daniel', gestor_id: 'gestor-angie', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sg-jasmin', supervisor_id: 'user-oliver', gestor_id: 'gestor-jasmin', activo: true, fecha_inicio: AYER, fecha_fin: null }
  ],
  supervisor_gerente_zona: [
    { id: 'sgz-cristina', supervisor_id: 'user-daniel', gerente_zona_id: 'user-cristina', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sgz-ircania', supervisor_id: 'user-daniel', gerente_zona_id: 'user-ircania', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sgz-julissa', supervisor_id: 'user-daniel', gerente_zona_id: 'user-julissa', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sgz-leydi', supervisor_id: 'user-daniel', gerente_zona_id: 'user-leydi', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sgz-stephanie', supervisor_id: 'user-daniel', gerente_zona_id: 'user-stephanie', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sgz-daniel-con-zona', supervisor_id: 'user-daniel', gerente_zona_id: 'user-gerente-daniel-con-zona', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sgz-oliver-1', supervisor_id: 'user-oliver', gerente_zona_id: 'user-gerente-oliver-1', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sgz-oliver-2', supervisor_id: 'user-oliver', gerente_zona_id: 'user-gerente-oliver-2', activo: true, fecha_inicio: AYER, fecha_fin: null }
    // user-gerente-sin-supervisor: 0 filas — sin Supervisor, el caso real (13 en producción).
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

test('Auditoría: gestoresEnAlcance/gerentesZonaEnAlcance traen supervisorIds reales (supervisor_gestor / supervisor_gerente_zona) — nunca cartera', async () => {
  const personas = await obtenerPersonasAdmin();
  const angie = personas.gestores.find((g) => g.nombre === 'Angie Buch');
  const cristina = personas.gerentes.find((g) => g.nombre === 'Cristina Garcia');
  assert.deepEqual(angie.supervisorIds, ['user-daniel']);
  assert.deepEqual(cristina.supervisorIds, ['user-daniel']);
});

test('Sin ningún Gestor/Gerente seleccionado: catálogo COMPLETO (Administrador ve ambas ramas, Daniel Monge y Oliver Santos)', async () => {
  const personas = await obtenerPersonasAdmin();
  const opts = buildFilterOptions(CARTERA, EMPTY_FILTERS, personas);
  assert.ok(opts.gestor.includes('Angie Buch') && opts.gestor.includes('Jasmin Ramirez'));
  for (const nombre of ['Cristina Garcia', 'Ircania Guerrero', 'Julissa Rodriguez', 'Leydi Perez', 'Stephanie German', 'Gerente DeDaniel', 'Gerente DeOliverUno', 'Gerente DeOliverDos', 'Gerente SinSupervisor']) {
    assert.ok(opts.gerente.includes(nombre), `${nombre} debe estar en el catálogo completo`);
  }
});

test('CASO ANGIE BUCH: seleccionar Gestor=Angie Buch (Supervisor Daniel Monge) muestra EXACTAMENTE los Gerentes de Daniel Monge, incluidos los 5 con 0 zonas — nunca los de Oliver Santos', async () => {
  const personas = await obtenerPersonasAdmin();
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Angie Buch'] }, personas);
  const esperados = ['Cristina Garcia', 'Gerente DeDaniel', 'Ircania Guerrero', 'Julissa Rodriguez', 'Leydi Perez', 'Stephanie German'].sort();
  assert.deepEqual(opts.gerente.slice().sort(), esperados);
});

test('CASO JASMIN RAMIREZ: seleccionar Gestor=Jasmin Ramirez (Supervisor Oliver Santos) muestra EXACTAMENTE los 2 Gerentes de Oliver Santos — conjunto DISJUNTO del de Angie', async () => {
  const personas = await obtenerPersonasAdmin();
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Jasmin Ramirez'] }, personas);
  assert.deepEqual(opts.gerente.slice().sort(), ['Gerente DeOliverDos', 'Gerente DeOliverUno']);
  for (const nombre of ['Cristina Garcia', 'Ircania Guerrero', 'Julissa Rodriguez', 'Leydi Perez', 'Stephanie German', 'Gerente DeDaniel']) {
    assert.ok(!opts.gerente.includes(nombre), `${nombre} es de Daniel Monge: no debe aparecer al seleccionar Jasmin (Oliver Santos)`);
  }
});

test('Gerente sin Supervisor (13 casos reales en producción): al seleccionar CUALQUIER Gestor, nunca aparece (no comparte Supervisor con nadie)', async () => {
  const personas = await obtenerPersonasAdmin();
  const optsAngie = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Angie Buch'] }, personas);
  const optsJasmin = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Jasmin Ramirez'] }, personas);
  assert.ok(!optsAngie.gerente.includes('Gerente SinSupervisor'));
  assert.ok(!optsJasmin.gerente.includes('Gerente SinSupervisor'));
});

test('RECÍPROCO: seleccionar un Gerente de Daniel Monge (p. ej. Cristina Garcia, con 0 zonas) acota el catálogo de Gestor a los de Daniel Monge (Angie), nunca a los de Oliver Santos (Jasmin)', async () => {
  const personas = await obtenerPersonasAdmin();
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gerente: ['Cristina Garcia'] }, personas);
  assert.deepEqual(opts.gestor, ['Angie Buch']);
});

test('Seleccionar un Gerente de 0 zonas (Cristina Garcia) sigue devolviendo 0 filas de cartera, aunque estructuralmente esté ligada a Angie por Supervisor', async () => {
  const personas = await obtenerPersonasAdmin();
  const CARTERA_CON_FILAS = [
    { codigo: 'CTA-1', gestor: 'ANGIE BUCH', gerente_zona: 'Cristina Garcia', pais: 'REPUBLICA DOMINICANA', zona: '133' }
  ];
  const filtrado = filterCarteraRows(CARTERA_CON_FILAS, { ...EMPTY_FILTERS, gerente: ['Cristina Garcia'] }, personas);
  assert.deepEqual(filtrado, [], 'Compartir Supervisor con Angie NUNCA amplía el alcance geográfico de Cristina (0 gerente_zona_zona = 0 cartera)');
});

test('Combinado: Gestor=Angie Buch + Zona=146 (la única zona real entre los Gerentes de Daniel Monge) acota a "Gerente DeDaniel" únicamente (intersección Supervisor AND geografía)', async () => {
  const personas = await obtenerPersonasAdmin();
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Angie Buch'], zona: ['146'] }, personas);
  assert.deepEqual(opts.gerente, ['Gerente DeDaniel']);
});

test('Solo País=REPUBLICA DOMINICANA (sin Gestor/Zona) acota Gerente a quienes tienen ESA geografía propia — nunca por supervisor', async () => {
  const personas = await obtenerPersonasAdmin();
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, pais: ['REPUBLICA DOMINICANA'] }, personas);
  // Solo "Gerente DeDaniel" tiene gerente_zona_zona real en RD; los 5 de Daniel
  // sin zona y los 2 de Oliver (Honduras) quedan fuera únicamente por geografía.
  assert.deepEqual(opts.gerente, ['Gerente DeDaniel']);
});

test('Eliminar el filtro Gestor recalcula Gerente de vuelta al catálogo completo (sin restricción de supervisor)', async () => {
  const personas = await obtenerPersonasAdmin();
  const conGestor = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Angie Buch'] }, personas);
  assert.equal(conGestor.gerente.length, 6, 'Con Gestor=Angie Buch: acotado a los 6 de Daniel Monge');
  const sinGestor = buildFilterOptions(CARTERA, EMPTY_FILTERS, personas);
  assert.equal(sinGestor.gerente.length, 9, 'Al quitar el filtro Gestor, Gerente vuelve a las 9 opciones del alcance completo (Administrador)');
});

test('Eliminar el filtro Zona (dejando Gestor) recalcula Gerente a la intersección Supervisor+País, ya sin la restricción de Zona', async () => {
  const personas = await obtenerPersonasAdmin();
  const conZona = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Angie Buch'], zona: ['146'] }, personas);
  assert.deepEqual(conZona.gerente, ['Gerente DeDaniel']);
  const sinZona = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Angie Buch'] }, personas);
  assert.deepEqual(sinZona.gerente.slice().sort(), ['Cristina Garcia', 'Gerente DeDaniel', 'Ircania Guerrero', 'Julissa Rodriguez', 'Leydi Perez', 'Stephanie German']);
});

test('Gestor + País + Zona incompatibles entre sí (ninguna persona real cumple las TRES condiciones a la vez): Gerente queda vacío — "Sin opciones", nunca inventa', async () => {
  const personas = await obtenerPersonasAdmin();
  // Angie Buch (Daniel Monge) + Zona 201 (zona real de HONDURAS, rama de Oliver Santos):
  // ningún Gerente de Daniel Monge tiene esa zona -> intersección vacía.
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Angie Buch'], pais: ['HONDURAS'], zona: ['201'] }, personas);
  assert.deepEqual(opts.gerente, []);
});

test('El texto de cartera.gestor/cartera.gerente_zona (aunque venga en las filas) NUNCA se usa para construir el catálogo de Gerente: solo usuarios/roles/relaciones', async () => {
  const personas = await obtenerPersonasAdmin();
  // Filas de cartera con texto de gestor/gerente_zona DELIBERADAMENTE incorrecto/no
  // relacionado (nombres que no existen en el catálogo de personas real): si el
  // catálogo se construyera desde cartera, "Persona Inventada" aparecería como opción.
  const CARTERA_CON_TEXTO_AJENO = [
    { codigo: 'CTA-X', gestor: 'PERSONA INVENTADA', gerente_zona: 'OTRA PERSONA INVENTADA', pais: 'GUATEMALA', zona: '999' }
  ];
  const opts = buildFilterOptions(CARTERA_CON_TEXTO_AJENO, { ...EMPTY_FILTERS, gestor: ['Angie Buch'] }, personas);
  assert.ok(!opts.gerente.includes('PERSONA INVENTADA') && !opts.gerente.includes('OTRA PERSONA INVENTADA'));
  assert.deepEqual(opts.gerente.slice().sort(), ['Cristina Garcia', 'Gerente DeDaniel', 'Ircania Guerrero', 'Julissa Rodriguez', 'Leydi Perez', 'Stephanie German']);
});
