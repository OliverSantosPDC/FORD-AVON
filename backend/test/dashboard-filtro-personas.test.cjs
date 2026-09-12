'use strict';

/**
 * Pruebas de `buildFilterOptions` / `filterCarteraRows` (Dashboard) con el
 * catálogo de PERSONAS (Sección 1-16 de la tarea "conexión definitiva
 * usuarios/scope/filtros"). Antes de esta corrección, ambas funciones
 * derivaban las opciones y la aplicación del filtro Gestor/Gerente de
 * `cartera.gestor`/`cartera.gerente_zona` (texto) — el patrón explícitamente
 * prohibido (`const gestores = [...new Set(cartera.map(x => x.gestor))]`).
 * Ahora reciben `personas` (equivalente a ScopeService.gestoresEnAlcance/
 * gerentesZonaEnAlcance) y usan su propio gestor_pais_zona/gerente_zona_zona
 * como fuente adicional (OR), nunca solo el nombre.
 *
 * Ejercita el código YA COMPILADO en dist/ (funciones puras, sin Supabase).
 *
 * Ejecutar (tras `npm run build`): node --test test/dashboard-filtro-personas.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const distDir = path.join(__dirname, '..', 'dist');
const { buildFilterOptions, filterCarteraRows } = require(path.join(distDir, 'utils', 'carteraAggregations.js'));

/* Cartera ficticia YA scoped (como si viniera de applyScope). La fila de
 * REPUBLICA DOMINICANA/110 NO tiene el nombre de "BRYAN RODRIGUEZ" — su único
 * vínculo es el País-Zona (como la Angie Buch real: 0 coincidencias de nombre
 * en cartera.gestor, 100% de su alcance vía gestor_pais_zona). */
const ROWS = [
  { codigo: 'CTA-1', pais: 'EL SALVADOR', zona: '201', gestor: 'MARIA LOPEZ', gerente_zona: 'CARLOS RUIZ' },
  { codigo: 'CTA-2', pais: 'GUATEMALA', zona: '107', gestor: 'MARIA LOPEZ', gerente_zona: 'CARLOS RUIZ' },
  // Fila de Bryan Rodríguez: su nombre NUNCA aparece como cartera.gestor.
  { codigo: 'CTA-3', pais: 'GUATEMALA', zona: '107', gestor: 'NOMBRE HISTORICO SIN RELACION', gerente_zona: 'CARLOS RUIZ' },
  { codigo: 'CTA-4', pais: 'REPUBLICA DOMINICANA', zona: '110', gestor: 'OTRO NOMBRE HISTORICO', gerente_zona: 'PEDRO GOMEZ' }
];

/* Catálogo de personas EN EL ALCANCE del usuario conectado (equivalente a
 * ScopeService.gestoresEnAlcance / gerentesZonaEnAlcance): "BRYAN RODRIGUEZ"
 * existe como Gestor real en Supabase (usuarios/roles/gestor_pais_zona) con
 * asignación 201EL SALVADOR + 107GUATEMALA — el ejemplo exacto de la tarea —
 * pero 0 filas de cartera dicen literalmente "BRYAN RODRIGUEZ". */
const PERSONAS = {
  gestores: [
    { nombre: 'MARIA LOPEZ', paisZona: [] },
    { nombre: 'BRYAN RODRIGUEZ', paisZona: [{ pais: 'EL SALVADOR', zona: '201' }, { pais: 'GUATEMALA', zona: '107' }] }
  ],
  gerentes: [
    { nombre: 'CARLOS RUIZ', paisZona: [] },
    // Gerente de zona real sin coincidencia de nombre en cartera.gerente_zona, solo por gerente_zona_zona.
    { nombre: 'ANGIE BUCH', paisZona: [{ pais: 'REPUBLICA DOMINICANA', zona: '110' }] }
  ]
};

const EMPTY_FILTERS = { pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] };

