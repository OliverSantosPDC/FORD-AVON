'use strict';

/**
 * FASE 1 — P1-02: pruebas mínimas y aisladas de la corrección de alcance (scope).
 *
 * No se agrega ningún framework de pruebas: se usa exclusivamente el test
 * runner incorporado en Node.js (node:test) sobre el código YA COMPILADO en
 * dist/. Se sustituye @supabase/supabase-js por un cliente falso en memoria
 * (datos ficticios, sin ninguna relación con datos reales) para poder
 * ejercitar las funciones REALES exportadas por GestionService sin red ni
 * credenciales.
 *
 * Cubre exactamente los 4 casos requeridos:
 *   CASO 1: acceso a un registro DENTRO del alcance   => PERMITIDO
 *   CASO 2: acceso a un registro FUERA del alcance    => RECHAZADO
 *   CASO 3: modificar un registro FUERA del alcance   => RECHAZADO
 *   CASO 4: eliminar un registro FUERA del alcance    => RECHAZADO
 *
 * Ejecutar (tras `npm run build`): node --test test/scope-fix.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

/* ===== Datos ficticios de prueba (NO son datos reales de producción) ===== */
const CARTERA = [
  { codigo: 'C-IN', gestor: 'gestorA', zona: 'ZONA-1', pais: 'PAIS-1' },
  { codigo: 'C-OUT', gestor: 'gestorB', zona: 'ZONA-2', pais: 'PAIS-2' }
];
const PROMESAS = [
  { id: 'PROMESA-IN', codigo: 'C-IN' },
  { id: 'PROMESA-OUT', codigo: 'C-OUT' }
];
const ADJUNTOS = [
  { id: 'ADJ-IN', codigo: 'C-IN' },
  { id: 'ADJ-OUT', codigo: 'C-OUT' }
];
const CARTAS = [
  { id: 'CARTA-IN', gestor_id: 'userA' },
  { id: 'CARTA-OUT', gestor_id: 'userB' }
];

/* ===== Cliente Supabase falso (en memoria) ===== */
function tablaPara(nombre) {
  if (nombre === 'gestion_promesas') return PROMESAS;
  if (nombre === 'gestion_adjuntos') return ADJUNTOS;
  if (nombre === 'gestion_cartas') return CARTAS;
  if (nombre === 'gestores') return [];
  return CARTERA; // tabla de cartera (SUPABASE_CARTERA_TABLE, por defecto "cartera")
}

function makeBuilder(tableName) {
  const state = { eq: {}, in: {} };
  const filas = () => {
    let out = tablaPara(tableName);
    for (const [campo, valor] of Object.entries(state.eq)) out = out.filter((r) => r[campo] === valor);
    for (const [campo, valores] of Object.entries(state.in)) out = out.filter((r) => valores.includes(r[campo]));
    return out;
  };
  const builder = {
    select() { return builder; },
    eq(campo, valor) { state.eq[campo] = valor; return builder; },
    in(campo, valores) { state.in[campo] = valores; return builder; },
    limit() { return Promise.resolve({ data: filas(), error: null }); },
    single() {
      const rows = filas();
      return rows.length ? Promise.resolve({ data: rows[0], error: null }) : Promise.resolve({ data: null, error: { message: 'no encontrado' } });
    },
    // Soporta `await builder` cuando no se llama a .limit()/.single() (p.ej. tras .in()).
    then(resolve, reject) { return Promise.resolve({ data: filas(), error: null }).then(resolve, reject); }
  };
  return builder;
}

const fakeSupabaseClient = { from: (tableName) => makeBuilder(tableName) };

/* Sustituye @supabase/supabase-js ANTES de cargar los módulos del backend. */
const supabaseJsPath = require.resolve('@supabase/supabase-js');
const fakeModule = new Module(supabaseJsPath);
fakeModule.exports = { createClient: () => fakeSupabaseClient };
fakeModule.loaded = true;
require.cache[supabaseJsPath] = fakeModule;

const distDir = path.join(__dirname, '..', 'dist');
const { infoCuenta, codigoDePromesa, codigoDeAdjunto, gestorDeCarta, gestorEnAlcance } = require(path.join(distDir, 'services', 'GestionService.js'));

/** Actor NO global, cuyo único gestor en alcance es "gestorA" (y a sí mismo, userA). */
const ctx = {
  userId: 'userA',
  role: 'gestor',
  permissions: [],
  isGlobal: false,
  scope: { paises: [], zonas: [], gestores: ['gestorA'] },
  gestorIds: [],
  zonaIds: []
};

test('CASO 1 - acceso a cuenta DENTRO del alcance => PERMITIDO', async () => {
  const row = await infoCuenta('C-IN', ctx);
  assert.notEqual(row, null);
  assert.equal(row.codigo, 'C-IN');
});

test('CASO 2 - acceso a cuenta FUERA del alcance => RECHAZADO', async () => {
  const row = await infoCuenta('C-OUT', ctx);
  assert.equal(row, null);
});

test('CASO 3 - modificar (promesa) de cuenta FUERA del alcance => RECHAZADO', async () => {
  const codigo = await codigoDePromesa('PROMESA-OUT');
  assert.equal(codigo, 'C-OUT');
  const row = await infoCuenta(codigo, ctx); // esto es lo que consulta el controlador antes de permitir el PATCH
  assert.equal(row, null);
});

test('CASO 3 (control) - modificar (promesa) de cuenta DENTRO del alcance => PERMITIDO', async () => {
  const codigo = await codigoDePromesa('PROMESA-IN');
  const row = await infoCuenta(codigo, ctx);
  assert.notEqual(row, null);
});

test('CASO 4 - eliminar (adjunto) de cuenta FUERA del alcance => RECHAZADO', async () => {
  const codigo = await codigoDeAdjunto('ADJ-OUT');
  assert.equal(codigo, 'C-OUT');
  const row = await infoCuenta(codigo, ctx); // esto es lo que consulta el controlador antes de permitir el DELETE
  assert.equal(row, null);
});

test('CASO 4 (control) - eliminar (adjunto) de cuenta DENTRO del alcance => PERMITIDO', async () => {
  const codigo = await codigoDeAdjunto('ADJ-IN');
  const row = await infoCuenta(codigo, ctx);
  assert.notEqual(row, null);
});

test('Extra - aprobar/rechazar carta de gestor_id FUERA del alcance => RECHAZADO', async () => {
  const carta = await gestorDeCarta('CARTA-OUT');
  assert.notEqual(carta, null);
  const permitido = await gestorEnAlcance(carta.gestorId, ctx);
  assert.equal(permitido, false);
});

test('Extra - aprobar/rechazar carta de gestor_id DENTRO del alcance => PERMITIDO', async () => {
  const carta = await gestorDeCarta('CARTA-IN');
  const permitido = await gestorEnAlcance(carta.gestorId, ctx);
  assert.equal(permitido, true);
});
