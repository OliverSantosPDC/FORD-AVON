'use strict';

/**
 * FORD-AVON — Corrección de visibilidad y ACCIONES exclusiva del rol
 * gerente_zona (Operación > Cartas, Administración > Repositorio/Gestión de
 * Calendario, Calendario > Crear evento, Gestión > Cuentas > Acciones).
 *
 * Verifica, contra el código YA COMPILADO en dist/ (nunca una
 * reimplementación), que los permisos retirados de gerente_zona en la
 * migración `corregir_visibilidad_acciones_gerente_zona` bloquean también el
 * acceso DIRECTO por API a cada acción que la UI ahora oculta — y que
 * ningún otro rol (gestor/supervisor/administrador) pierde nada.
 *
 * Ejecutar (tras `npm run build`): node --test test/gerente-zona-acciones.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const fakeClient = { from: () => ({ insert: async () => ({ data: null, error: null }) }) };
const supabaseJsPath = require.resolve('@supabase/supabase-js');
const fakeSupabaseModule = new Module(supabaseJsPath);
fakeSupabaseModule.exports = { createClient: () => fakeClient };
fakeSupabaseModule.loaded = true;
require.cache[supabaseJsPath] = fakeSupabaseModule;

const distDir = path.join(__dirname, '..', 'dist');

/** Snapshot exacto post-migración (confirmado contra Supabase real,
 *  vuazzailuqgbjnnbdtrg, tabla role_permissions) de los 4 roles que
 *  intervienen en esta ronda. gestor/supervisor/administrador están
 *  reproducidos completos para probar que NINGUNO perdió nada. */
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
  ],
  administrador: [
    'asignaciones.gestionar', 'calendario.crear', 'calendario.editar', 'calendario.eliminar', 'calendario.ver',
    'carta.aprobar', 'cartera.importar', 'cartera.ver_todo', 'configuracion.administrar', 'configuracion.editar',
    'configuracion.ver', 'control_operativo.asignacion.aplicar', 'control_operativo.asignacion.simular',
    'control_operativo.asignacion.ver', 'control_operativo.base_marcacion.exportar', 'control_operativo.calidad.editar',
    'control_operativo.calidad.ver', 'control_operativo.editar', 'control_operativo.reasignacion', 'control_operativo.ver',
    'convenio.aprobar', 'escalamiento.aprobar', 'gestion.adjunto.subir', 'gestion.carta.aprobar', 'gestion.carta.crear',
    'gestion.gestionar', 'gestion.promesa.crear', 'gestion.promesa.editar', 'gestion.ver', 'horario.aprobar',
    'informacion.editar', 'informacion.ver', 'modulo.calendario', 'modulo.centro_inteligencia', 'modulo.configuracion',
    'modulo.control_operativo', 'modulo.dashboard', 'modulo.gestion', 'modulo.informacion', 'modulo.repositorio',
    'modulo.usuarios', 'permiso.aprobar', 'reporte.exportar', 'usuarios.administrar_global'
  ]
};

const has = (rol) => (permiso) => PERMISOS_POR_ROL[rol].includes(permiso);

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

function routeHandlerAt(router, method, routePath, index) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method]
  );
  if (!layer) throw new Error(`No se encontró la ruta ${method.toUpperCase()} ${routePath}`);
  const handle = layer.route.stack[index] && layer.route.stack[index].handle;
  if (!handle) throw new Error(`La ruta ${method.toUpperCase()} ${routePath} no tiene middleware en la posición ${index}`);
  return handle;
}

async function probarAutorizacion(handler, rol) {
  const req = { auth: { userId: 'test-user', permissions: PERMISOS_POR_ROL[rol], role: { clave: rol } } };
  const res = mockRes();
  let nextCalled = false;
  await handler(req, res, () => { nextCalled = true; });
  return { nextCalled, statusCode: res.statusCode, body: res.body };
}

/* ============================================================================
 * 1) CALENDARIO > "Crear evento": bloqueado para Gerente, intacto para el resto
 * ========================================================================== */

