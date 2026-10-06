'use strict';

/**
 * FORD-AVON — Gestión > Tipificaciones: GestionService.tipificacionesCuentas
 * contra el código YA COMPILADO en dist/ (nunca una reimplementación), con
 * un cliente Supabase falso en memoria (datos 100% ficticios), igual que el
 * resto de la suite.
 *
 * Cubre:
 *  - Cuentas únicas: cada código de `cuentasScoped` aparece EXACTAMENTE una
 *    vez en el resultado, sin importar cuántas filas de gestion_log tenga.
 *  - Clasificación por ÚLTIMA gestión: con varias gestion_log para el mismo
 *    código, se usa la tipificación/fecha/comentario/tipo_contacto/canal de
 *    la fila con created_at MÁS RECIENTE, nunca la primera ni una mezcla.
 *  - Cuenta sin ninguna gestión: tipificacion/fechaGestion/comentario/
 *    tipoContacto/canal quedan null — NUNCA una tipificación inventada.
 *  - Promesa: se adjunta la promesa MÁS RECIENTE de gestion_promesas (si
 *    hay varias) y sus campos quedan null si no hay ninguna.
 *  - Alcance: una fila de gestion_log/gestion_promesas de un código que NO
 *    está en `cuentasScoped` NUNCA aparece en el resultado, ni siquiera
 *    indirectamente (el join es por intersección con cuentasScoped, no un
 *    volcado de las tablas completas).
 *  - Teléfono: celular > casa > trabajo > null (y nunca se inventa una
 *    columna de WhatsApp distinta — el mismo valor se reutiliza para eso en
 *    el frontend, ver Gestion/index.tsx).
 *  - Monto de promesa: convertido a number real aunque Postgres lo entregue
 *    como string (columna numeric).
 *
 * Ejecutar (tras `npm run build`): node --test test/gestion-tipificaciones.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

/* ===== Datos ficticios de prueba (NO son datos reales de producción) ===== */
let gestionLog = [];
let gestionPromesas = [];

function tablaDe(nombre) {
  if (nombre === 'gestion_log') return gestionLog;
  if (nombre === 'gestion_promesas') return gestionPromesas;
  return [];
}

class Builder {
  constructor(tabla) { this.tabla = tabla; this.desc = false; }
  select() { return this; }
  order(_col, opts) { this.desc = !!(opts && opts.ascending === false); return this; }
  insert() { return Promise.resolve({ data: null, error: null }); } // registrarAuditoria (best-effort)
  then(resolve, reject) {
    const rows = tablaDe(this.tabla).slice().sort((a, b) => {
      const d = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return this.desc ? -d : d;
    });
    return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
  }
}
const fakeClient = { from: (t) => new Builder(t) };

const supabaseJsPath = require.resolve('@supabase/supabase-js');
const fakeModule = new Module(supabaseJsPath);
fakeModule.exports = { createClient: () => fakeClient };
fakeModule.loaded = true;
require.cache[supabaseJsPath] = fakeModule;

const distDir = path.join(__dirname, '..', 'dist');
const { tipificacionesCuentas } = require(path.join(distDir, 'services', 'GestionService.js'));

/* ============================================================================
 * Ruta GET /gestion/tipificaciones: debe exigir gestion.ver — el MISMO
 * permiso que ya protege el resto de lecturas de Gestión (dashboard/cuentas/
 * zonas-pd/pd-campanas) — nunca un permiso nuevo ni un acceso sin permiso.
 * ========================================================================== */

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}
function routeHandlerAt(router, method, routePath, index) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`No se encontró la ruta ${method.toUpperCase()} ${routePath}`);
  const handle = layer.route.stack[index] && layer.route.stack[index].handle;
  if (!handle) throw new Error(`La ruta ${method.toUpperCase()} ${routePath} no tiene middleware en la posición ${index}`);
  return handle;
}

