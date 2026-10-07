'use strict';

/**
 * FORD-AVON — Operación > Gestión > Cartas: descarga MASIVA de cartas
 * APROBADAS (`GestionService.obtenerCartasMasivo`, detrás de POST
 * /api/gestion/cartas/descargar-lote).
 *
 * Contra el código YA COMPILADO en dist/ (nunca una reimplementación), con
 * un cliente Supabase falso en memoria. Cubre:
 *  - Solo cartas con estado APROBADA son descargables; pendiente/rechazada
 *    nunca se incluye, con el motivo real ("La carta no está aprobada.").
 *  - El alcance de CADA carta se revalida en el backend vía `gestor_id`
 *    (mismo criterio que la descarga individual: `gestorEnAlcance`) — nunca
 *    se confía en la lista de ids del cliente. Usuario global sin
 *    restricción.
 *  - Carta inexistente reporta "Carta no encontrada.", nunca aborta el lote.
 *  - La firma/autorización devuelta es EXACTAMENTE el snapshot
 *    `firma_storage_path` de cada carta (nunca la firma actual de otro
 *    supervisor) — misma fuente que `obtenerCarta` (descarga individual).
 *  - Códigos duplicados/vacíos se normalizan sin duplicar trabajo.
 *  - Rendimiento: UNA sola consulta a `gestion_cartas` para todo el lote,
 *    UNA sola resolución de logo, y la firma se resuelve una vez POR RUTA
 *    distinta (nunca una vez por carta).
 *
 * Ejecutar (tras `npm run build`): node --test test/cartas-descarga-lote.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const CONFIG_GENERAL = [{ clave: 'logo_principal', valor: 'assets/logo_principal_1.png' }];

/** Cartas ficticias (NO datos reales). c1/c2 comparten la MISMA ruta de
 *  firma (snapshot del mismo supervisor que autorizó ambas); c3 está
 *  pendiente (nunca descargable); c4 es de otro gestor (fuera del alcance
 *  del actor en el ctx escopado). */
let GESTION_CARTAS_ROWS = [];
const resetCartas = () => {
  GESTION_CARTAS_ROWS = [
    { id: 'c1', codigo: 'C1', pd: 'PD1', estado: 'APROBADA', gestor_id: 'actor-1', contenido: 'Hola «Logo» «Firma»', firma_storage_path: 'firmas/sup1_1.png' },
    { id: 'c2', codigo: 'C2', pd: 'PD4', estado: 'APROBADA', gestor_id: 'actor-1', contenido: 'Hola2 «Logo» «Firma»', firma_storage_path: 'firmas/sup1_1.png' },
    { id: 'c3', codigo: 'C3', pd: 'PD1', estado: 'PENDIENTE_APROBACION', gestor_id: 'actor-1', contenido: 'Pendiente', firma_storage_path: null },
    { id: 'c4', codigo: 'C4', pd: 'PD6', estado: 'APROBADA', gestor_id: 'actor-2', contenido: 'Otro gestor', firma_storage_path: 'firmas/sup2_1.png' }
  ];
};
resetCartas();

let gestionCartasInCalls = 0;
let firmaSignedUrlCalls = [];

function filasDe(tabla) {
  if (tabla === 'config_general') return CONFIG_GENERAL;
  if (tabla === 'gestion_cartas') return GESTION_CARTAS_ROWS;
  if (tabla === 'gestores') return []; // ctx escopado no usa gestorIds en estas pruebas
  return [];
}

function makeBuilder(tableName) {
  const state = { eq: {}, in: {} };
  const filas = () => {
    let out = filasDe(tableName);
    for (const [campo, valor] of Object.entries(state.eq)) out = out.filter((r) => r[campo] === valor);
    for (const [campo, valores] of Object.entries(state.in)) out = out.filter((r) => valores.includes(r[campo]));
    return out;
  };
  const builder = {
    select() { return builder; },
    eq(campo, valor) { state.eq[campo] = valor; return builder; },
    in(campo, valores) {
      state.in[campo] = valores;
      if (tableName === 'gestion_cartas') gestionCartasInCalls += 1;
      return builder;
    },
    order() { return builder; },
    limit() { return Promise.resolve({ data: filas(), error: null }); },
    maybeSingle() { const rows = filas(); return Promise.resolve({ data: rows[0] ?? null, error: null }); },
    then(resolve, reject) { return Promise.resolve({ data: filas(), error: null }).then(resolve, reject); }
  };
  return builder;
}

const fakeSupabaseClient = {
  from: (tableName) => makeBuilder(tableName),
  storage: {
    from: (bucket) => ({
      createSignedUrl: (assetPath) => {
        if (bucket === 'config-assets') firmaSignedUrlCalls.push(assetPath);
        return Promise.resolve({ data: { signedUrl: `https://signed.example/${bucket}/${assetPath}` }, error: null });
      }
    })
  }
};

