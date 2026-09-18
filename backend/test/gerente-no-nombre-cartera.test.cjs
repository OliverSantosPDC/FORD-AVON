'use strict';

/**
 * CORRECCIÓN DEFINITIVA — el filtro "Gerente" tomaba nombres del campo
 * operativo `cartera.gerente_zona`, no de `gerente_zona_zona`.
 *
 * Reproduce el bug REAL confirmado en producción (Supabase, project
 * vuazzailuqgbjnnbdtrg): con Gestor = Angie Buch (usuario_id
 * 1b1406dd-91cc-4807-a296-ec345d8efc37, sus cuentas llevan
 * `cartera.gestor = 'ANGIE DYANA BUCH DÍAZ'`), el filtro Gerente mostraba:
 *   Cristina Garcia, Ircania Guerrero, Julissa Rodriguez, Leydi Perez,
 *   Stephanie German
 * — los CINCO son usuarios reales con `roles.clave = 'gerente_zona'`
 * (nivel 5, activos), PERO ninguno tiene NINGUNA fila en
 * `gerente_zona_zona` (0 relaciones vigentes, verificado con SQL). Su única
 * conexión con esas cuentas es que su nombre coincide, por casualidad
 * operativa, con el texto libre `cartera.gerente_zona` de las cuentas que
 * en realidad pertenecen al alcance del GESTOR Angie — exactamente el
 * patrón prohibido "NOMBRE DE CUENTA → GERENTE".
 *
 * CAUSA RAÍZ: `carteraAggregations.ts` (`rowMatchesPersonaFilter`/
 * `opcionesPersonas`) aplicaba la MISMA lógica de puente de texto a Gestor
 * Y a Gerente. Para Gestor es legítimo: `gestores.nombre_cartera` es un
 * campo curado por un administrador y ScopeFilter.applyScope YA lo usa
 * como dimensión real de autorización (`ctx.scope.gestores`). Para
 * Gerente de zona NO existe ningún campo equivalente, y
 * ScopeFilter.applyScope NUNCA autoriza por nombre a un Gerente (no existe
 * `gerenteField` en `ApplyScopeOptions`) — su única fuente real es
 * `gerente_zona_zona`. Al reutilizar el mismo puente para Gerente, un
 * usuario real con el rol correcto pero CERO relaciones configuradas
 * aparecía igual como opción seleccionable, y seleccionarlo devolvía
 * cuentas que jamás le pertenecen.
 *
 * CORRECCIÓN: `rowMatchesPersonaFilter`/`opcionesPersonas` reciben ahora un
 * parámetro `permitirNombre` — `true` solo para Gestor, `false` siempre
 * para Gerente. El catálogo/selección de Gerente depende EXCLUSIVAMENTE de
 * `gerente_zona_zona` (vía `gerentesZonaEnAlcance`).
 *
 * Ejercita el código YA COMPILADO en dist/ (funciones puras, sin Supabase).
 *
 * Ejecutar (tras `npm run build`): node --test test/gerente-no-nombre-cartera.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const distDir = path.join(__dirname, '..', 'dist');
const { buildFilterOptions, filterCarteraRows } = require(path.join(distDir, 'utils', 'carteraAggregations.js'));

const EMPTY_FILTERS = { pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] };

/* Cartera ficticia replicando la forma exacta del caso real: las cuentas de
 * Angie (Gestor) llevan en su campo `gerente_zona` (texto operativo) el
 * nombre de personas reales del sistema — pero SOLO "Gerente Con Relacion"
 * tiene una relación gerente_zona_zona configurada para esa zona; los otros
 * 5 nombres (como Cristina/Ircania/Julissa/Leydi/Stephanie en producción)
 * son usuarios reales SIN ninguna relación. */
const CARTERA = [
  { codigo: 'CTA-1', gestor: 'ANGIE DYANA BUCH DÍAZ', gerente_zona: 'Cristina Garcia', pais: 'REPUBLICA DOMINICANA', zona: '133' },
  { codigo: 'CTA-2', gestor: 'ANGIE DYANA BUCH DÍAZ', gerente_zona: 'Ircania Guerrero', pais: 'REPUBLICA DOMINICANA', zona: '140' },
  { codigo: 'CTA-3', gestor: 'ANGIE DYANA BUCH DÍAZ', gerente_zona: 'Julissa Rodriguez', pais: 'REPUBLICA DOMINICANA', zona: '154' },
  { codigo: 'CTA-4', gestor: 'ANGIE DYANA BUCH DÍAZ', gerente_zona: 'Leydi Perez', pais: 'REPUBLICA DOMINICANA', zona: '126' },
  { codigo: 'CTA-5', gestor: 'ANGIE DYANA BUCH DÍAZ', gerente_zona: 'Stephanie German', pais: 'REPUBLICA DOMINICANA', zona: '146' },
  // Una cuenta cuya zona SÍ está cubierta por un Gerente con relación real.
  { codigo: 'CTA-6', gestor: 'ANGIE DYANA BUCH DÍAZ', gerente_zona: 'Gerente Con Relacion', pais: 'REPUBLICA DOMINICANA', zona: '999' }
];

