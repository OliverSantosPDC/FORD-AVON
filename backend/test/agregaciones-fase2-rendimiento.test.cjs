'use strict';

/**
 * FASE 2 — optimización de tiempos de carga: pruebas de exactitud para las 3
 * agregaciones que reemplazan el fetch aparte a /api/cartera que hacían
 * DashboardZonaSector/ResumenPdTable/PDMigrationChart en el navegador
 * (carteraAggregations.ts: calculateZonaSectorPorPais, calculateResumenPdInicial,
 * calculatePdMigration). Los resultados deben ser matemáticamente idénticos a
 * los que antes calculaba el cliente sobre la cartera completa.
 *
 * Ejecutar (tras `npm run build`): node --test test/agregaciones-fase2-rendimiento.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const distDir = path.join(__dirname, '..', 'dist');
const { calculateZonaSectorPorPais, calculateResumenPdInicial, calculatePdMigration } = require(path.join(distDir, 'utils', 'carteraAggregations.js'));

// CORRECCIÓN DE CONVERSIÓN MONETARIA: las 3 funciones ahora derivan el "USD"
// SIEMPRE de saldo_inicial/saldo_actual (local) ÷ tasa vigente del país de la
// fila — nunca de las columnas congeladas saldo_inicial_usd/saldo_actual_usd
// (eliminadas como fuente). Estas pruebas usan TASAS = { USD: 1, GTQ: 1,
// HNL: 1, DOP: 1 } (conversión 1:1 para todas las monedas involucradas en los
// fixtures) para que los valores locales de las filas sean numéricamente
// idénticos a los "_usd" que el test original verificaba — así se comprueba
// la MISMA aritmética de agrupación sin reescribir cada aserción a mano.
// Una prueba aparte, más abajo, verifica explícitamente una tasa real
// distinta de 1 (el caso que realmente causaba el bug).
const TASAS = { USD: 1, GTQ: 1, HNL: 1, DOP: 1 };

const ROWS = [
  { pais: 'GUATEMALA', zona: '107', sector: 'RETAIL', pd_inicial: 'PD1', pd_actual: 'PD2', saldo_inicial: 100, saldo_actual: 80 },
  { pais: 'GUATEMALA', zona: '107', sector: 'CORP', pd_inicial: 'PD1', pd_actual: 'PD1', saldo_inicial: 50, saldo_actual: 50 },
  { pais: 'GUATEMALA', zona: '108', sector: 'RETAIL', pd_inicial: 'PD2', pd_actual: 'PD3', saldo_inicial: 200, saldo_actual: 150 },
  { pais: 'REPUBLICA DOMINICANA', zona: '107', sector: 'RETAIL', pd_inicial: 'PD1', pd_actual: 'PD0', saldo_inicial: 300, saldo_actual: 0 },
  // Fila con saldo_inicial <= 0: PDMigrationChart la ignoraba (saldo <= 0), no debe aportar a la matriz.
  { pais: 'HONDURAS', zona: '110', sector: 'RETAIL', pd_inicial: 'PD3', pd_actual: 'PD3', saldo_inicial: 0, saldo_actual: 0 },
  // Fila sin PD reconocible: no debe aportar a resumenPdInicial ni a pdMigration.
  { pais: 'HONDURAS', zona: '110', sector: 'RETAIL', pd_inicial: 'SIN DATO', pd_actual: 'PD1', saldo_inicial: 40, saldo_actual: 30 }
];

test('calculateZonaSectorPorPais: agrupa País -> Zona -> Sector sin límite de filas ni cruce de zona homónima entre países', () => {
  const result = calculateZonaSectorPorPais(ROWS, TASAS);
  const gt = result.find((p) => p.paisNombre === 'Guatemala');
  const rd = result.find((p) => p.paisNombre.includes('Dominicana'));
  assert.ok(gt, 'Guatemala debe aparecer');
  assert.ok(rd, 'República Dominicana debe aparecer');

  const gtZona107 = gt.zonas.find((z) => z.zona === '107');
  assert.equal(gtZona107.saldoActualUsd, 130); // 80 + 50
  assert.equal(gtZona107.cuentas, 2);
  assert.equal(gtZona107.sectores.length, 2);
  const retail = gtZona107.sectores.find((s) => s.sector === 'RETAIL');
  assert.equal(retail.saldoActualUsd, 80);

  // Zona "107" existe en GUATEMALA y REPUBLICA DOMINICANA: nunca deben mezclarse.
  const rdZona107 = rd.zonas.find((z) => z.zona === '107');
  assert.equal(rdZona107.saldoActualUsd, 0);
  assert.notEqual(rdZona107.saldoActualUsd, gtZona107.saldoActualUsd);
});

test('calculateResumenPdInicial: agrupa por PD INICIAL (no PD actual), usando saldo_inicial/saldo_actual ÷ tasa', () => {
  const result = calculateResumenPdInicial(ROWS, TASAS);
  const pd1 = result.find((r) => r.pd === 'PD1');
  // Filas con pd_inicial=PD1: (100,80) + (50,50) + (300,0) = asignado 450, actual 130.
  assert.equal(pd1.cuentas, 3);
  assert.equal(pd1.saldoAsignadoUsd, 450);
  assert.equal(pd1.saldoActualUsd, 130);
  assert.equal(pd1.recuperadoUsd, 320);

  const pd2 = result.find((r) => r.pd === 'PD2');
  assert.equal(pd2.cuentas, 1);
  assert.equal(pd2.saldoAsignadoUsd, 200);

  // La fila con pd_inicial "SIN DATO" no debe aportar a ningún bucket PD0-PD7.
  const totalCuentas = result.reduce((sum, r) => sum + r.cuentas, 0);
  assert.equal(totalCuentas, 5); // 6 filas totales - 1 sin PD reconocible
});

test('calculatePdMigration: matriz PD Inicial -> PD Actual usando saldo_inicial ÷ tasa, ignora saldo <= 0 y PD no reconocible', () => {
  const result = calculatePdMigration(ROWS, TASAS);
  const pd1pd2 = result.find((r) => r.pdInicial === 'PD1' && r.pdActual === 'PD2');
  assert.equal(pd1pd2.saldoInicialUsd, 100);
  assert.equal(pd1pd2.cuentas, 1);

  const pd1pd1 = result.find((r) => r.pdInicial === 'PD1' && r.pdActual === 'PD1');
  assert.equal(pd1pd1.saldoInicialUsd, 50);

  // La fila HONDURAS/PD3->PD3 con saldo_inicial_usd=0 no debe aparecer (saldo <= 0).
  assert.ok(!result.some((r) => r.pdInicial === 'PD3' && r.pdActual === 'PD3'));
  // La fila con pd_inicial "SIN DATO" no debe aparecer.
  assert.ok(!result.some((r) => r.pdActual === 'PD1' && r.saldoInicialUsd === 40));

  // Ordenado por PD0..PD7 en ambos ejes.
  const order = ['PD0', 'PD1', 'PD2', 'PD3', 'PD4', 'PD5', 'PD6', 'PD7'];
  for (let i = 1; i < result.length; i += 1) {
    const prevKey = order.indexOf(result[i - 1].pdInicial) * 10 + order.indexOf(result[i - 1].pdActual);
    const curKey = order.indexOf(result[i].pdInicial) * 10 + order.indexOf(result[i].pdActual);
    assert.ok(prevKey <= curKey, 'la matriz debe venir ordenada por PD Inicial y luego PD Actual');
  }
});

/* ============================================================================
 * CORRECCIÓN DE CONVERSIÓN MONETARIA — regresión con tasa REAL (≠ 1), el caso
 * que efectivamente causaba el bug reportado (cuenta 1168250, Guatemala):
 * el "USD" debe derivarse de saldo_inicial/saldo_actual ÷ tasa vigente del
 * PAÍS de la fila, nunca de una columna _usd congelada.
 * ========================================================================== */
