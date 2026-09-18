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
 * (nivel 5, activos, supervisados por daniel.monge@grupopdc.com vía
 * `supervisor_gerente_zona` vigente), PERO ninguno tiene NINGUNA fila en
 * `gerente_zona_zona` (0 relaciones vigentes, verificado con SQL). Su única
 * conexión con esas cuentas era que su nombre coincidía, por casualidad
 * operativa, con el texto libre `cartera.gerente_zona` de las cuentas que
 * en realidad pertenecen al alcance del GESTOR Angie — el patrón prohibido
 * "NOMBRE DE CUENTA → GERENTE".
 *
 * CAUSA RAÍZ #1 (corregida primero, commit f7201af): `carteraAggregations.ts`
 * (`rowMatchesPersonaFilter`/`opcionesPersonas`) aplicaba la MISMA lógica de
 * puente de texto a Gestor Y a Gerente. Para Gestor es legítimo:
 * `gestores.nombre_cartera` es un campo curado por un administrador y
 * ScopeFilter.applyScope YA lo usa como dimensión real de autorización
 * (`ctx.scope.gestores`). Para Gerente de zona NO existe ningún campo
 * equivalente, y ScopeFilter.applyScope NUNCA autoriza por nombre a un
 * Gerente (no existe `gerenteField` en `ApplyScopeOptions`) — su única
 * fuente real es `gerente_zona_zona`.
 *
 * CAUSA RAÍZ #2 (regresión introducida por la corrección #1, corregida
 * ahora): al quitar el puente de texto, `opcionesPersonas` seguía exigiendo
 * que el `paisZona` PROPIO de la persona intersectara los pares
 * País-Zona de las filas de cartera VISIBLES. Una persona con 0 relaciones
 * `gerente_zona_zona` (como los 5 Gerentes reales de este caso) JAMÁS puede
 * satisfacer esa intersección — el filtro Gerente completo quedaba en
 * "Sin opciones" para cualquier usuario cuyo alcance de Gerentes autorizados
 * fuera enteramente de personas sin relación geográfica configurada (el caso
 * exacto de daniel.monge@grupopdc.com con sus 5 Gerentes supervisados).
 *
 * CORRECCIÓN FINAL: separación de IDENTIDAD y ALCANCE GEOGRÁFICO.
 *  - IDENTIDAD = usuario + rol + relación jerárquica (`gerentesZonaEnAlcance`,
 *    vía `supervisor_gerente_zona`/`liderazgo_supervisor`, NUNCA cartera).
 *    Una persona con 0 zonas SIGUE siendo una persona Gerente autorizada.
 *  - ALCANCE GEOGRÁFICO = `gerente_zona_zona` (o `gestor_pais_zona` para
 *    Gestor). Solo se usa para ACOTAR el catálogo cuando el usuario
 *    selecciona explícitamente un filtro País y/o Zona — nunca de forma
 *    implícita contra qué filas de cartera resultan visibles.
 *  - DATOS = cartera. Nunca fuente de identidad ni de catálogo.
 * `opcionesPersonas` (`carteraAggregations.ts`) ahora recibe los valores
 * SELECCIONADOS de País/Zona (`filtrosPais`/`filtrosZona`): sin filtro
 * geográfico activo, devuelve el catálogo COMPLETO de personas en alcance
 * (identidad); con filtro activo, acota por el `paisZona` PROPIO de cada
 * persona contra los valores seleccionados. `permitirNombre` (true solo para
 * Gestor) sigue siendo un camino adicional de inclusión, nunca el único.
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

const SUP_DANIEL = 'sup-daniel-monge';

const PERSONAS_GESTOR = [
  // Angie: identidad vigente (usuario_id vinculado), 10 relaciones en la vida real; aquí solo las 6 zonas del fixture.
  // Supervisor real: daniel.monge@grupopdc.com (supervisor_gestor) — única relación real con los Gerentes de abajo.
  { nombre: 'Angie Buch', paisZona: ['133', '140', '154', '126', '146', '999'].map((z) => ({ pais: 'REPUBLICA DOMINICANA', zona: z })), supervisorIds: [SUP_DANIEL] }
];

/* Gerentes: 5 usuarios REALES con rol gerente_zona, supervisados por el
 * usuario conectado (daniel.monge@grupopdc.com en producción), pero SIN
 * ninguna relación gerente_zona_zona (paisZona: []) — el caso exacto de
 * producción — más UNO con una relación real sobre zona 999. Todos ya
 * pasaron el filtro de alcance jerárquico de `gerentesZonaEnAlcance`: están
 * en esta lista PORQUE el usuario conectado los supervisa, no por cartera. */
