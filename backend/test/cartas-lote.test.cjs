'use strict';

/**
 * FORD-AVON — Operación > Gestión > Cuentas: generación MASIVA de cartas
 * (`GestionService.crearCartasMasivo`, detrás de POST /api/gestion/cartas/lote).
 *
 * Contra el código YA COMPILADO en dist/ (nunca una reimplementación), con
 * un cliente Supabase falso en memoria (mismo patrón que
 * cartas-pd-plantillas.test.cjs). Cubre:
 *  - Genera exactamente las cuentas seleccionadas que SÍ tienen plantilla
 *    disponible para su PD actual — reutiliza el MISMO motor que la
 *    generación individual (crearCarta/previsualizarCarta), nunca duplicado.
 *  - Nunca aborta el lote completo por una cuenta inválida: reporta, por
 *    cada cuenta no generada, el motivo REAL (nunca inventado) — "sin
 *    plantilla", "plantilla desactivada", "fuera de tu alcance".
 *  - El alcance de CADA cuenta se revalida en el backend (applyScope),
 *    nunca se confía en la selección del cliente.
 *  - Usuario global: sin restricción de alcance (igual que el resto del
 *    sistema).
 *  - Códigos duplicados/vacíos en la selección se normalizan sin generar
 *    entradas falsas ni cartas repetidas.
 *  - Una sola consulta a `cartera` para TODO el lote (nunca una por cuenta).
 *
 * Ejecutar (tras `npm run build`): node --test test/cartas-lote.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const CONFIG_GENERAL = [
  { clave: 'nombre_empresa', valor: 'Avon Centroamérica' },
  { clave: 'whatsapp_cobros', valor: '+502 1234 5678' },
  { clave: 'plazo_pd7_dias', valor: '5' },
  { clave: 'direccion_pais_guatemala', valor: 'Ciudad de Guatemala' },
  { clave: 'direccion_pais_honduras', valor: 'Tegucigalpa' },
  { clave: 'logo_principal', valor: 'assets/logo_principal_1.png' },
  { clave: 'firma', valor: 'assets/firma_1.png' }
];
const CONFIG_PLANTILLAS = [
  { clave: 'carta_pd1', asunto: 'Recordatorio', activo: true, version: 1, updated_at: null, updated_by: null, contenido: '«Nombre_Mayusculas» «Saldo»' },
  { clave: 'carta_pd4', asunto: 'Aviso', activo: true, version: 1, updated_at: null, updated_by: null, contenido: 'PD4: «Nombre_Mayusculas» «Saldo»' },
  { clave: 'carta_pd6', asunto: 'Urgente', activo: false, version: 1, updated_at: null, updated_by: null, contenido: 'PD6: «Nombre_Mayusculas» «Saldo»' }
  // carta_pd0 no existe -> PD0 nunca tiene carta disponible (regla de negocio).
];

/** Cartera ficticia (NO datos reales): C1/C2 en el alcance del actor
 *  (Guatemala/Zona A), C5 fuera de ese alcance (Honduras/Zona B). */
const CARTERA_ROWS = [
  { codigo: 'C1', pais: 'Guatemala', zona: 'Zona A', nombre: 'Cliente Uno', saldo_actual: 100, campania_adeuda: 'CAMP1', pd_actual: 'PD1' },
  { codigo: 'C2', pais: 'Guatemala', zona: 'Zona A', nombre: 'Cliente Dos', saldo_actual: 200, campania_adeuda: 'CAMP1', pd_actual: 'PD4' },
  { codigo: 'C3', pais: 'Guatemala', zona: 'Zona A', nombre: 'Cliente Tres', saldo_actual: 300, campania_adeuda: 'CAMP1', pd_actual: 'PD0' },
  { codigo: 'C4', pais: 'Guatemala', zona: 'Zona A', nombre: 'Cliente Cuatro', saldo_actual: 400, campania_adeuda: 'CAMP1', pd_actual: 'PD6' },
  { codigo: 'C5', pais: 'Honduras', zona: 'Zona B', nombre: 'Cliente Cinco', saldo_actual: 500, campania_adeuda: 'CAMP1', pd_actual: 'PD1' }
];

let gestionCartasRows = [];
let nextCartaId = 1;
let carteraInCalls = 0;

function filasDe(tabla) {
  if (tabla === 'config_general') return CONFIG_GENERAL;
  if (tabla === 'config_plantillas') return CONFIG_PLANTILLAS;
  if (tabla === 'gestion_cartas') return gestionCartasRows;
  if (tabla === 'cartera') return CARTERA_ROWS;
  return [];
}

function makeBuilder(tableName) {
  const state = { eq: {}, in: {}, insertRow: null };
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
      if (tableName === 'cartera') carteraInCalls += 1;
      return builder;
    },
    order() { return builder; },
    insert(row) {
      state.insertRow = { id: String(nextCartaId++), created_at: new Date().toISOString(), ...row };
      if (tableName === 'gestion_cartas') gestionCartasRows.push(state.insertRow);
      return builder;
    },
    limit() { return Promise.resolve({ data: filas(), error: null }); },
    single() {
      if (state.insertRow) return Promise.resolve({ data: state.insertRow, error: null });
      const rows = filas();
      return rows.length ? Promise.resolve({ data: rows[0], error: null }) : Promise.resolve({ data: null, error: { message: 'no encontrado' } });
    },
    maybeSingle() {
      const rows = filas();
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    then(resolve, reject) { return Promise.resolve({ data: filas(), error: null }).then(resolve, reject); }
  };
  return builder;
}