const supabaseJsPath = require.resolve('@supabase/supabase-js');
const fakeModule = new Module(supabaseJsPath);
fakeModule.exports = { createClient: () => fakeSupabaseClient };
fakeModule.loaded = true;
require.cache[supabaseJsPath] = fakeModule;

const distDir = path.join(__dirname, '..', 'dist');
const { obtenerCartasMasivo } = require(path.join(distDir, 'services', 'GestionService.js'));

test.beforeEach(() => { resetCartas(); gestionCartasInCalls = 0; firmaSignedUrlCalls = []; });

const ctxEscopado = {
  userId: 'actor-1', role: 'gestor', permissions: [], isGlobal: false,
  scope: { paises: [], zonas: [], gestores: [], paisZonaGrant: [] },
  gestorIds: [], zonaIds: [], gerenteZonaIds: []
};
const ctxGlobal = {
  userId: 'admin-1', role: 'admin', permissions: [], isGlobal: true,
  scope: { paises: [], zonas: [], gestores: [], paisZonaGrant: [] },
  gestorIds: [], zonaIds: [], gerenteZonaIds: []
};

test('A. Solo cartas APROBADAS y dentro del alcance se devuelven descargables, con logo y firma (snapshot) resueltos', async () => {
  const r = await obtenerCartasMasivo(['c1', 'c2'], ctxEscopado);
  assert.equal(r.descargables.length, 2);
  assert.equal(r.noDescargables.length, 0);
  assert.ok(r.descargables.every((d) => d.logoUrl && d.logoUrl.includes('logo_principal_1.png')));
  assert.ok(r.descargables.every((d) => d.firmaUrl && d.firmaUrl.includes('sup1_1.png')));
});

test('B. Carta pendiente de aprobación nunca se incluye, con el motivo real', async () => {
  const r = await obtenerCartasMasivo(['c1', 'c3'], ctxEscopado);
  assert.deepEqual(r.descargables.map((d) => d.id), ['c1']);
  assert.equal(r.noDescargables.length, 1);
  assert.equal(r.noDescargables[0].codigo, 'C3');
  assert.equal(r.noDescargables[0].motivo, 'La carta no está aprobada.');
});

test('C. Carta de otro gestor fuera del alcance del actor nunca se descarga (se revalida en el backend)', async () => {
  const r = await obtenerCartasMasivo(['c1', 'c4'], ctxEscopado);
  assert.deepEqual(r.descargables.map((d) => d.id), ['c1']);
  assert.equal(r.noDescargables.length, 1);
  assert.equal(r.noDescargables[0].codigo, 'C4');
  assert.equal(r.noDescargables[0].motivo, 'Carta fuera de tu alcance.');
});

test('D. Usuario con alcance global puede descargar cualquier carta aprobada, sin restricción de alcance', async () => {
  const r = await obtenerCartasMasivo(['c1', 'c4'], ctxGlobal);
  assert.equal(r.descargables.length, 2);
  assert.equal(r.noDescargables.length, 0);
});

test('E. Carta inexistente reporta "Carta no encontrada." sin abortar el resto del lote', async () => {
  const r = await obtenerCartasMasivo(['c1', 'no-existe'], ctxEscopado);
  assert.deepEqual(r.descargables.map((d) => d.id), ['c1']);
  assert.equal(r.noDescargables.length, 1);
  assert.equal(r.noDescargables[0].id, 'no-existe');
  assert.equal(r.noDescargables[0].motivo, 'Carta no encontrada.');
});

test('F. Ids duplicados/vacíos se normalizan sin generar entradas falsas', async () => {
  const r = await obtenerCartasMasivo(['c1', 'c1', '', '  '], ctxEscopado);
  assert.equal(r.descargables.length, 1);
  assert.equal(r.noDescargables.length, 0);
});

test('G. Rendimiento: UNA sola consulta a gestion_cartas para todo el lote', async () => {
  await obtenerCartasMasivo(['c1', 'c2', 'c3', 'c4'], ctxEscopado);
  assert.equal(gestionCartasInCalls, 1);
});

test('H. Rendimiento: la firma se resuelve UNA sola vez por ruta distinta, nunca una vez por carta (c1/c2 comparten la misma ruta)', async () => {
  await obtenerCartasMasivo(['c1', 'c2'], ctxEscopado);
  assert.equal(firmaSignedUrlCalls.filter((p) => p === 'firmas/sup1_1.png').length, 1);
});

test('I. Lote vacío no genera ninguna consulta ni resultado', async () => {
  const r = await obtenerCartasMasivo([], ctxEscopado);
  assert.deepEqual(r, { descargables: [], noDescargables: [] });
  assert.equal(gestionCartasInCalls, 0);
});
