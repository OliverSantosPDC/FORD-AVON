'use strict';

/**
 * Prueba dirigida a la fuga de alcance corregida en el Centro de Inteligencia
 * (Sección 12 de la tarea): `calidad_gestion_evaluaciones` se leía filtrando
 * SOLO por el país elegido por el usuario (si elegía alguno), nunca por su
 * `ScopeContext` real — un Gestor/Supervisor restringido que no aplicaba un
 * filtro de país veía la "Nota global de calidad" y las penalizaciones de
 * TODA la operación. La corrección reutiliza `applyScope` (la misma frontera
 * de seguridad que ya protege `cartera`) sobre las columnas propias de esta
 * tabla (`gestor_nombre`, `zona`, `pais`).
 *
 * No requiere red ni Supabase: `applyScope` opera sobre filas en memoria.
 * Ejecutar (tras `npm run build`): node --test test/calidad-scope.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { applyScope } = require(path.join(__dirname, '..', 'dist', 'services', 'ScopeFilter.js'));

/** Evaluaciones de calidad 100% ficticias, de distintos gestores/países. */
const EVALUACIONES = [
  { nota: 90, pais: 'GUATEMALA', zona: '107', gestor_nombre: 'GESTOR DENTRO' },
  { nota: 40, pais: 'REPUBLICA DOMINICANA', zona: '107', gestor_nombre: 'GESTOR FUERA' },
  { nota: 10, pais: 'EL SALVADOR', zona: '208', gestor_nombre: 'GESTOR FUERA 2' }
];

const OPTS = { gestorField: 'gestor_nombre', zonaField: 'zona', paisField: 'pais' };

test('calidad_gestion_evaluaciones — un Gestor restringido NO ve evaluaciones fuera de su alcance', () => {
  const ctxGestor = { isGlobal: false, scope: { paises: [], zonas: [], gestores: ['GESTOR DENTRO'] } };
  const visibles = applyScope(EVALUACIONES, ctxGestor, OPTS);
  assert.equal(visibles.length, 1);
  assert.equal(visibles[0].gestor_nombre, 'GESTOR DENTRO');
  // Antes de la corrección, sin filtro de país explícito, este cálculo habría
  // promediado las 3 filas (incluidas 2 fuera de alcance). Ahora es solo la propia.
  const notaGlobal = visibles.reduce((a, x) => a + x.nota, 0) / visibles.length;
  assert.equal(notaGlobal, 90);
});

test('calidad_gestion_evaluaciones — scope vacío (sin relación configurada) => CERO filas, nunca "todas"', () => {
  const ctxVacio = { isGlobal: false, scope: { paises: [], zonas: [], gestores: [] } };
  assert.deepEqual(applyScope(EVALUACIONES, ctxVacio, OPTS), []);
});

test('calidad_gestion_evaluaciones — Administrador (isGlobal) sí ve todas', () => {
  const ctxGlobal = { isGlobal: true, scope: { paises: [], zonas: [], gestores: [] } };
  assert.equal(applyScope(EVALUACIONES, ctxGlobal, OPTS).length, 3);
});

test('calidad_gestion_evaluaciones — Gerente de zona (paisZonaGrant) ve por País-Zona, sin cruzar 107 Guatemala/RD', () => {
  const ctxGerente = { isGlobal: false, scope: { paises: [], zonas: [], gestores: [], paisZonaGrant: [{ pais: 'GUATEMALA', zona: '107' }] } };
  const visibles = applyScope(EVALUACIONES, ctxGerente, OPTS);
  assert.equal(visibles.length, 1);
  assert.equal(visibles[0].pais, 'GUATEMALA');
});
