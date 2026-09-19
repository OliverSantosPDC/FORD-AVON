'use strict';

/**
 * PRUEBA DE NO DUPLICACIÓN (Sección 16/20/21 de la auditoría de filtros
 * comunes): Centro de Inteligencia debe usar EXACTAMENTE la misma función
 * `buildFilterOptions` (carteraAggregations.ts) que Dashboard/Control
 * Operativo/Gestión — nunca una reimplementación paralela.
 *
 * `construirFilterOptionsCentro` (InteligenciaService.ts) delega en
 * `buildFilterOptions` para las 6 dimensiones comunes (País/Zona/Gestor/
 * Gerente/PD/Campaña) y solo añade Sector/Riesgo (exclusivos de Centro, sin
 * UI ni columna en el filtro común). Esta prueba llama a ambas funciones con
 * las MISMAS filas/filtros/personas y exige resultados IDÉNTICOS para las 6
 * dimensiones comunes — si algún día alguien reintroduce una cascada propia
 * en Centro, esta prueba falla.
 *
 * Ejecutar (tras `npm run build`): node --test test/filtro-comun-centro-inteligencia.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const distDir = path.join(__dirname, '..', 'dist');
const { buildFilterOptions, filterCarteraRows } = require(path.join(distDir, 'utils', 'carteraAggregations.js'));
const { construirFilterOptionsCentro } = require(path.join(distDir, 'services', 'InteligenciaService.js'));

// Dos Gestores, dos Gerentes, dos países — mismo patrón geográfico usado en
// producción (Alejandra Diaz/Angie Buch/Jasmin Ramirez): un Gestor con
// País-Zona propio, un Gerente compatible en la MISMA zona, y una zona con
// el MISMO código numérico en el otro país (para probar que la cascada
// compara SIEMPRE País+Zona, nunca zona sola).
const personas = {
  gestores: [
    { nombre: 'GESTOR PANAMA', paisZona: [{ pais: 'PANAMA', zona: '614' }], supervisorIds: ['sup-1'] },
    { nombre: 'GESTOR HONDURAS', paisZona: [{ pais: 'HONDURAS', zona: '614' }], supervisorIds: ['sup-2'] }
  ],
  gerentes: [
    { nombre: 'GERENTE PANAMA', paisZona: [{ pais: 'PANAMA', zona: '614' }], supervisorIds: ['sup-1'] },
    { nombre: 'GERENTE HONDURAS', paisZona: [{ pais: 'HONDURAS', zona: '614' }], supervisorIds: ['sup-2'] }
  ]
};

const rows = [
  { pais: 'PANAMA', zona: '614', pd_actual: 'PD1', campania_adeuda: 'CAMP-A', sector: 'RETAIL', riesgo: 'BAJO' },
  { pais: 'HONDURAS', zona: '614', pd_actual: 'PD2', campania_adeuda: 'CAMP-B', sector: 'CORP', riesgo: 'ALTO' }
];

const DIMENSIONES_COMUNES = ['pais', 'zona', 'gestor', 'gerente', 'pd', 'campania'];

test('Centro de Inteligencia (sin filtros): las 6 dimensiones comunes son IDÉNTICAS a buildFilterOptions', () => {
  const filtrosVacios = { pais: [], zona: [], gestor: [], gerente: [], pd: [], campania: [] };
  const esperado = buildFilterOptions(rows, filtrosVacios, personas);
  const real = construirFilterOptionsCentro(rows, {}, personas);
  for (const dim of DIMENSIONES_COMUNES) {
    assert.deepEqual(real[dim], esperado[dim], `Centro.${dim} debe ser idéntico a Dashboard.${dim}`);
  }
});

test('Centro de Inteligencia (Gestor=GESTOR PANAMA): Gerente se acota por geografía, igual que Dashboard', () => {
  const filtrosCentro = { gestor: ['GESTOR PANAMA'] };
  const filtrosMulti = { pais: [], zona: [], gestor: ['GESTOR PANAMA'], gerente: [], pd: [], campania: [] };
  const esperado = buildFilterOptions(rows, filtrosMulti, personas);
  const real = construirFilterOptionsCentro(rows, filtrosCentro, personas);
  assert.deepEqual(real.gerente, esperado.gerente);
  assert.deepEqual(real.gerente, ['GERENTE PANAMA']);
  assert.ok(!real.gerente.includes('GERENTE HONDURAS'), 'Zona 614 de HONDURAS nunca debe cruzarse con la zona 614 de PANAMA');
});

test('Centro de Inteligencia: el filtrado de filas (filterCarteraRows) respeta el País-Zona real del Gestor seleccionado', () => {
  const filtrosMulti = { pais: [], zona: [], gestor: ['GESTOR PANAMA'], gerente: [], pd: [], campania: [] };
  const filas = filterCarteraRows(rows, filtrosMulti, personas);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].pais, 'PANAMA');
});

test('Centro de Inteligencia expone Gerente y Campaña (antes ausentes/hardcodeados a [])', () => {
  const filterOptions = construirFilterOptionsCentro(rows, {}, personas);
  assert.deepEqual(filterOptions.gerente.slice().sort(), ['GERENTE HONDURAS', 'GERENTE PANAMA']);
  assert.deepEqual(filterOptions.campania.slice().sort(), ['CAMP-A', 'CAMP-B']);
});

test('Centro de Inteligencia conserva Sector/Riesgo (exclusivos, no forman parte del filtro común)', () => {
  const filterOptions = construirFilterOptionsCentro(rows, {}, personas);
  assert.deepEqual(filterOptions.sector.slice().sort(), ['CORP', 'RETAIL']);
  assert.deepEqual(filterOptions.riesgo.slice().sort(), ['ALTO', 'BAJO']);
});
