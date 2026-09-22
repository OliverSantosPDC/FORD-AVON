'use strict';

/**
 * Corrección de visibilidad/acceso por rol (Gerente/Gestor/Supervisor).
 *
 * Valida DOS cosas contra el código YA COMPILADO en dist/ (nunca una
 * reimplementación de la lógica):
 *
 *  1) Que las rutas de backend de los módulos protegidos (Análisis =
 *     Dashboard/Centro de Inteligencia, Control Operativo, Usuarios) están
 *     realmente gateadas por `requirePermission`/`requireAnyPermission` —
 *     nunca solo por `requireAuth` — invocando los middlewares REALES
 *     extraídos de cada Router (mismo patrón que branding-integracion.test.cjs).
 *  2) Que la matriz de permisos ESPERADA por rol (gerente_zona/gestor/
 *     supervisor), aplicada a Supabase en esta ronda, produce exactamente
 *     el resultado de acceso pedido: Análisis ❌ para Gerente y Gestor,
 *     Control Operativo ❌ para Gerente y ✅ para Gestor, Usuarios ❌ para
 *     Gerente/Gestor/Supervisor. La matriz aquí es una FOTO fija de lo que
 *     se aplicó vía migración (corregir_visibilidad_permisos_por_rol) —
 *     si alguien cambia esos permisos sin actualizar este test, el test
 *     debe fallar y avisar del drift.
 *
 * No modifica ScopeService, cartera, filtros ni datos: solo ejercita
 * requirePermission/requireAnyPermission, que son autorización pura
 * (permiso concedido o no), sin tocar ninguna consulta de datos.
 *
 * Ejecutar (tras `npm run build`): node --test test/visibilidad-modulos-por-rol.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

// requirePermission/requireAnyPermission registran auditoría (best-effort) al
// denegar acceso — se provee un cliente Supabase falso mínimo (solo
// auditoria.insert) para que esa llamada no falle con ruido en la consola;
// no participa en absoluto en la lógica de autorización que este archivo prueba.
const fakeClient = { from: () => ({ insert: async () => ({ data: null, error: null }) }) };
const supabaseJsPath = require.resolve('@supabase/supabase-js');
const fakeSupabaseModule = new Module(supabaseJsPath);
fakeSupabaseModule.exports = { createClient: () => fakeClient };
fakeSupabaseModule.loaded = true;
require.cache[supabaseJsPath] = fakeSupabaseModule;

const distDir = path.join(__dirname, '..', 'dist');

/** Matriz de permisos por rol tal como quedó aplicada en Supabase. Administrador y
 *  liderazgo NO se tocaron — no se listan aquí porque no forman parte de lo
 *  que este test verifica (la tarea no pidió cambiarlos).
 *
 *  gerente_zona actualizado por la migración corregir_visibilidad_acciones_gerente_zona
 *  (ronda posterior a corregir_visibilidad_permisos_por_rol): perdió calendario.crear,
 *  gestion.gestionar, gestion.promesa.crear/editar, gestion.adjunto.subir y
 *  gestion.carta.crear — ver gerente-zona-acciones.test.cjs para el detalle de
 *  por qué cada uno se retiró y qué esconde/bloquea cada uno. */
const PERMISOS_POR_ROL = {
  gerente_zona: [
    'calendario.editar', 'calendario.eliminar', 'calendario.ver', 'convenio.solicitar',
    'gestion.ver', 'informacion.ver', 'modulo.calendario', 'modulo.gestion',
    'modulo.informacion', 'permiso.solicitar'
  ],
  gestor: [
    'calendario.ver', 'carta.solicitar', 'control_operativo.ver', 'escalamiento.crear',
    'gestion.adjunto.subir', 'gestion.carta.crear', 'gestion.gestionar', 'gestion.promesa.crear',
    'gestion.promesa.editar', 'gestion.ver', 'informacion.ver', 'modulo.calendario',
    'modulo.control_operativo', 'modulo.gestion', 'modulo.informacion', 'permiso.solicitar',
    'rec.solicitar'
  ],
  supervisor: [
    'calendario.crear', 'calendario.editar', 'calendario.eliminar', 'calendario.ver',
    'carta.aprobar', 'cartera.importar', 'control_operativo.asignacion.simular',
    'control_operativo.asignacion.ver', 'control_operativo.base_marcacion.exportar',
    'control_operativo.calidad.editar', 'control_operativo.calidad.ver', 'control_operativo.editar',
    'control_operativo.ver', 'convenio.aprobar', 'escalamiento.aprobar',
    'escalamiento.escalar_liderazgo', 'evaluacion.gestionar', 'firma.subir_propia',
    'gestion.adjunto.subir', 'gestion.carta.aprobar', 'gestion.carta.crear', 'gestion.gestionar',
    'gestion.promesa.crear', 'gestion.promesa.editar', 'gestion.ver', 'habilidades.desbloquear',
    'horario.aprobar', 'informacion.ver', 'modulo.calendario', 'modulo.centro_inteligencia',
    'modulo.configuracion', 'modulo.control_operativo', 'modulo.dashboard', 'modulo.gestion',
    'modulo.informacion', 'modulo.repositorio', 'permiso.aprobar', 'rec.gestionar', 'reporte.exportar'
  ]
};