test('calculateResumenPdInicial: con tasa GTQ real (7.644720), el USD deriva de saldo_inicial ÷ tasa — nunca de una columna _usd', () => {
  // Cuenta real auditada: codigo=1168250, GUATEMALA, saldo_inicial=1021.89 GTQ.
  // tasa GTQ VIGENTE=7.644720 (config_tasas_conversion, Supabase real) ⇒
  // USD correcto = 1021.89 / 7.644720 = 133.67265... (redondea a 133.67).
  //
  // PRUEBA DE LA CAUSA RAÍZ: la columna congelada `saldo_inicial_usd` de esa
  // misma fila en Supabase vale 133.64 (calculada con la tasa vigente EN EL
  // MOMENTO DE LA IMPORTACIÓN, distinta de la actual). Si el sistema (como
  // hacía antes de esta corrección) usara 133.64 como "USD" y el frontend lo
  // reconvirtiera multiplicando por la tasa VIGENTE (7.644720) para mostrar
  // de vuelta en GTQ, el resultado sería 133.64 × 7.644720 = 1021.64 —
  // EXACTAMENTE el valor incorrecto reportado en la auditoría (el dashboard
  // mostraba 1021.64 en vez del saldo real 1021.89). Este test confirma que
  // la función corregida NUNCA reproduce ese número.
  const rows = [{ pais: 'GUATEMALA', pd_inicial: 'PD1', saldo_inicial: 1021.89, saldo_actual: 1021.89 }];
  const tasas = { USD: 1, GTQ: 7.64472 };
  const result = calculateResumenPdInicial(rows, tasas);
  const pd1 = result.find((r) => r.pd === 'PD1');
  assert.ok(Math.abs(pd1.saldoAsignadoUsd - 133.67265249740996) < 0.001, `esperado ≈133.6727, obtuvo ${pd1.saldoAsignadoUsd}`);
  assert.ok(Math.abs(pd1.saldoActualUsd - 133.67265249740996) < 0.001, `esperado ≈133.6727, obtuvo ${pd1.saldoActualUsd}`);
  // Reconvertido de vuelta a GTQ con la MISMA tasa vigente (arquitectura real:
  // backend → USD ÷ tasa_propia, frontend → USD × tasa_seleccionada), el
  // resultado debe coincidir con el saldo local original — nunca con 1021.64.
  const reconvertidoGtq = pd1.saldoAsignadoUsd * tasas.GTQ;
  assert.ok(Math.abs(reconvertidoGtq - 1021.89) < 0.001, `esperado 1021.89 (saldo local real), obtuvo ${reconvertidoGtq}`);
  assert.notEqual(Number(reconvertidoGtq.toFixed(2)), 1021.64, 'nunca debe reproducir el valor incorrecto reportado en la auditoría (1021.64)');
});

