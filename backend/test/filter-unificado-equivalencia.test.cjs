'use strict';

/**
 * FASE 3 — P0-B: `filterCarteraRowsAndBuildFilterOptions` unifica en UN solo
 * recorrido de `rows` lo que antes hacían por separado `filterCarteraRows`
 * (1 pasada) + `buildFilterOptions` (hasta 4 pasadas más, una por dimensión
 * país/zona/pd/campaña) — ver la optimización de tiempos de carga del
 * Dashboard/Centro de Inteligencia en `carteraAggregations.ts`.
 *
 * Esta prueba NO vuelve a explicar la lógica de negocio (ya cubierta por
 * dashboard-filtro-personas.test.cjs, inteligencia-filtros-cascada.test.cjs,
 * etc.): verifica EXCLUSIVAMENTE que la función unificada produce, para
 * distintos escenarios (sin filtros, un filtro, varios filtros combinados,
 * personas sin País-Zona propio, País-Zona compartido, filtros que no
 * coinciden con ninguna fila), un resultado IDÉNTICO — filas filtradas y
 * las 6 opciones de filtro — al de llamar `filterCarteraRows` y
 * `buildFilterOptions` por separado con los mismos argumentos.
 *
 * Ejecutar (tras `npm run build`): node --test test/filter-unificado-equivalencia.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  filterCarteraRows,
  buildFilterOptions,
  filterCarteraRowsAndBuildFilterOptions
} = require(path.join(__dirname, '..', 'dist', 'utils', 'carteraAggregations'));

const CARTERA = [
  { codigo: 'C1', pais: 'REPUBLICA DOMINICANA', zona: 'ZONA-1', sector: 'A', pd_actual: 'PD1', campania_adeuda: 'CAMP-A' },
  { codigo: 'C2', pais: 'REPUBLICA DOMINICANA', zona: 'ZONA-2', sector: 'B', pd_actual: 'PD2', campania_adeuda: 'CAMP-B' },
  { codigo: 'C3', pais: 'PANAMA', zona: 'ZONA-3', sector: 'A', pd_actual: 'PD1', campania_adeuda: 'CAMP-A' },
  { codigo: 'C4', pais: 'PANAMA', zona: 'ZONA-4', sector: 'C', pd_actual: 'PD3', campania_adeuda: 'CAMP-C' },
  { codigo: 'C5', pais: 'GUATEMALA', zona: 'ZONA-5', sector: 'B', pd_actual: 'PD2', campania_adeuda: 'CAMP-B' },
  // Fila sin país/zona (caso límite: rowMatchesPersonaFilter debe rechazarla si hay filtro de persona).
  { codigo: 'C6', pais: '', zona: '', sector: 'A', pd_actual: 'PD1', campania_adeuda: 'CAMP-A' }
];

const PERSONAS = {
  gestores: [
    { nombre: 'Gestor Multi-Zona', paisZona: [{ pais: 'REPUBLICA DOMINICANA', zona: 'ZONA-1' }, { pais: 'PANAMA', zona: 'ZONA-3' }], supervisorIds: ['sup1'] },
    { nombre: 'Gestor Sin Zona', paisZona: [], supervisorIds: ['sup1'] },
    { nombre: 'Gestor Guatemala', paisZona: [{ pais: 'GUATEMALA', zona: 'ZONA-5' }], supervisorIds: ['sup2'] }
  ],
  gerentes: [
    { nombre: 'Gerente RD', paisZona: [{ pais: 'REPUBLICA DOMINICANA', zona: 'ZONA-2' }], supervisorIds: ['sup1'] },
    { nombre: 'Gerente Panama Multi', paisZona: [{ pais: 'PANAMA', zona: 'ZONA-3' }, { pais: 'PANAMA', zona: 'ZONA-4' }], supervisorIds: ['sup1'] },
    { nombre: 'Gerente Sin Zona', paisZona: [], supervisorIds: ['sup2'] }
  ]
};

const vacio = () => ({ pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] });

const ESCENARIOS = [
  { nombre: 'sin ningún filtro', filters: vacio() },
  { nombre: 'solo país', filters: { ...vacio(), pais: ['PANAMA'] } },
  { nombre: 'solo zona', filters: { ...vacio(), zona: ['ZONA-1'] } },
  { nombre: 'solo PD', filters: { ...vacio(), pd: ['PD2'] } },
  { nombre: 'solo campaña', filters: { ...vacio(), campania: ['CAMP-A'] } },
  { nombre: 'solo gestor multi-zona', filters: { ...vacio(), gestor: ['Gestor Multi-Zona'] } },
  { nombre: 'solo gerente multi-zona', filters: { ...vacio(), gerente: ['Gerente Panama Multi'] } },
  { nombre: 'gestor sin País-Zona propio (0 filas esperadas)', filters: { ...vacio(), gestor: ['Gestor Sin Zona'] } },
  { nombre: 'gestor + gerente combinados', filters: { ...vacio(), gestor: ['Gestor Multi-Zona'], gerente: ['Gerente Panama Multi'] } },
  { nombre: 'país + zona + pd + campaña combinados', filters: { pais: ['REPUBLICA DOMINICANA'], zona: [], gestor: [], gerente: [], pd: ['PD1'], campania: ['CAMP-A'] } },
  { nombre: 'filtro que no coincide con ninguna fila', filters: { ...vacio(), pais: ['HONDURAS'] } },
  { nombre: 'todas las dimensiones a la vez', filters: { pais: ['PANAMA'], zona: ['ZONA-3', 'ZONA-4'], gestor: ['Gestor Multi-Zona'], gerente: ['Gerente Panama Multi'], pd: ['PD1', 'PD3'], campania: ['CAMP-A', 'CAMP-C'] } }
];

test('filterCarteraRowsAndBuildFilterOptions produce EXACTAMENTE el mismo resultado que filterCarteraRows + buildFilterOptions por separado', () => {
  for (const { nombre, filters } of ESCENARIOS) {
    const esperadoFiltered = filterCarteraRows(CARTERA, filters, PERSONAS);
    const esperadoOptions = buildFilterOptions(CARTERA, filters, PERSONAS);

    const { filtered, filterOptions } = filterCarteraRowsAndBuildFilterOptions(CARTERA, filters, PERSONAS);

    assert.deepStrictEqual(filtered, esperadoFiltered, `filas filtradas distintas en escenario: ${nombre}`);
    assert.deepStrictEqual(filterOptions, esperadoOptions, `opciones de filtro distintas en escenario: ${nombre}`);
  }
});

test('filterCarteraRowsAndBuildFilterOptions: cartera vacía no rompe y devuelve todo vacío', () => {
  const { filtered, filterOptions } = filterCarteraRowsAndBuildFilterOptions([], vacio(), PERSONAS);
  assert.deepStrictEqual(filtered, []);
  assert.deepStrictEqual(filterOptions.pais, []);
  assert.deepStrictEqual(filterOptions.zona, []);
  assert.deepStrictEqual(filterOptions.pd, []);
  assert.deepStrictEqual(filterOptions.campania, []);
});

test('filterCarteraRowsAndBuildFilterOptions: personas vacías (sin gestores/gerentes) no rompe', () => {
  const personasVacias = { gestores: [], gerentes: [] };
  const { filtered, filterOptions } = filterCarteraRowsAndBuildFilterOptions(CARTERA, vacio(), personasVacias);
  assert.strictEqual(filtered.length, CARTERA.length);
  assert.deepStrictEqual(filterOptions.gestor, []);
  assert.deepStrictEqual(filterOptions.gerente, []);
});