const fakeSupabaseClient = {
  from: (tableName) => makeBuilder(tableName),
  storage: { from: (bucket) => ({ createSignedUrl: (p) => Promise.resolve({ data: { signedUrl: `https://signed.example/${bucket}/${p}` }, error: null }) }) }
};

const supabaseJsPath = require.resolve('@supabase/supabase-js');
const fakeModule = new Module(supabaseJsPath);
fakeModule.exports = { createClient: () => fakeSupabaseClient };
fakeModule.loaded = true;
require.cache[supabaseJsPath] = fakeModule;

const distDir = path.join(__dirname, '..', 'dist');
const { crearCartasMasivo } = require(path.join(distDir, 'services', 'GestionService.js'));

test.beforeEach(() => { gestionCartasRows = []; nextCartaId = 1; carteraInCalls = 0; });

const ctxEscopado = {
  userId: 'actor-1', role: 'gestor', permissions: [], isGlobal: false,
  scope: { paises: [], zonas: [], gestores: [], paisZonaGrant: [{ pais: 'Guatemala', zona: 'Zona A' }] },
  gestorIds: [], zonaIds: [], gerenteZonaIds: []
};
const ctxGlobal = {
  userId: 'admin-1', role: 'admin', permissions: [], isGlobal: true,
  scope: { paises: [], zonas: [], gestores: [], paisZonaGrant: [] },
  gestorIds: [], zonaIds: [], gerenteZonaIds: []
};

test('A. Genera cartas para todas las cuentas seleccionadas con plantilla disponible (PD1/PD4), reutilizando el mismo motor que la generación individual', async () => {
  const r = await crearCartasMasivo(['C1', 'C2'], {}, null, 'actor-1', ctxEscopado);
  assert.equal(r.generadas.length, 2);
  assert.equal(r.noGeneradas.length, 0);
  assert.deepEqual(r.generadas.map((g) => g.codigo).sort(), ['C1', 'C2']);
  assert.equal(gestionCartasRows.length, 2);
  assert.ok(gestionCartasRows.every((c) => c.gestor_id === 'actor-1'));
});

test('B. No aborta el lote por cuentas inválidas: PD sin plantilla y plantilla desactivada reportan el motivo REAL, el resto se genera igual', async () => {
  const r = await crearCartasMasivo(['C1', 'C3', 'C4'], {}, null, 'actor-1', ctxEscopado);
  assert.deepEqual(r.generadas.map((g) => g.codigo), ['C1']);
  assert.equal(r.noGeneradas.length, 2);
  const c3 = r.noGeneradas.find((n) => n.codigo === 'C3');
  const c4 = r.noGeneradas.find((n) => n.codigo === 'C4');
  assert.match(c3.motivo, /No hay plantilla de carta disponible/);
  assert.match(c4.motivo, /está desactivada en Configuración/);
  assert.equal(gestionCartasRows.length, 1);
});

test('C. Cuenta fuera del alcance del actor nunca se genera (se revalida en el backend, no se confía en la selección del cliente) y reporta el motivo real', async () => {
  const r = await crearCartasMasivo(['C1', 'C5'], {}, null, 'actor-1', ctxEscopado);
  assert.deepEqual(r.generadas.map((g) => g.codigo), ['C1']);
  assert.equal(r.noGeneradas.length, 1);
  assert.equal(r.noGeneradas[0].codigo, 'C5');
  assert.equal(r.noGeneradas[0].motivo, 'Cuenta fuera de tu alcance.');
  assert.equal(gestionCartasRows.length, 1);
});

test('D. Usuario con alcance global puede generar cualquier cuenta del lote, sin restricción de alcance', async () => {
  const r = await crearCartasMasivo(['C1', 'C5'], {}, null, 'admin-1', ctxGlobal);
  assert.equal(r.generadas.length, 2);
  assert.equal(r.noGeneradas.length, 0);
});

test('E. Códigos duplicados en la selección se procesan una sola vez (nunca cartas repetidas)', async () => {
  const r = await crearCartasMasivo(['C1', 'C1', 'C1'], {}, null, 'actor-1', ctxEscopado);
  assert.equal(r.generadas.length, 1);
  assert.equal(gestionCartasRows.length, 1);
});

test('F. Códigos vacíos/en blanco se ignoran sin generar entradas falsas', async () => {
  const r = await crearCartasMasivo(['', '   '], {}, null, 'actor-1', ctxEscopado);
  assert.equal(r.generadas.length, 0);
  assert.equal(r.noGeneradas.length, 0);
});

test('G. Rendimiento: UNA sola consulta a cartera para todo el lote (nunca una por cuenta)', async () => {
  await crearCartasMasivo(['C1', 'C2', 'C3', 'C4'], {}, null, 'actor-1', ctxEscopado);
  assert.equal(carteraInCalls, 1);
});

test('H. El comentario se guarda igual que en la generación individual (mismo motor, mismo campo)', async () => {
  const r = await crearCartasMasivo(['C1'], {}, 'comentario de lote', 'actor-1', ctxEscopado);
  assert.equal(gestionCartasRows[0].comentario, 'comentario de lote');
  assert.equal(gestionCartasRows[0].estado, 'PENDIENTE_APROBACION');
  assert.ok(r.generadas[0].id);
});