test('El Salvador y Panamá (moneda local = USD): el "USD" es exactamente igual al local, sin dividir por ninguna tasa', () => {
  const rows = [
    { pais: 'EL SALVADOR', pd_inicial: 'PD1', saldo_inicial: 500, saldo_actual: 500 },
    { pais: 'PANAMA', pd_inicial: 'PD1', saldo_inicial: 300, saldo_actual: 300 }
  ];
  const tasas = { USD: 1, GTQ: 7.64472 };
  const result = calculateResumenPdInicial(rows, tasas);
  const pd1 = result.find((r) => r.pd === 'PD1');
  assert.equal(pd1.saldoAsignadoUsd, 800); // 500 + 300, sin conversión (ambos ya en USD)
});

test('Una tasa ausente/inválida (0, negativa o no configurada) NO corrompe el dato: se conserva el valor local sin dividir', () => {
  const rows = [{ pais: 'GUATEMALA', pd_inicial: 'PD1', saldo_inicial: 1000, saldo_actual: 1000 }];
  for (const tasas of [{ USD: 1 }, { USD: 1, GTQ: 0 }, { USD: 1, GTQ: -5 }]) {
    const result = calculateResumenPdInicial(rows, tasas);
    const pd1 = result.find((r) => r.pd === 'PD1');
    assert.equal(pd1.saldoAsignadoUsd, 1000, `tasas=${JSON.stringify(tasas)}: debe conservar el valor local, nunca dividir por una tasa inválida`);
  }
});
