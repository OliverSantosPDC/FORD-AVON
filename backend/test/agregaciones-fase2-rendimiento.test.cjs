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

const ROWS = [
  { pais: 'GUATEMALA', zona: '107', sector: 'RETAIL', pd_inicial: 'PD1', pd_actual: 'PD2', saldo_inicial_usd: 100, saldo_actual_usd: 80 },
  { pais: 'GUATEMALA', zona: '107', sector: 'CORP', pd_inicial: 'PD1', pd_actual: 'PD1', saldo_inicial_usd: 50, saldo_actual_usd: 50 },
  { pais: 'GUATEMALA', zona: '108', sector: 'RETAIL', pd_inicial: 'PD2', pd_actual: 'PD3', saldo_inicial_usd: 200, saldo_actual_usd: 150 },
  { pais: 'REPUBLICA DOMINICANA', zona: '107', sector: 'RETAIL', pd_inicial: 'PD1', pd_actual: 'PD0', saldo_inicial_usd: 300, saldo_actual_usd: 0 },
  // Fila con saldo_inicial_usd <= 0: PDMigrationChart la ignoraba (saldo <= 0), no debe aportar a la matriz.
  { pais: 'HONDURAS', zona: '110', sector: 'RETAIL', pd_inicial: 'PD3', pd_actual: 'PD3', saldo_inicial_usd: 0, saldo_actual_usd: 0 },
  // Fila sin PD reconocible: no debe aportar a resumenPdInicial ni a pdMigration.
  { pais: 'HONDURAS', zona: '110', sector: 'RETAIL', pd_inicial: 'SIN DATO', pd_actual: 'PD1', saldo_inicial_usd: 40, saldo_actual_usd: 30 }
];

test('calculateZonaSectorPorPais: agrupa País -> Zona -> Sector sin límite de filas ni cruce de zona homónima entre países', () => {
  const result = calculateZonaSectorPorPais(ROWS);
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

test('calculateResumenPdInicial: agrupa por PD INICIAL (no PD actual), usando saldo_inicial_usd/saldo_actual_usd', () => {
  const result = calculateResumenPdInicial(ROWS);
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

test('calculatePdMigration: matriz PD Inicial -> PD Actual usando saldo_inicial_usd, ignora saldo <= 0 y PD no reconocible', () => {
  const result = calculatePdMigration(ROWS);
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
