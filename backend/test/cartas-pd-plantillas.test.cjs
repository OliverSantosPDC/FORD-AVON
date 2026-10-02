'use strict';

/**
 * FORD-AVON — Plantillas de cartas de cobro por PD: pruebas aisladas del
 * motor de renderizado (CartaPdService) y del gate de autorización
 * (GestionService.obtenerCarta/crearCarta), contra el código YA COMPILADO
 * en dist/ (nunca una reimplementación). Sin red ni credenciales: se
 * sustituye @supabase/supabase-js por un cliente falso en memoria, igual
 * que el resto de la suite (ver scope-fix.test.cjs).
 *
 * Cubre:
 *  - normalizarPd/claveParaPd: PD0 sin carta, PD1-PD3 comparten plantilla,
 *    PD4-PD7 cada una la suya, variantes de texto reconocidas.
 *  - formatearFechaEspanol/anioDeCampania: formato exacto pedido.
 *  - renderizarCarta: sustitución de variables, «Logo»/«Firma» NUNCA
 *    sustituidos, saldo SIEMPRE en moneda local (nunca afectado por la
 *    tasa), variables faltantes reportadas (nunca inventadas), plazo
 *    faltante solo relevante en PD7.
 *  - crearCarta: PD0 (u otro sin plantilla) rechazado; el cliente nunca
 *    elige la plantilla, siempre la decide el PD actual de la cuenta.
 *  - obtenerCarta: logoUrl/firmaUrl/descargable SOLO con estado APROBADA
 *    (el gate real de autorización — nunca un flag del cliente).
 *
 * Ejecutar (tras `npm run build`): node --test test/cartas-pd-plantillas.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

/* ===== Datos ficticios de prueba (NO son datos reales de producción) ===== */
const CONFIG_GENERAL = [
  { clave: 'nombre_empresa', valor: 'Avon Centroamérica' },
  { clave: 'whatsapp_cobros', valor: '+502 1234 5678' },
  { clave: 'plazo_pd7_dias', valor: '5' },
  { clave: 'direccion_pais_guatemala', valor: 'Guatemala, Ciudad de Guatemala' },
  { clave: 'logo_principal', valor: 'assets/logo_principal_1.png' },
  { clave: 'firma', valor: 'assets/firma_1.png' }
];
const CONFIG_PLANTILLAS = [
  { clave: 'carta_pd1', contenido: 'Hola «Nombre_Mayusculas», código «Codigo», zona «Zona», saldo «Saldo». «Localizacion» «Fecha_emision» «Campania» «Anio_Campania» «Contacto_Gestor» «Razon_Social» «WhatsApp» «Logo» «Firma»' },
  { clave: 'carta_pd4', contenido: 'PD4: «Nombre_Mayusculas» «Saldo»' },
  { clave: 'carta_pd7', contenido: 'PD7: «Nombre_Mayusculas» «Saldo» plazo de «Plazo_dias» días' }
  // carta_pd5 / carta_pd6 deliberadamente SIN fila -> simulan "sin contenido todavía".
];
let gestionCartasRows = [];
let nextCartaId = 1;

/* ===== Cliente Supabase falso (en memoria) ===== */
function filasDe(tabla) {
  if (tabla === 'config_general') return CONFIG_GENERAL;
  if (tabla === 'config_plantillas') return CONFIG_PLANTILLAS;
  if (tabla === 'gestion_cartas') return gestionCartasRows;
  return [];
}

