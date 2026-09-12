'use strict';

/**
 * Pruebas de la cascada de filtros del Centro de Inteligencia (Sección 6 de
 * la tarea "conexión definitiva usuarios/scope/filtros"). Antes de esta
 * corrección, `filterOptions` se calculaba ignorando por completo los
 * filtros ya seleccionados ("SIN filtros de usuario, para no vaciar los
 * selects"), así que seleccionar un País nunca acotaba las Zonas/Sectores/PD
 * disponibles — inconsistente con el Dashboard (que sí encadena vía
 * `buildFilterOptions`). Ejercita el código YA COMPILADO en dist/
 * (`construirFilterOptionsCentro`, función pura, sin Supabase).
 *
 * Ejecutar (tras `npm run build`): node --test test/inteligencia-filtros-cascada.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const distDir = path.join(__dirname, '..', 'dist');
const { construirFilterOptionsCentro } = require(path.join(distDir, 'services', 'InteligenciaService.js'));

/* Filas ficticias YA scoped (como si vinieran de applyScope): 2 países, cada
 * uno con zonas/sectores/gestores propios y distintos. */
const ROWS = [
  { pais: 'GUATEMALA', zona: '107', sector: 'SECTOR-A', pd_actual: 'PD1', gestor: 'GESTOR GT 1' },
  { pais: 'GUATEMALA', zona: '108', sector: 'SECTOR-B', pd_actual: 'PD2', gestor: 'GESTOR GT 2' },
  { pais: 'REPUBLICA DOMINICANA', zona: '107', sector: 'SECTOR-C', pd_actual: 'PD3', gestor: 'GESTOR RD 1' },
  { pais: 'REPUBLICA DOMINICANA', zona: '110', sector: 'SECTOR-D', pd_actual: 'PD1', gestor: 'GESTOR RD 2' }
];

/* Catálogo de personas (usuarios/roles/gestor_pais_zona), independiente de
 * `cartera.gestor`: un gestor por cada fila (nombre coincide, caso normal) MÁS
 * "GESTOR NUEVO" — un Gestor real (creado por Gestión Masiva) SIN ninguna fila
 * a su nombre en cartera, solo con gestor_pais_zona en REPUBLICA DOMINICANA/110
 * (el caso crítico de la tarea: debe aparecer en el filtro igual). */
const PERSONAS_GESTOR = [
  { nombre: 'GESTOR GT 1', paisZona: [] },
  { nombre: 'GESTOR GT 2', paisZona: [] },
  { nombre: 'GESTOR RD 1', paisZona: [] },
  { nombre: 'GESTOR RD 2', paisZona: [] },
  { nombre: 'GESTOR NUEVO', paisZona: [{ pais: 'REPUBLICA DOMINICANA', zona: '110' }] }
];

test('Sin filtros seleccionados: cada dimensión muestra TODAS las opciones del universo scopeado', () => {
  const opts = construirFilterOptionsCentro(ROWS, {}, PERSONAS_GESTOR);
  assert.deepEqual(opts.pais, ['GUATEMALA', 'REPUBLICA DOMINICANA']);
  assert.deepEqual(opts.zona.sort(), ['107', '108', '110']);
  assert.deepEqual(opts.sector.sort(), ['SECTOR-A', 'SECTOR-B', 'SECTOR-C', 'SECTOR-D']);
  // "GESTOR NUEVO" no tiene ninguna fila con su nombre en cartera, pero SU
  // País-Zona (RD/110) sí está en el universo scopeado ⇒ debe aparecer.
  assert.ok(opts.gestor.includes('GESTOR NUEVO'), 'Un Gestor sin filas en cartera.gestor, pero con gestor_pais_zona vigente, debe aparecer como opción.');
});

test('Seleccionar un País acota Zona/Sector/PD/Gestor a ese País (cascada real)', () => {
  const opts = construirFilterOptionsCentro(ROWS, { pais: ['GUATEMALA'] }, PERSONAS_GESTOR);
  assert.deepEqual(opts.zona.sort(), ['107', '108']);
  assert.deepEqual(opts.sector.sort(), ['SECTOR-A', 'SECTOR-B']);
  assert.deepEqual(opts.gestor.sort(), ['GESTOR GT 1', 'GESTOR GT 2']);
  // El propio filtro País NUNCA se autoexcluye (sigue mostrando ambos países para poder cambiar de selección).
  assert.deepEqual(opts.pais, ['GUATEMALA', 'REPUBLICA DOMINICANA']);
});

test('Seleccionar País + Zona acota además el Sector/PD a esa combinación exacta', () => {
  const opts = construirFilterOptionsCentro(ROWS, { pais: ['GUATEMALA'], zona: ['107'] }, PERSONAS_GESTOR);
  assert.deepEqual(opts.sector, ['SECTOR-A']);
  assert.deepEqual(opts.pd, ['PD1']);
});

test('107GUATEMALA vs 107REPUBLICA DOMINICANA: seleccionar el País correcto nunca mezcla sectores de la Zona homónima del otro País', () => {
  const optsGt = construirFilterOptionsCentro(ROWS, { pais: ['GUATEMALA'], zona: ['107'] }, PERSONAS_GESTOR);
  const optsRd = construirFilterOptionsCentro(ROWS, { pais: ['REPUBLICA DOMINICANA'], zona: ['107'] }, PERSONAS_GESTOR);
  assert.deepEqual(optsGt.sector, ['SECTOR-A']);
  assert.deepEqual(optsRd.sector, ['SECTOR-C']);
  assert.notDeepEqual(optsGt.sector, optsRd.sector);
});

test('Seleccionar un Gestor acota País/Zona a las de ese Gestor (cascada también funciona "hacia arriba")', () => {
  const opts = construirFilterOptionsCentro(ROWS, { gestor: ['GESTOR RD 2'] }, PERSONAS_GESTOR);
  assert.deepEqual(opts.zona, ['110']);
  assert.deepEqual(opts.sector, ['SECTOR-D']);
});

test('Seleccionar "GESTOR NUEVO" (sin coincidencia de nombre en cartera.gestor) filtra por SU País-Zona asignado', () => {
  const opts = construirFilterOptionsCentro(ROWS, { gestor: ['GESTOR NUEVO'] }, PERSONAS_GESTOR);
  // Su gestor_pais_zona es REPUBLICA DOMINICANA/110: debe acotar a esa fila,
  // NUNCA a "ninguna" (que sería el resultado de comparar por texto contra
  // cartera.gestor, ya que ninguna fila dice "GESTOR NUEVO").
  assert.deepEqual(opts.pais, ['REPUBLICA DOMINICANA']);
  assert.deepEqual(opts.zona, ['110']);
  assert.deepEqual(opts.sector, ['SECTOR-D']);
});

test('Filtro que no coincide con ninguna fila: la dimensión dependiente queda vacía (nunca inventa opciones)', () => {
  const opts = construirFilterOptionsCentro(ROWS, { pais: ['PANAMA'] }, PERSONAS_GESTOR);
  assert.deepEqual(opts.zona, []);
  assert.deepEqual(opts.sector, []);
  assert.deepEqual(opts.gestor, []);
});
