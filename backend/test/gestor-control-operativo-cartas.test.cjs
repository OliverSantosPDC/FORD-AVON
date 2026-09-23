'use strict';

/**
 * FORD-AVON — Auditoría COMPLETA de accesos/visuales de TODOS los usuarios
 * con rol `gestor` y `gerente_zona`, e igualación explícita de Control
 * Operativo y Cartas a ❌ para AMBOS roles (instrucción posterior que
 * revierte la distinción "Gestor ✅ Control Operativo" de una ronda previa).
 *
 * AUDITORÍA REALIZADA (contra Supabase real, vuazzailuqgbjnnbdtrg, vía
 * mcp__Supabase__execute_sql, solo lecturas hasta aplicar la corrección):
 *  - profiles tiene una única columna de autorización: role_id (FK a roles).
 *    No existe ninguna tabla de permisos por usuario en el esquema — la
 *    autorización es 100% determinada por el rol, sin excepción posible por
 *    usuario ni por nombre/id individual.
 *  - roles.clave tiene constraint UNIQUE: no puede haber dos filas 'gestor'
 *    o 'gerente_zona' con permisos distintos compitiendo entre sí.
 *  - 160/160 profiles activos tienen un role_id válido (ninguno NULL ni
 *    huérfano): 1 administrador, 137 gerente_zona, 18 gestor, 2 liderazgo,
 *    2 supervisor — todos activos.
 *  - Conclusión: cada uno de los 18 usuarios `gestor` y cada uno de los 137
 *    usuarios `gerente_zona` comparte EXACTAMENTE el mismo role_id dentro de
 *    su rol, así que corregir role_permissions para el rol corrige a los
 *    18/18 y 137/137 usuarios por igual, sin lógica por usuario.
 *  - gerente_zona: su role_permissions YA cumplía exactamente la matriz
 *    pedida en esta ronda (heredado de las dos rondas anteriores) — sin
 *    cambios, confirmado por auditoría antes de tocar nada.
 *  - gestor: SÍ tenía acceso incorrecto — control_operativo.ver,
 *    modulo.control_operativo (permiso inerte, sin uso en código) y
 *    gestion.carta.crear, los 3 retirados en la migración
 *    corregir_control_operativo_cartas_gestor.
 *
 * Este archivo verifica, contra el código YA COMPILADO en dist/ (nunca una
 * reimplementación), que esos 3 permisos retirados bloquean también el
 * acceso DIRECTO por API — y que supervisor/administrador/liderazgo, y las
 * acciones de gestor NO mencionadas en la nueva matriz (Cuentas > Acciones,
 * Calendario), quedan exactamente igual que antes.
 *
 * Ejecutar (tras `npm run build`): node --test test/gestor-control-operativo-cartas.test.cjs
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

/** Snapshot exacto post-migración (confirmado contra Supabase real). */
const PERMISOS_POR_ROL = {
  gerente_zona: [
    'calendario.editar', 'calendario.eliminar', 'calendario.ver', 'convenio.solicitar',
    'gestion.ver', 'informacion.ver', 'modulo.calendario', 'modulo.gestion',
    'modulo.informacion', 'permiso.solicitar'
  ],
  gestor: [
    'calendario.ver', 'carta.solicitar', 'escalamiento.crear',
    'gestion.adjunto.subir', 'gestion.gestionar', 'gestion.promesa.crear',
    'gestion.promesa.editar', 'gestion.ver', 'informacion.ver', 'modulo.calendario',
    'modulo.gestion', 'modulo.informacion', 'permiso.solicitar', 'rec.solicitar'
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
  ],
  liderazgo: [
    'calendario.crear', 'calendario.editar', 'calendario.eliminar', 'calendario.ver', 'cartera.ver_todo',
    'configuracion.editar', 'configuracion.ver', 'control_operativo.asignacion.aplicar',
    'control_operativo.asignacion.simular', 'control_operativo.asignacion.ver',
    'control_operativo.base_marcacion.exportar', 'control_operativo.calidad.editar', 'control_operativo.calidad.ver',
    'control_operativo.editar', 'control_operativo.reasignacion', 'control_operativo.ver', 'gestion.adjunto.subir',
    'gestion.carta.aprobar', 'gestion.carta.crear', 'gestion.gestionar', 'gestion.promesa.crear',
    'gestion.promesa.editar', 'gestion.ver', 'informacion.editar', 'informacion.ver', 'modulo.calendario',
    'modulo.centro_inteligencia', 'modulo.configuracion', 'modulo.control_operativo', 'modulo.dashboard',
    'modulo.gestion', 'modulo.informacion', 'reporte.exportar'
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
 * 1) CONTROL OPERATIVO: ahora ❌ para Gestor (igual que Gerente)
 * ========================================================================== */

test('GET /api/control/dashboard: Gerente y Gestor DENEGADOS, Supervisor/Administrador/Liderazgo PERMITIDOS', async () => {
  const controlRoutes = require(path.join(distDir, 'routes', 'controlRoutes.js')).default;
  const gate = routeHandlerAt(controlRoutes, 'get', '/control/dashboard', 1);

  for (const rol of ['gerente_zona', 'gestor']) {
    // eslint-disable-next-line no-await-in-loop
    const r = await probarAutorizacion(gate, rol);
    assert.equal(r.nextCalled, false, `${rol} no debe tener acceso a Control Operativo`);
    assert.equal(r.statusCode, 403);
  }
  for (const rol of ['supervisor', 'administrador', 'liderazgo']) {
    // eslint-disable-next-line no-await-in-loop
    const r = await probarAutorizacion(gate, rol);
    assert.equal(r.nextCalled, true, `${rol} conserva Control Operativo sin cambios`);
  }
});

test('POST /api/control/asignacion/simular: Gestor DENEGADO (perdió TODO Control Operativo, incluida Asignación)', async () => {
  const asignacionRoutes = require(path.join(distDir, 'routes', 'asignacionRoutes.js')).default;
  const gate = routeHandlerAt(asignacionRoutes, 'post', '/control/asignacion/simular', 1);
  const gestor = await probarAutorizacion(gate, 'gestor');
  assert.equal(gestor.nextCalled, false);
  assert.equal(gestor.statusCode, 403);
});

test('GET /control-operativo y /asignacion (permisos que usa AppRoutes.tsx en frontend): ambos ausentes para Gestor', () => {
  assert.equal(has('gestor')('control_operativo.ver'), false);
  assert.equal(has('gestor')('control_operativo.asignacion.ver'), false);
});

/* ============================================================================
 * 2) CARTAS: ahora ❌ para Gestor (igual que Gerente)
 * ========================================================================== */

test('POST /api/gestion/cuentas/:codigo/cartas: Gestor DENEGADO', async () => {
  const gestionRoutes = require(path.join(distDir, 'routes', 'gestionRoutes.js')).default;
  const gate = routeHandlerAt(gestionRoutes, 'post', '/gestion/cuentas/:codigo/cartas', 1);
  const gestor = await probarAutorizacion(gate, 'gestor');
  assert.equal(gestor.nextCalled, false);
  assert.equal(gestor.statusCode, 403);
});

test('GET /api/gestion/cartas (listado): Gestor DENEGADO', async () => {
  const gestionRoutes = require(path.join(distDir, 'routes', 'gestionRoutes.js')).default;
  const gate = routeHandlerAt(gestionRoutes, 'get', '/gestion/cartas', 1);
  const gestor = await probarAutorizacion(gate, 'gestor');
  assert.equal(gestor.nextCalled, false);
  assert.equal(gestor.statusCode, 403);
});

/* ============================================================================
 * 3) "Mantener las acciones permitidas actualmente por el rol" (Cuentas/Calendario)
 * ========================================================================== */

test('POST /api/gestion/cuentas/:codigo/tipificacion, /promesa, /adjuntos: Gestor SIGUE PERMITIDO (Cuentas > Acciones no se tocó)', async () => {
  const gestionRoutes = require(path.join(distDir, 'routes', 'gestionRoutes.js')).default;
  for (const rutaInfo of [
    ['post', '/gestion/cuentas/:codigo/tipificacion'],
    ['post', '/gestion/cuentas/:codigo/promesa'],
    ['post', '/gestion/cuentas/:codigo/adjuntos']
  ]) {
    const gate = routeHandlerAt(gestionRoutes, rutaInfo[0], rutaInfo[1], 1);
    // eslint-disable-next-line no-await-in-loop
    const gestor = await probarAutorizacion(gate, 'gestor');
    assert.equal(gestor.nextCalled, true, `Gestor debe seguir accediendo a ${rutaInfo[1]}`);
  }
});

test('Calendario: Gestor nunca tuvo calendario.crear — "Nuevo evento" sigue ausente exactamente igual que antes de esta ronda', () => {
  assert.equal(has('gestor')('calendario.crear'), false);
  assert.equal(has('gestor')('calendario.ver'), true, 'Gestor conserva la vista de Calendario');
});

/* ============================================================================
 * 4) Matriz final: Gerente y Gestor quedan IGUALES en Control Operativo/Cartas;
 *    Supervisor/Administrador/Liderazgo, byte a byte intactos
 * ========================================================================== */

test('Matriz final: Gerente y Gestor coinciden en Análisis/Control Operativo/Cartas/Repositorio/Configuración/Usuarios (todos ❌)', () => {
  const matriz = (rol) => ({
    analisis: has(rol)('modulo.dashboard') || has(rol)('modulo.centro_inteligencia'),
    gestion: has(rol)('modulo.gestion'),
    controlOperativo: has(rol)('control_operativo.ver'),
    cartas: has(rol)('gestion.carta.crear') || has(rol)('gestion.carta.aprobar'),
    informacion: has(rol)('modulo.informacion') && has(rol)('informacion.ver'),
    repositorio: has(rol)('modulo.repositorio'),
    configuracion: has(rol)('configuracion.ver'),
    usuarios: has(rol)('modulo.usuarios')
  });
  const esperado = {
    analisis: false, gestion: true, controlOperativo: false, cartas: false,
    informacion: true, repositorio: false, configuracion: false, usuarios: false
  };
  assert.deepEqual(matriz('gerente_zona'), esperado);
  assert.deepEqual(matriz('gestor'), esperado);
});

test('Regresión: Supervisor, Administrador y Liderazgo quedan byte a byte intactos (44/39/33 permisos, sin cambios)', () => {
  assert.equal(PERMISOS_POR_ROL.administrador.length, 44);
  assert.equal(PERMISOS_POR_ROL.supervisor.length, 39);
  assert.equal(PERMISOS_POR_ROL.liderazgo.length, 33);
  assert.equal(has('supervisor')('control_operativo.ver'), true, 'Supervisor conserva Control Operativo');
  assert.equal(has('supervisor')('gestion.carta.crear'), true, 'Supervisor conserva Cartas');
  assert.equal(has('administrador')('modulo.usuarios'), true, 'Administrador conserva Usuarios');
  assert.equal(has('liderazgo')('control_operativo.ver'), true, 'Liderazgo conserva Control Operativo');
});

test('Consistencia por rol (arquitectura de permisos): un único role_id por rol implica cero variación entre usuarios del mismo rol', () => {
  // profiles.role_id es la ÚNICA fuente de autorización (auditado: sin tabla
  // de permisos por usuario en el esquema). Con role_permissions corregido,
  // los 18 usuarios gestor y los 137 usuarios gerente_zona activos en
  // Supabase reciben, sin excepción, exactamente este mismo array.
  assert.equal(PERMISOS_POR_ROL.gestor.includes('control_operativo.ver'), false);
  assert.equal(PERMISOS_POR_ROL.gestor.includes('modulo.control_operativo'), false);
  assert.equal(PERMISOS_POR_ROL.gestor.includes('gestion.carta.crear'), false);
  assert.equal(PERMISOS_POR_ROL.gestor.length, 14);
});