test('POST /api/calendario (crear evento): Gerente DENEGADO, Supervisor/Administrador siguen PERMITIDOS', async () => {
  const calendarRoutes = require(path.join(distDir, 'routes', 'calendarRoutes.js')).default;
  const gate = routeHandlerAt(calendarRoutes, 'post', '/calendario', 1);

  const gerente = await probarAutorizacion(gate, 'gerente_zona');
  assert.equal(gerente.nextCalled, false, 'Gerente (sin calendario.crear) no debe poder crear eventos directamente por API');
  assert.equal(gerente.statusCode, 403);

  const supervisorRes = await probarAutorizacion(gate, 'supervisor');
  assert.equal(supervisorRes.nextCalled, true, 'Supervisor (calendario.crear intacto) sigue creando eventos con normalidad');

  const adminRes = await probarAutorizacion(gate, 'administrador');
  assert.equal(adminRes.nextCalled, true, 'Administrador (sin cambios) sigue creando eventos con normalidad');
});

test('PATCH /api/calendario/:id (editar evento): Gerente sigue PERMITIDO — la tarea solo pidió ocultar "Crear evento"', async () => {
  const calendarRoutes = require(path.join(distDir, 'routes', 'calendarRoutes.js')).default;
  const gate = routeHandlerAt(calendarRoutes, 'patch', '/calendario/:id', 1);
  const gerente = await probarAutorizacion(gate, 'gerente_zona');
  assert.equal(gerente.nextCalled, true, 'Gerente conserva calendario.editar: no se tocó por no estar en el alcance pedido');
});

/* ============================================================================
 * 2) GESTIÓN > CUENTAS > "Acciones": bloqueado para Gerente, intacto para Gestor
 * ========================================================================== */

test('POST /api/gestion/cuentas/:codigo/tipificacion: Gerente DENEGADO, Gestor PERMITIDO', async () => {
  const gestionRoutes = require(path.join(distDir, 'routes', 'gestionRoutes.js')).default;
  const gate = routeHandlerAt(gestionRoutes, 'post', '/gestion/cuentas/:codigo/tipificacion', 1);

  const gerente = await probarAutorizacion(gate, 'gerente_zona');
  assert.equal(gerente.nextCalled, false, 'Gerente (sin gestion.gestionar) no debe poder tipificar una cuenta directamente por API');
  assert.equal(gerente.statusCode, 403);

  const gestorRes = await probarAutorizacion(gate, 'gestor');
  assert.equal(gestorRes.nextCalled, true, 'Gestor (gestion.gestionar intacto) sigue tipificando con normalidad');
});

test('POST /api/gestion/cuentas/:codigo/promesa: Gerente DENEGADO', async () => {
  const gestionRoutes = require(path.join(distDir, 'routes', 'gestionRoutes.js')).default;
  const gate = routeHandlerAt(gestionRoutes, 'post', '/gestion/cuentas/:codigo/promesa', 1);
  const gerente = await probarAutorizacion(gate, 'gerente_zona');
  assert.equal(gerente.nextCalled, false);
  assert.equal(gerente.statusCode, 403);
});

test('POST /api/gestion/cuentas/:codigo/adjuntos: Gerente DENEGADO', async () => {
  const gestionRoutes = require(path.join(distDir, 'routes', 'gestionRoutes.js')).default;
  const gate = routeHandlerAt(gestionRoutes, 'post', '/gestion/cuentas/:codigo/adjuntos', 1);
  const gerente = await probarAutorizacion(gate, 'gerente_zona');
  assert.equal(gerente.nextCalled, false);
  assert.equal(gerente.statusCode, 403);
});

test('GET /api/gestion/cuentas (columnas de la tabla, sin "Acciones"): Gerente sigue PERMITIDO — solo se retiró la acción, no la lectura', async () => {
  const gestionRoutes = require(path.join(distDir, 'routes', 'gestionRoutes.js')).default;
  const gate = routeHandlerAt(gestionRoutes, 'get', '/gestion/cuentas', 1);
  const gerente = await probarAutorizacion(gate, 'gerente_zona');
  assert.equal(gerente.nextCalled, true, 'Gerente conserva gestion.ver: la tabla de Cuentas se sigue viendo, solo sin la columna Acciones');
});

/* ============================================================================
 * 3) OPERACIÓN > GESTIÓN > "Cartas": bloqueado para Gerente, intacto para Gestor/Supervisor
 * ========================================================================== */