test('GET /api/gestion/tipificaciones: exige gestion.ver — sin ese permiso, 403 y NUNCA llega al controller', async () => {
  const gestionRoutes = require(path.join(distDir, 'routes', 'gestionRoutes.js')).default;
  const gate = routeHandlerAt(gestionRoutes, 'get', '/gestion/tipificaciones', 1);

  const reqSinPermiso = { auth: { userId: 'u1', permissions: ['modulo.gestion'], role: { clave: 'gestor_sin_ver' } } };
  const resSinPermiso = mockRes();
  let nextLlamado = false;
  await gate(reqSinPermiso, resSinPermiso, () => { nextLlamado = true; });
  assert.equal(nextLlamado, false);
  assert.equal(resSinPermiso.statusCode, 403);

  const reqConPermiso = { auth: { userId: 'u2', permissions: ['gestion.ver'], role: { clave: 'supervisor' } } };
  const resConPermiso = mockRes();
  nextLlamado = false;
  await gate(reqConPermiso, resConPermiso, () => { nextLlamado = true; });
  assert.equal(nextLlamado, true);
});

test('GET /api/gestion/tipificaciones: exige requireAuth ANTES del permiso (sin req.auth, 401, nunca llega al controller)', async () => {
  const gestionRoutes = require(path.join(distDir, 'routes', 'gestionRoutes.js')).default;
  const gate = routeHandlerAt(gestionRoutes, 'get', '/gestion/tipificaciones', 1);
  const req = {}; // sin req.auth: simula que requireAuth (middleware anterior) nunca se ejecutó/pasó.
  const res = mockRes();
  let nextLlamado = false;
  await gate(req, res, () => { nextLlamado = true; });
  assert.equal(nextLlamado, false);
  assert.equal(res.statusCode, 401);
});

test.beforeEach(() => { gestionLog = []; gestionPromesas = []; });

const cuenta = (overrides = {}) => ({
  codigo: 'C-1', nombre: 'Ana López', pais: 'Guatemala', zona: 'Zona A', gestor: 'Gestor Uno',
  pd_actual: 'PD4', campania_adeuda: 'CAMPAÑA 2026', saldo_actual: 1000,
  telefono_celular: '5555-0001', telefono_casa: '', telefono_trabajo: '',
  ...overrides
});

test('cuentas únicas: un código con TRES gestiones aparece UNA sola vez en el resultado', async () => {
  gestionLog = [
    { codigo: 'C-1', tipificacion: 'NO CONTESTA', comentario: 'primera', tipo_contacto: 'Representante', canal: 'Llamada', created_at: '2026-01-01T10:00:00Z' },
    { codigo: 'C-1', tipificacion: 'RECADO', comentario: 'segunda', tipo_contacto: 'Tercero', canal: 'SMS', created_at: '2026-01-03T10:00:00Z' },
    { codigo: 'C-1', tipificacion: 'PROMESA DE PAGO', comentario: 'última', tipo_contacto: 'Representante', canal: 'WhatsApp', created_at: '2026-01-02T10:00:00Z' }
  ];
  const r = await tipificacionesCuentas([cuenta()]);
  assert.equal(r.length, 1);
  // La más reciente es 2026-01-03 (RECADO), no la última insertada ni la primera.
  assert.equal(r[0].tipificacion, 'RECADO');
  assert.equal(r[0].comentarioGestion, 'segunda');
  assert.equal(r[0].tipoContacto, 'Tercero');
  assert.equal(r[0].canal, 'SMS');
  assert.equal(r[0].fechaGestion, '2026-01-03T10:00:00Z');
});

test('cuenta SIN ninguna gestión: tipificacion/fecha/comentario/tipoContacto/canal quedan null, nunca una tipificación inventada', async () => {
  const r = await tipificacionesCuentas([cuenta({ codigo: 'C-2' })]);
  assert.equal(r.length, 1);
  assert.equal(r[0].tipificacion, null);
  assert.equal(r[0].fechaGestion, null);
  assert.equal(r[0].comentarioGestion, null);
  assert.equal(r[0].tipoContacto, null);
  assert.equal(r[0].canal, null);
});

test('promesa: se usa la MÁS RECIENTE cuando hay varias, con monto convertido a number real', async () => {
  gestionPromesas = [
    { codigo: 'C-3', fecha_promesa: '2026-01-05', monto: '100.50', moneda: 'GTQ', estado: 'INCUMPLIDA', created_at: '2026-01-01T00:00:00Z' },
    { codigo: 'C-3', fecha_promesa: '2026-01-20', monto: '250.75', moneda: 'GTQ', estado: 'PENDIENTE', created_at: '2026-01-10T00:00:00Z' }
  ];
  const r = await tipificacionesCuentas([cuenta({ codigo: 'C-3' })]);
  assert.equal(r[0].fechaPromesa, '2026-01-20');
  assert.equal(r[0].montoPromesa, 250.75);
  assert.equal(typeof r[0].montoPromesa, 'number');
  assert.equal(r[0].monedaPromesa, 'GTQ');
  assert.equal(r[0].estadoPromesa, 'PENDIENTE');
});