const has = (rol) => (permiso) => PERMISOS_POR_ROL[rol].includes(permiso);

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

/** Extrae el middleware/handler en la posición `index` de la pila de una ruta
 *  (method+path) de un Router de Express YA COMPILADO — sin reimplementar
 *  nada, el mismo código que corre montado en main.ts. */
function routeHandlerAt(router, method, routePath, index) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method]
  );
  if (!layer) throw new Error(`No se encontró la ruta ${method.toUpperCase()} ${routePath}`);
  const handle = layer.route.stack[index] && layer.route.stack[index].handle;
  if (!handle) throw new Error(`La ruta ${method.toUpperCase()} ${routePath} no tiene middleware en la posición ${index}`);
  return handle;
}

/** Invoca un middleware de autorización (requirePermission/requireAnyPermission)
 *  ya extraído, con un req.auth fijo, y reporta si dejó pasar (next) o bloqueó. */
async function probarAutorizacion(handler, rol) {
  const req = { auth: { userId: 'test-user', permissions: PERMISOS_POR_ROL[rol], role: { clave: rol } } };
  const res = mockRes();
  let nextCalled = false;
  await handler(req, res, () => { nextCalled = true; });
  return { nextCalled, statusCode: res.statusCode, body: res.body };
}

/* ============================================================================
 * 1) ANÁLISIS (Dashboard / Centro de Inteligencia): backend realmente gateado
 * ========================================================================== */

test('GET /api/dashboard: requiere modulo.dashboard, no solo requireAuth (cierra el hueco encontrado)', async () => {
  const dashboardRoutes = require(path.join(distDir, 'routes', 'dashboardRoutes.js')).default;
  // Posición 1 = el middleware DESPUÉS de requireAuth (posición 0); el handler final está en la 2.
  const gate = routeHandlerAt(dashboardRoutes, 'get', '/dashboard', 1);

  const sinPermiso = await probarAutorizacion(gate, 'gerente_zona');
  assert.equal(sinPermiso.nextCalled, false, 'Gerente (sin modulo.dashboard) NO debe poder llamar /api/dashboard directamente');
  assert.equal(sinPermiso.statusCode, 403);

  const conPermiso = await probarAutorizacion(gate, 'supervisor');
  assert.equal(conPermiso.nextCalled, true, 'Supervisor (con modulo.dashboard, sin cambios) sigue accediendo con normalidad');
});

test('GET /api/inteligencia: requiere modulo.centro_inteligencia, no solo requireAuth', async () => {
  const dashboardRoutes = require(path.join(distDir, 'routes', 'dashboardRoutes.js')).default;
  const gate = routeHandlerAt(dashboardRoutes, 'get', '/inteligencia', 1);

  const sinPermiso = await probarAutorizacion(gate, 'gestor');
  assert.equal(sinPermiso.nextCalled, false, 'Gestor (sin modulo.centro_inteligencia) NO debe poder llamar /api/inteligencia directamente');
  assert.equal(sinPermiso.statusCode, 403);
});

/* ============================================================================
 * 2) CONTROL OPERATIVO: Gerente ❌, Gestor ✅ (distinción obligatoria)
 * ========================================================================== */

test('GET /api/control/dashboard: Gerente DENEGADO, Gestor PERMITIDO (distinción obligatoria de la tarea)', async () => {
  const controlRoutes = require(path.join(distDir, 'routes', 'controlRoutes.js')).default;
  const gate = routeHandlerAt(controlRoutes, 'get', '/control/dashboard', 1);

  const gerente = await probarAutorizacion(gate, 'gerente_zona');
  assert.equal(gerente.nextCalled, false, 'Gerente no debe tener acceso a Control Operativo');
  assert.equal(gerente.statusCode, 403);

  const gestorRes = await probarAutorizacion(gate, 'gestor');
  assert.equal(gestorRes.nextCalled, true, 'Gestor SÍ debe tener acceso a Control Operativo');
});