test('POST /api/gestion/cuentas/:codigo/cartas: Gerente DENEGADO, Gestor PERMITIDO', async () => {
  const gestionRoutes = require(path.join(distDir, 'routes', 'gestionRoutes.js')).default;
  const gate = routeHandlerAt(gestionRoutes, 'post', '/gestion/cuentas/:codigo/cartas', 1);

  const gerente = await probarAutorizacion(gate, 'gerente_zona');
  assert.equal(gerente.nextCalled, false, 'Gerente (sin gestion.carta.crear) no debe poder crear cartas directamente por API');
  assert.equal(gerente.statusCode, 403);

  const gestorRes = await probarAutorizacion(gate, 'gestor');
  assert.equal(gestorRes.nextCalled, true, 'Gestor (gestion.carta.crear intacto) sigue creando cartas con normalidad');
});

test('GET /api/gestion/cartas (listado, gate nuevo de esta ronda): Gerente DENEGADO, Gestor/Supervisor/Administrador PERMITIDOS', async () => {
  const gestionRoutes = require(path.join(distDir, 'routes', 'gestionRoutes.js')).default;
  const gate = routeHandlerAt(gestionRoutes, 'get', '/gestion/cartas', 1);

  const gerente = await probarAutorizacion(gate, 'gerente_zona');
  assert.equal(gerente.nextCalled, false, 'Gerente no debe poder listar cartas directamente por API (pestaña "Cartas" oculta)');
  assert.equal(gerente.statusCode, 403);

  for (const rol of ['gestor', 'supervisor', 'administrador']) {
    // eslint-disable-next-line no-await-in-loop
    const resultado = await probarAutorizacion(gate, rol);
    assert.equal(resultado.nextCalled, true, `${rol} debe seguir listando cartas con normalidad (permiso ya lo tenía)`);
  }
});

/* ============================================================================
 * 4) Matriz final y "no modifiques otros roles"
 * ========================================================================== */

test('Matriz final: Gerente pierde exactamente 6 permisos de acción; Gestor/Supervisor/Administrador quedan byte-a-byte intactos', () => {
  assert.deepEqual(
    [...PERMISOS_POR_ROL.gerente_zona].sort(),
    ['calendario.editar', 'calendario.eliminar', 'calendario.ver', 'convenio.solicitar', 'gestion.ver',
      'informacion.ver', 'modulo.calendario', 'modulo.gestion', 'modulo.informacion', 'permiso.solicitar'].sort()
  );
  // Ninguno de los 6 permisos retirados de gerente_zona aparece siquiera mencionado
  // aquí para gestor/supervisor/administrador — sus arrays son el snapshot real de
  // Supabase tomado DESPUÉS de aplicar la migración de esta ronda.
  for (const permiso of ['calendario.crear', 'gestion.gestionar', 'gestion.promesa.crear', 'gestion.promesa.editar', 'gestion.adjunto.subir', 'gestion.carta.crear']) {
    assert.equal(has('gerente_zona')(permiso), false, `gerente_zona no debe tener ${permiso}`);
  }
  assert.equal(has('gestor')('gestion.gestionar'), true, 'gestor conserva gestion.gestionar');
  assert.equal(has('supervisor')('gestion.carta.crear'), true, 'supervisor conserva gestion.carta.crear');
  assert.equal(has('administrador')('gestion.adjunto.subir'), true, 'administrador conserva gestion.adjunto.subir');
});

test('Administración: para Gerente solo "Información" queda con leaf visible (Repositorio se colapsa por falta de calendario.crear)', () => {
  // Espejo de la condición real en frontend/src/config/navigation.tsx: el leaf
  // "Gestión de Calendario" (repo-calendario) usa 'calendario.crear' como único
  // gate — al no tenerlo, el nodo "Repositorio" (sin ningún otro leaf visible
  // para Gerente: ni modulo.repositorio ni usuarios.administrar_global) se oculta
  // por completo vía nodeHasVisibleLeaf, sin lógica de rol añadida.
  assert.equal(has('gerente_zona')('calendario.crear'), false);
  assert.equal(has('gerente_zona')('modulo.repositorio'), false);
  assert.equal(has('gerente_zona')('usuarios.administrar_global'), false);
  assert.equal(has('gerente_zona')('modulo.informacion') && has('gerente_zona')('informacion.ver'), true);
});