function makeBuilder(tableName) {
  const state = { eq: {}, in: {}, insertRow: null, selectCols: null };
  const filas = () => {
    let out = filasDe(tableName);
    for (const [campo, valor] of Object.entries(state.eq)) out = out.filter((r) => r[campo] === valor);
    for (const [campo, valores] of Object.entries(state.in)) out = out.filter((r) => valores.includes(r[campo]));
    return out;
  };
  const builder = {
    select(cols) { state.selectCols = cols; return builder; },
    eq(campo, valor) { state.eq[campo] = valor; return builder; },
    in(campo, valores) { state.in[campo] = valores; return builder; },
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
  storage: {
    from: (bucket) => ({
      createSignedUrl: (assetPath) => Promise.resolve({ data: { signedUrl: `https://signed.example/${bucket}/${assetPath}` }, error: null })
    })
  }
};

/* Sustituye @supabase/supabase-js ANTES de cargar los módulos del backend. */
const supabaseJsPath = require.resolve('@supabase/supabase-js');
const fakeModule = new Module(supabaseJsPath);
fakeModule.exports = { createClient: () => fakeSupabaseClient };
fakeModule.loaded = true;
require.cache[supabaseJsPath] = fakeModule;

const distDir = path.join(__dirname, '..', 'dist');
const {
  normalizarPd, claveParaPd, formatearFechaEspanol, anioDeCampania, renderizarCarta, fixtureParaBanda
} = require(path.join(distDir, 'services', 'CartaPdService.js'));
const { crearCarta, obtenerCarta } = require(path.join(distDir, 'services', 'GestionService.js'));

test.beforeEach(() => { gestionCartasRows = []; nextCartaId = 1; });

/* ============================================================================
 * 1) normalizarPd / claveParaPd
 * ========================================================================== */

test('normalizarPd reconoce variantes de texto y rechaza valores inválidos', () => {
  assert.equal(normalizarPd('PD4'), 'PD4');
  assert.equal(normalizarPd('pd4'), 'PD4');
  assert.equal(normalizarPd('PD 4'), 'PD4');
  assert.equal(normalizarPd('PD4+'), 'PD4');
  assert.equal(normalizarPd('PD0'), 'PD0');
  assert.equal(normalizarPd('PD8'), null);
  assert.equal(normalizarPd(''), null);
  assert.equal(normalizarPd(null), null);
  assert.equal(normalizarPd(undefined), null);
});

test('claveParaPd: PD0 sin carta, PD1-PD3 comparten plantilla, PD4-PD7 cada una la suya', () => {
  assert.equal(claveParaPd('PD0'), null);
  assert.equal(claveParaPd('PD1'), 'carta_pd1');
  assert.equal(claveParaPd('PD2'), 'carta_pd1');
  assert.equal(claveParaPd('PD3'), 'carta_pd1');
  assert.equal(claveParaPd('PD4'), 'carta_pd4');
  assert.equal(claveParaPd('PD5'), 'carta_pd5');
  assert.equal(claveParaPd('PD6'), 'carta_pd6');
  assert.equal(claveParaPd('PD7'), 'carta_pd7');
  assert.equal(claveParaPd('no-es-un-pd'), null);
});

/* ============================================================================
 * 2) Formato de fecha / año de campaña
 * ========================================================================== */

test('formatearFechaEspanol produce el formato EXACTO pedido: "01 de Octubre de 2026"', () => {
  assert.equal(formatearFechaEspanol(new Date(2026, 9, 1)), '01 de Octubre de 2026');
  assert.equal(formatearFechaEspanol(new Date(2026, 0, 5)), '05 de Enero de 2026');
});

test('anioDeCampania extrae el año si corresponde; cadena vacía si no hay año reconocible', () => {
  assert.equal(anioDeCampania('CAMPAÑA 10-2026'), '2026');
  assert.equal(anioDeCampania('CAMPAÑA SIN AÑO'), '');
  assert.equal(anioDeCampania(null), '');
});

/* ============================================================================
 * 3) renderizarCarta: PD0 sin carta, sustitución de variables, Logo/Firma
 *    NUNCA sustituidos, saldo SIEMPRE local, variables faltantes reportadas
 * ========================================================================== */

test('renderizarCarta: PD0 no tiene carta disponible (ningún contenido, ninguna variable faltante inventada)', async () => {
  const r = await renderizarCarta(fixtureParaBanda('PD0'), {});
  assert.equal(r.pd, 'PD0');
  assert.equal(r.disponible, false);
  assert.equal(r.plantillaClave, null);
  assert.equal(r.contenido, null);
});

test('renderizarCarta: PD5/PD6 sin contenido cargado todavía -> disponible false, variablesFaltantes=["plantilla"]', async () => {
  const r = await renderizarCarta(fixtureParaBanda('PD5'), {});
  assert.equal(r.disponible, false);
  assert.equal(r.plantillaClave, 'carta_pd5');
  assert.deepEqual(r.variablesFaltantes, ['plantilla']);
});

test('renderizarCarta: PD1 con configuración completa sustituye variables correctamente y preserva «Logo»/«Firma» literales', async () => {
  const datos = { pais: 'Guatemala', nombre: 'maría lópez', codigo: 'C-001', zona: 'Zona Centro', saldoActual: 1234.5, campaniaAdeuda: 'CAMPAÑA 10-2026', pdActual: 'PD1' };
  const r = await renderizarCarta(datos, {});
  assert.equal(r.disponible, true);
  assert.equal(r.plantillaClave, 'carta_pd1');
  assert.match(r.contenido, /MARÍA LÓPEZ/);
  assert.match(r.contenido, /C-001/);
  assert.match(r.contenido, /Zona Centro/);
  assert.match(r.contenido, /Q 1,234\.50/);
  assert.match(r.contenido, /Guatemala, Guatemala, Ciudad de Guatemala/);
  assert.match(r.contenido, /2026/);
  assert.match(r.contenido, /Avon Centroamérica/);
  assert.match(r.contenido, /\+502 1234 5678/);
  // «Logo» y «Firma» quedan como anclas literales: el renderer nunca las toca.
  assert.match(r.contenido, /«Logo»/);
  assert.match(r.contenido, /«Firma»/);
  // Sin fuente de contacto del Gestor: se reporta, nunca se inventa.
  assert.deepEqual(r.variablesFaltantes, ['contacto_gestor']);
});

test('renderizarCarta: PD1/PD2/PD3 generan EXACTAMENTE la misma plantilla (carta_pd1)', async () => {
  const base = { pais: 'Guatemala', nombre: 'Ana', codigo: 'C-002', zona: 'Z', saldoActual: 500, campaniaAdeuda: 'CAMPAÑA 1-2026' };
  const [r1, r2, r3] = await Promise.all([
    renderizarCarta({ ...base, pdActual: 'PD1' }, {}),
    renderizarCarta({ ...base, pdActual: 'PD2' }, {}),
    renderizarCarta({ ...base, pdActual: 'PD3' }, {})
  ]);
  assert.equal(r1.plantillaClave, 'carta_pd1');
  assert.equal(r2.plantillaClave, 'carta_pd1');
  assert.equal(r3.plantillaClave, 'carta_pd1');
  assert.equal(r1.contenido, r2.contenido);
  assert.equal(r2.contenido, r3.contenido);
});

test('renderizarCarta: el saldo SIEMPRE es saldo_actual en moneda local, sin importar la tasa de conversión (nunca saldo_actual_usd)', async () => {
  const datos = { pais: 'Guatemala', nombre: 'Ana', codigo: 'C-003', zona: 'Z', saldoActual: 1000, campaniaAdeuda: 'CAMPAÑA 1-2026', pdActual: 'PD4' };
  const r1 = await renderizarCarta(datos, { GTQ: 7.8 });
  const r2 = await renderizarCarta(datos, { GTQ: 99999 });
  assert.match(r1.contenido, /\$1,000\.00|Q 1,000\.00/);
  // Cambiar drásticamente la tasa NO cambia el texto: el saldo mostrado es
  // siempre el saldo local directo, nunca convertido con esta tasa.
  assert.equal(r1.contenido, r2.contenido);
});

test('renderizarCarta: PD7 reporta "plazo_pd7_dias" como faltante si no está configurado; PD1-PD6 nunca lo exigen', async () => {
  const originalPlazo = CONFIG_GENERAL.find((r) => r.clave === 'plazo_pd7_dias');
  const valorOriginal = originalPlazo.valor;
  originalPlazo.valor = '';
  try {
    const r7 = await renderizarCarta(fixtureParaBanda('PD7'), {});
    assert.ok(r7.variablesFaltantes.includes('plazo_pd7_dias'));
    const r4 = await renderizarCarta(fixtureParaBanda('PD4'), {});
    assert.ok(!r4.variablesFaltantes.includes('plazo_pd7_dias'));
  } finally {
    originalPlazo.valor = valorOriginal;
  }
});

test('renderizarCarta: PD7 con plazo configurado sustituye «Plazo_dias» en el texto', async () => {
  const r = await renderizarCarta(fixtureParaBanda('PD7'), {});
  assert.equal(r.disponible, true);
  assert.match(r.contenido, /plazo de 5 días/);
});

test('renderizarCarta: dirección de país no configurada se marca pendiente, nunca se inventa', async () => {
  const datos = { pais: 'Honduras', nombre: 'Ana', codigo: 'C-004', zona: 'Z', saldoActual: 100, campaniaAdeuda: 'CAMPAÑA 1-2026', pdActual: 'PD1' };
  const r = await renderizarCarta(datos, {});
  assert.ok(r.variablesFaltantes.includes('direccion_pais_honduras'));
  assert.match(r.contenido, /pendiente de configurar/);
});

/* ============================================================================
 * 4) crearCarta: el cliente NUNCA elige la plantilla; PD sin carta rechazado
 * ========================================================================== */

test('crearCarta: PD0 (sin plantilla) es rechazado con error explícito, no se inserta ninguna fila', async () => {
  const row = { codigo: 'C-100', pais: 'Guatemala', nombre: 'Ana', zona: 'Z', saldo_actual: 100, campania_adeuda: 'CAMPAÑA 1-2026', pd_actual: 'PD0' };
  await assert.rejects(() => crearCarta(row, {}, null, 'gestor-1'), /No hay plantilla de carta disponible/);
  assert.equal(gestionCartasRows.length, 0);
});

test('crearCarta: PD1 genera y guarda la carta con el PD/plantilla que decide el backend (snapshot del contenido ya renderizado)', async () => {
  const row = { codigo: 'C-101', pais: 'Guatemala', nombre: 'Ana López', zona: 'Zona A', saldo_actual: 250.75, campania_adeuda: 'CAMPAÑA 2-2026', pd_actual: 'PD2' };
  const { id } = await crearCarta(row, {}, 'comentario de prueba', 'gestor-1');
  assert.ok(id);
  assert.equal(gestionCartasRows.length, 1);
  const guardada = gestionCartasRows[0];
  assert.equal(guardada.pd, 'PD2');
  assert.equal(guardada.plantilla_clave, 'carta_pd1'); // PD2 comparte la plantilla de PD1-PD3
  assert.equal(guardada.estado, 'PENDIENTE_APROBACION');
  assert.equal(guardada.gestor_id, 'gestor-1');
  assert.match(guardada.contenido, /ANA LÓPEZ/);
});

/* ============================================================================
 * 5) obtenerCarta: logo/firma/descargable SOLO con estado === 'APROBADA'
 * ========================================================================== */

test('obtenerCarta: carta PENDIENTE_APROBACION nunca expone logo/firma ni permite descarga', async () => {
  gestionCartasRows.push({ id: '1', codigo: 'C-1', pd: 'PD4', estado: 'PENDIENTE_APROBACION', contenido: 'x' });
  const r = await obtenerCarta('1');
  assert.equal(r.logoUrl, null);
  assert.equal(r.firmaUrl, null);
  assert.equal(r.descargable, false);
});

test('obtenerCarta: carta RECHAZADA tampoco expone logo/firma ni permite descarga', async () => {
  gestionCartasRows.push({ id: '2', codigo: 'C-2', pd: 'PD4', estado: 'RECHAZADA', contenido: 'x' });
  const r = await obtenerCarta('2');
  assert.equal(r.logoUrl, null);
  assert.equal(r.firmaUrl, null);
  assert.equal(r.descargable, false);
});

test('obtenerCarta: carta APROBADA expone logo/firma (vía el mismo urlAsset ya existente) y queda descargable', async () => {
  gestionCartasRows.push({ id: '3', codigo: 'C-3', pd: 'PD4', estado: 'APROBADA', contenido: 'x' });
  const r = await obtenerCarta('3');
  assert.equal(r.descargable, true);
  assert.match(r.logoUrl, /logo_principal/);
  assert.match(r.firmaUrl, /firma/);
});

test('obtenerCarta: una carta inexistente devuelve null (sin lanzar) para que el controller responda 404, nunca filtra nada', async () => {
  const r = await obtenerCarta('no-existe');
  assert.equal(r, null);
});