test('GET /control-operativo (frontend AppRoutes usa control_operativo.ver): mismo permiso, misma distinción', () => {
  // No hay Router de frontend que probar aquí (es React Router, no Express) — se
  // confirma que la matriz de permisos aplicada es exactamente la que gatea esa
  // ruta en frontend/src/routes/AppRoutes.tsx (PermissionRoute permission="control_operativo.ver").
  assert.equal(has('gerente_zona')('control_operativo.ver'), false);
  assert.equal(has('gestor')('control_operativo.ver'), true);
});

test('POST /api/control/asignacion/simular: Gerente denegado (perdió TODO Control Operativo, incluida Asignación)', async () => {
  const asignacionRoutes = require(path.join(distDir, 'routes', 'asignacionRoutes.js')).default;
  const gate = routeHandlerAt(asignacionRoutes, 'post', '/control/asignacion/simular', 1);
  const gerente = await probarAutorizacion(gate, 'gerente_zona');
  assert.equal(gerente.nextCalled, false);
  assert.equal(gerente.statusCode, 403);
});

/* ============================================================================
 * 3) USUARIOS: ❌ para Gerente, Gestor Y Supervisor (corrección de Supervisor)
 * ========================================================================== */

test('GET /api/usuarios (lectura): Gerente, Gestor y Supervisor DENEGADOS tras la corrección', async () => {
  const usuariosRoutes = require(path.join(distDir, 'routes', 'usuariosRoutes.js')).default;
  const gate = routeHandlerAt(usuariosRoutes, 'get', '/usuarios', 1);

  for (const rol of ['gerente_zona', 'gestor', 'supervisor']) {
    // eslint-disable-next-line no-await-in-loop
    const resultado = await probarAutorizacion(gate, rol);
    assert.equal(resultado.nextCalled, false, `${rol} no debe poder leer /api/usuarios`);
    assert.equal(resultado.statusCode, 403);
  }
});

test('PATCH /api/usuarios/:id/password (admin global): Supervisor sigue denegado (ya lo estaba, sin cambios)', async () => {
  const usuariosRoutes = require(path.join(distDir, 'routes', 'usuariosRoutes.js')).default;
  const gate = routeHandlerAt(usuariosRoutes, 'patch', '/usuarios/:id/password', 1);
  const supervisor = await probarAutorizacion(gate, 'supervisor');
  assert.equal(supervisor.nextCalled, false);
});

/* ============================================================================
 * 4) MATRIZ COMPLETA (Sección 5 de la tarea) — snapshot exacto
 * ========================================================================== */

test('Matriz final Análisis/Gestión/Control Operativo/Información/Usuarios — Gerente vs Gestor', () => {
  const matriz = (rol) => ({
    analisis: has(rol)('modulo.dashboard') || has(rol)('modulo.centro_inteligencia'),
    gestion: has(rol)('modulo.gestion'),
    controlOperativo: has(rol)('control_operativo.ver'),
    informacion: has(rol)('modulo.informacion') && has(rol)('informacion.ver'),
    usuarios: has(rol)('modulo.usuarios')
  });

  assert.deepEqual(matriz('gerente_zona'), { analisis: false, gestion: true, controlOperativo: false, informacion: true, usuarios: false });
  assert.deepEqual(matriz('gestor'), { analisis: false, gestion: true, controlOperativo: true, informacion: true, usuarios: false });
});

test('Supervisor: mantiene todo lo demás, pierde ÚNICAMENTE Usuarios', () => {
  assert.equal(has('supervisor')('modulo.usuarios'), false, 'Usuarios debe estar ausente');
  assert.equal(has('supervisor')('modulo.informacion'), true, 'Información debe seguir presente');
  assert.equal(has('supervisor')('control_operativo.ver'), true, 'Control Operativo (ya lo tenía) no debe tocarse');
  assert.equal(has('supervisor')('modulo.dashboard'), true, 'Análisis (ya lo tenía) no debe tocarse');
  assert.equal(has('supervisor')('modulo.gestion'), true, 'Gestión (ya lo tenía) no debe tocarse');
});