test('cuenta SIN ninguna promesa: fechaPromesa/montoPromesa/monedaPromesa/estadoPromesa quedan null', async () => {
  const r = await tipificacionesCuentas([cuenta({ codigo: 'C-4' })]);
  assert.equal(r[0].fechaPromesa, null);
  assert.equal(r[0].montoPromesa, null);
  assert.equal(r[0].monedaPromesa, null);
  assert.equal(r[0].estadoPromesa, null);
});

test('alcance: gestion_log/gestion_promesas de un código FUERA de cuentasScoped nunca aparece en el resultado', async () => {
  gestionLog = [{ codigo: 'FUERA-DE-ALCANCE', tipificacion: 'NEGATIVA DE PAGO', comentario: null, tipo_contacto: null, canal: null, created_at: '2026-01-01T00:00:00Z' }];
  gestionPromesas = [{ codigo: 'FUERA-DE-ALCANCE', fecha_promesa: '2026-01-01', monto: '500', moneda: 'GTQ', estado: 'PENDIENTE', created_at: '2026-01-01T00:00:00Z' }];
  const r = await tipificacionesCuentas([cuenta({ codigo: 'C-5' })]);
  assert.equal(r.length, 1);
  assert.equal(r[0].codigo, 'C-5');
  assert.equal(r.some((x) => x.codigo === 'FUERA-DE-ALCANCE'), false);
  // La cuenta SÍ en alcance tampoco recibió por error los datos de la otra.
  assert.equal(r[0].tipificacion, null);
  assert.equal(r[0].fechaPromesa, null);
});

test('teléfono: usa celular; si falta, casa; si falta, trabajo; si ninguno existe, null (y nunca inventa una columna de WhatsApp distinta)', async () => {
  const [conCelular, soloTrabajo, ninguno] = await tipificacionesCuentas([
    cuenta({ codigo: 'C-6', telefono_celular: '5555-1111', telefono_casa: '5555-2222', telefono_trabajo: '5555-3333' }),
    cuenta({ codigo: 'C-7', telefono_celular: '', telefono_casa: '', telefono_trabajo: '5555-9999' }),
    cuenta({ codigo: 'C-8', telefono_celular: '', telefono_casa: '', telefono_trabajo: '' })
  ]);
  assert.equal(conCelular.telefono, '5555-1111');
  assert.equal(soloTrabajo.telefono, '5555-9999');
  assert.equal(ninguno.telefono, null);
});

test('múltiples cuentas simultáneas: cada una recibe SU PROPIA última gestión/promesa, nunca la de otra cuenta', async () => {
  gestionLog = [
    { codigo: 'C-9', tipificacion: 'PROMESA DE PAGO', comentario: 'c9', tipo_contacto: 'Representante', canal: 'Llamada', created_at: '2026-02-01T00:00:00Z' },
    { codigo: 'C-10', tipificacion: 'ABANDONO DE LLAMADA', comentario: 'c10', tipo_contacto: 'Representante', canal: 'Llamada', created_at: '2026-02-02T00:00:00Z' }
  ];
  gestionPromesas = [{ codigo: 'C-9', fecha_promesa: '2026-02-15', monto: '300', moneda: 'GTQ', estado: 'PENDIENTE', created_at: '2026-02-01T00:00:00Z' }];
  const r = await tipificacionesCuentas([cuenta({ codigo: 'C-9' }), cuenta({ codigo: 'C-10' }), cuenta({ codigo: 'C-11' })]);
  assert.equal(r.length, 3);
  const c9 = r.find((x) => x.codigo === 'C-9');
  const c10 = r.find((x) => x.codigo === 'C-10');
  const c11 = r.find((x) => x.codigo === 'C-11');
  assert.equal(c9.tipificacion, 'PROMESA DE PAGO');
  assert.equal(c9.montoPromesa, 300);
  assert.equal(c10.tipificacion, 'ABANDONO DE LLAMADA');
  assert.equal(c10.fechaPromesa, null); // C-10 no tiene promesa propia, nunca hereda la de C-9.
  assert.equal(c11.tipificacion, null); // C-11 no tiene ninguna gestión.
});