const PERSONAS_GERENTE = [
  { nombre: 'Cristina Garcia', paisZona: [], supervisorIds: [SUP_DANIEL] },
  { nombre: 'Ircania Guerrero', paisZona: [], supervisorIds: [SUP_DANIEL] },
  { nombre: 'Julissa Rodriguez', paisZona: [], supervisorIds: [SUP_DANIEL] },
  { nombre: 'Leydi Perez', paisZona: [], supervisorIds: [SUP_DANIEL] },
  { nombre: 'Stephanie German', paisZona: [], supervisorIds: [SUP_DANIEL] },
  { nombre: 'Gerente Con Relacion', paisZona: [{ pais: 'REPUBLICA DOMINICANA', zona: '999' }], supervisorIds: [SUP_DANIEL] },
  // Gerente real pero de OTRO Supervisor (p. ej. Oliver Santos): NUNCA debe
  // aparecer al seleccionar Angie Buch (Gestor de Daniel Monge) — prueba la
  // relación cruzada Gestor↔Gerente vía Supervisor compartido (única
  // relación real entre ambos, confirmada en la auditoría de Supabase).
  { nombre: 'Gerente De Otro Supervisor', paisZona: [{ pais: 'REPUBLICA DOMINICANA', zona: '133' }], supervisorIds: ['sup-oliver-santos'] }
];
const PERSONAS = { gestores: PERSONAS_GESTOR, gerentes: PERSONAS_GERENTE };

const NOMBRES_SIN_RELACION = ['Cristina Garcia', 'Ircania Guerrero', 'Julissa Rodriguez', 'Leydi Perez', 'Stephanie German'];

test('CORREGIDO (ya no "Sin opciones"): sin filtro geográfico activo, los 5 Gerentes reales con 0 relaciones SÍ aparecen en el catálogo — siguen siendo personas Gerente autorizadas, solo con alcance geográfico vacío', () => {
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Angie Buch'] }, PERSONAS);
  for (const nombre of NOMBRES_SIN_RELACION) {
    assert.ok(opts.gerente.includes(nombre), `"${nombre}" debe aparecer como opción de Gerente: es una persona autorizada (identidad), aunque tenga 0 relaciones gerente_zona_zona (alcance).`);
  }
});

test('Pero seleccionar uno de esos 5 nombres SIGUE devolviendo 0 filas: nunca las cuentas de otro Gestor por coincidencia de texto con cartera.gerente_zona', () => {
  for (const nombre of NOMBRES_SIN_RELACION) {
    const filtrado = filterCarteraRows(CARTERA, { ...EMPTY_FILTERS, gerente: [nombre] }, PERSONAS);
    assert.deepEqual(filtrado, [], `Seleccionar "${nombre}" debe devolver 0 cuentas: 0 relaciones gerente_zona_zona = 0 alcance geográfico.`);
  }
});

test('Con un filtro de País/Zona activo que NO coincide con su (vacío) paisZona, los 5 SÍ se acotan fuera del catálogo — el recorte geográfico usa el valor SELECCIONADO, nunca las filas visibles', () => {
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Angie Buch'], zona: ['999'] }, PERSONAS);
  for (const nombre of NOMBRES_SIN_RELACION) {
    assert.ok(!opts.gerente.includes(nombre), `Con Zona=999 seleccionada, "${nombre}" no tiene ninguna relación sobre esa zona: no debe aparecer.`);
  }
  assert.ok(opts.gerente.includes('Gerente Con Relacion'), 'El Gerente con relación real sobre zona 999 sí debe aparecer con ese filtro activo.');
});

test('filterOptions.gerente: el Gerente CON relación real sí aparece (con y sin filtro geográfico)', () => {
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Angie Buch'] }, PERSONAS);
  assert.ok(opts.gerente.includes('Gerente Con Relacion'));
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
      { nombre: 'Gerente Multizona', paisZona: [{ pais: 'REPUBLICA DOMINICANA', zona: '133' }, { pais: 'REPUBLICA DOMINICANA', zona: '146' }], supervisorIds: [SUP_DANIEL] }
    ]
  };
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Angie Buch'] }, personasConMultizona);
  assert.equal(opts.gerente.filter((n) => n === 'Gerente Multizona').length, 1);
  const filtrado = filterCarteraRows(CARTERA, { ...EMPTY_FILTERS, gerente: ['Gerente Multizona'] }, personasConMultizona);
  assert.deepEqual(filtrado.map((r) => r.codigo).sort(), ['CTA-1', 'CTA-5']);
});

test('RELACIÓN CRUZADA Gestor↔Gerente (única relación real: mismo Supervisor): seleccionar Angie Buch (Daniel Monge) NUNCA muestra un Gerente de OTRO Supervisor (Oliver Santos), aunque esté en el alcance global del catálogo', () => {
  const opts = buildFilterOptions(CARTERA, { ...EMPTY_FILTERS, gestor: ['Angie Buch'] }, PERSONAS);
  assert.ok(!opts.gerente.includes('Gerente De Otro Supervisor'), 'No comparte Supervisor con Angie Buch: no debe aparecer al seleccionarla.');
});

test('Sin ningún Gestor seleccionado, el Gerente de otro Supervisor SÍ aparece (catálogo completo del alcance, sin recorte cruzado)', () => {
  const opts = buildFilterOptions(CARTERA, EMPTY_FILTERS, PERSONAS);
  assert.ok(opts.gerente.includes('Gerente De Otro Supervisor'));
});