const PERSONAS_GESTOR = [
  // Angie: identidad vigente (usuario_id vinculado), 10 relaciones en la vida real; aquí solo las 6 zonas del fixture.
  { nombre: 'Angie Buch', paisZona: ['133', '140', '154', '126', '146', '999'].map((z) => ({ pais: 'REPUBLICA DOMINICANA', zona: z })) }
];

/* Gerentes: 5 usuarios REALES con rol gerente_zona pero SIN ninguna relación
 * gerente_zona_zona (paisZona: []) — el caso exacto de producción — más UNO
 * con una relación real sobre zona 999. */
const PERSONAS_GERENTE = [
  { nombre: 'Cristina Garcia', paisZona: [] },
  { nombre: 'Ircania Guerrero', paisZona: [] },
  { nombre: 'Julissa Rodriguez', paisZona: [] },
  { nombre: 'Leydi Perez', paisZona: [] },
  { nombre: 'Stephanie German', paisZona: [] },
  { nombre: 'Gerente Con Relacion', paisZona: [{ pais: 'REPUBLICA DOMINICANA', zona: '999' }] }
];
const PERSONAS = { gestores: PERSONAS_GESTOR, gerentes: PERSONAS_GERENTE };

test('filterOptions.gerente: NINGUNO de los 5 usuarios reales sin relación gerente_zona_zona aparece, aunque su nombre coincida con cartera.gerente_zona de las cuentas de Angie', () => {
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Angie Buch'] }, PERSONAS);
  for (const nombre of ['Cristina Garcia', 'Ircania Guerrero', 'Julissa Rodriguez', 'Leydi Perez', 'Stephanie German']) {
    assert.ok(!opts.gerente.includes(nombre), `"${nombre}" no debe aparecer como opción de Gerente: 0 relaciones gerente_zona_zona.`);
  }
});

test('filterOptions.gerente: el Gerente CON relación real sí aparece', () => {
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Angie Buch'] }, PERSONAS);
  assert.ok(opts.gerente.includes('Gerente Con Relacion'));
});

test('Seleccionar un nombre sin relación gerente_zona_zona como Gerente devuelve 0 filas (nunca las cuentas de otro Gestor por coincidencia de texto)', () => {
  const filtrado = filterCarteraRows(CARTERA, { ...EMPTY_FILTERS, gerente: ['Cristina Garcia'] }, PERSONAS);
  assert.deepEqual(filtrado, []);
});

test('Seleccionar el Gerente CON relación real filtra correctamente a su zona', () => {
  const filtrado = filterCarteraRows(CARTERA, { ...EMPTY_FILTERS, gerente: ['Gerente Con Relacion'] }, PERSONAS);
  assert.deepEqual(filtrado.map((r) => r.codigo), ['CTA-6']);
});

test('Gestor SÍ sigue usando coincidencia de nombre (comportamiento legítimo, sin cambios): Angie aparece y filtra por su gestor_pais_zona', () => {
  const opts = buildFilterOptions(CARTERA, EMPTY_FILTERS, PERSONAS);
  assert.ok(opts.gestor.includes('Angie Buch'));
  const filtrado = filterCarteraRows(CARTERA, { ...EMPTY_FILTERS, gestor: ['Angie Buch'] }, PERSONAS);
  assert.equal(filtrado.length, 6);
});

test('Persona sin usuario (no está en PERSONAS_GERENTE en absoluto) nunca aparece como opción de Gerente aunque exista en cartera.gerente_zona', () => {
  const carteraConExtra = [...CARTERA, { codigo: 'CTA-7', gestor: 'ANGIE DYANA BUCH DÍAZ', gerente_zona: 'Persona Inventada Sin Usuario', pais: 'REPUBLICA DOMINICANA', zona: '133' }];
  const opts = buildFilterOptions(carteraConExtra, { ...EMPTY_FILTERS, gestor: ['Angie Buch'] }, PERSONAS);
  assert.ok(!opts.gerente.includes('Persona Inventada Sin Usuario'));
});

test('Gerente con MÚLTIPLES zonas aparece una sola vez y conserva todas sus relaciones', () => {
  const personasConMultizona = {
    gestores: PERSONAS_GESTOR,
    gerentes: [
      ...PERSONAS_GERENTE,
      { nombre: 'Gerente Multizona', paisZona: [{ pais: 'REPUBLICA DOMINICANA', zona: '133' }, { pais: 'REPUBLICA DOMINICANA', zona: '146' }] }
    ]
  };
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Angie Buch'] }, personasConMultizona);
  assert.equal(opts.gerente.filter((n) => n === 'Gerente Multizona').length, 1);
  const filtrado = filterCarteraRows(CARTERA, { ...EMPTY_FILTERS, gerente: ['Gerente Multizona'] }, personasConMultizona);
  assert.deepEqual(filtrado.map((r) => r.codigo).sort(), ['CTA-1', 'CTA-5']);
});