test('buildFilterOptions: "BRYAN RODRIGUEZ" aparece como opción de Gestor aunque NINGUNA fila de cartera.gestor diga su nombre', () => {
  const opts = buildFilterOptions(ROWS, EMPTY_FILTERS, PERSONAS);
  assert.ok(opts.gestor.includes('BRYAN RODRIGUEZ'), 'Un Gestor real (usuarios+gestor_pais_zona) debe aparecer en el filtro sin depender de cartera.gestor.');
  assert.ok(opts.gestor.includes('MARIA LOPEZ'));
});

test('buildFilterOptions: "ANGIE BUCH" (Gerente de zona) aparece como opción aunque su nombre no exista en cartera.gerente_zona', () => {
  const opts = buildFilterOptions(ROWS, EMPTY_FILTERS, PERSONAS);
  assert.ok(opts.gerente.includes('ANGIE BUCH'));
});

test('Seleccionar "BRYAN RODRIGUEZ": filtra la cartera por SU País-Zona (201EL SALVADOR + 107GUATEMALA), nunca por texto cartera.gestor = "Bryan Rodriguez"', () => {
  const filtrado = filterCarteraRows(ROWS, { ...EMPTY_FILTERS, gestor: ['BRYAN RODRIGUEZ'] }, PERSONAS);
  const codigos = filtrado.map((r) => r.codigo).sort();
  // CTA-1 (EL SALVADOR/201) y CTA-2/CTA-3 (GUATEMALA/107) son SU País-Zona
  // asignado: ninguna de las tres filas dice literalmente "Bryan Rodriguez" en
  // cartera.gestor, y aun así las tres quedan incluidas porque su
  // gestor_pais_zona las alcanza — exactamente el criterio de la tarea
  // ("PAÍS=EL SALVADOR y las Zonas autorizadas", nunca cartera.gestor = nombre).
  assert.deepEqual(codigos, ['CTA-1', 'CTA-2', 'CTA-3']);
  // Nunca incluye CTA-4 (REPUBLICA DOMINICANA, fuera de su alcance asignado).
  assert.ok(!codigos.includes('CTA-4'));
});

test('Seleccionar "ANGIE BUCH": filtra la cartera por SU País-Zona (REPUBLICA DOMINICANA/110), nunca por texto cartera.gerente_zona', () => {
  const filtrado = filterCarteraRows(ROWS, { ...EMPTY_FILTERS, gerente: ['ANGIE BUCH'] }, PERSONAS);
  assert.deepEqual(filtrado.map((r) => r.codigo), ['CTA-4']);
});

test('Cascada: seleccionar País=GUATEMALA acota las opciones de Gestor a quienes alcanzan Guatemala (incluye a Bryan por su gestor_pais_zona, no por nombre)', () => {
  const opts = buildFilterOptions(ROWS, { ...EMPTY_FILTERS, pais: ['GUATEMALA'] }, PERSONAS);
  assert.deepEqual(opts.gestor.sort(), ['BRYAN RODRIGUEZ', 'MARIA LOPEZ']);
});

test('Cascada: seleccionar País=REPUBLICA DOMINICANA excluye a Bryan (su gestor_pais_zona no llega ahí) e incluye a Angie Buch como Gerente', () => {
  const opts = buildFilterOptions(ROWS, { ...EMPTY_FILTERS, pais: ['REPUBLICA DOMINICANA'] }, PERSONAS);
  assert.ok(!opts.gestor.includes('BRYAN RODRIGUEZ'));
  assert.ok(opts.gerente.includes('ANGIE BUCH'));
});

test('Seguridad de datos: un usuario manipulando el request para pedir un Gestor FUERA del catálogo de personas en su alcance no obtiene filas por ese nombre', () => {
  // "personas" YA viene acotado al alcance del usuario conectado (ver
  // ScopeService.gestoresEnAlcance); un nombre que no está en ese catálogo no
  // tiene gestor_pais_zona con el que intersectar, así que solo puede colar
  // por coincidencia LITERAL de texto en cartera.gestor (si la hay). Aquí no
  // existe ninguna fila con ese texto exacto, así que el resultado es vacío.
  const filtrado = filterCarteraRows(ROWS, { ...EMPTY_FILTERS, gestor: ['GESTOR INVENTADO FUERA DE ALCANCE'] }, PERSONAS);
  assert.deepEqual(filtrado, []);
});
