'use strict';

/**
 * FORD-AVON — Notificaciones (campana del Header): contra el código YA
 * COMPILADO en dist/ (nunca una reimplementación), con un cliente Supabase
 * falso en memoria (datos 100% ficticios), igual que el resto de la suite.
 *
 * Cubre, de extremo a extremo (EVENTO REAL -> notificación -> contador ->
 * listado -> marcar leída):
 *  - NotificacionesService: contarNoLeidas, listarNotificaciones (no
 *    leídas primero, luego más recientes), marcarLeida (scope por
 *    usuario_destinatario_id, nunca cruza usuarios), marcarTodasLeidas,
 *    deduplicación (mismo evento = mismo destinatario = mismo tipo =
 *    misma referencia -> nunca dos filas).
 *  - notificarCartaEscalada: resuelve el Supervisor VIGENTE real del
 *    gestor (vía gestores.usuario_id -> gestores.id -> supervisor_gestor,
 *    exactamente la misma relación que usa ScopeService), nunca notifica a
 *    "todos los supervisores"; si no hay Supervisor resoluble, no genera
 *    nada (nunca un destinatario inventado).
 *  - notificarCartaResuelta: notifica ÚNICAMENTE al gestor dueño de la
 *    carta.
 *  - notificarPasswordCambiada: nunca incluye la contraseña en el mensaje.
 *  - Mezcla de leídas/no leídas, 0/1/varias no leídas.
 *
 * Ejecutar (tras `npm run build`): node --test test/notificaciones.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

/* ===== Estado en memoria (datos 100% ficticios) ===== */
let notificaciones = [];
let gestores = [];
let supervisorGestor = [];
let nextId = 1;
let nowCounter = Date.now();

function tablaDe(nombre) {
  if (nombre === 'notificaciones') return notificaciones;
  if (nombre === 'gestores') return gestores;
  if (nombre === 'supervisor_gestor') return supervisorGestor;
  return [];
}

/** Parser mínimo del patrón `.or('col.is.null,col.gte.valor')` tal cual lo
 *  usa ScopeService.supervisoresPorGestorId — no un parser genérico de
 *  PostgREST, solo lo que el código real emite. */
function cumpleOr(row, expr) {
  return expr.split(',').some((clause) => {
    const [col, op, val] = clause.split('.');
    if (op === 'is' && val === 'null') return row[col] === null || row[col] === undefined;
    if (op === 'gte') return row[col] !== null && row[col] !== undefined && String(row[col]) >= val;
    return false;
  });
}

class Builder {
  constructor(tabla) {
    this.tabla = tabla;
    this.action = 'select';
    this.filtros = [];
    this.orders = [];
    this.rangeFrom = null; this.rangeTo = null;
    this.limitN = null;
    this.countMode = null; this.headOnly = false;
    this.insertRow = null; this.patch = null;
    this.wantSelectAfterWrite = false;
  }
  select(_cols, opts) {
    if (this.action === 'select') { if (opts && opts.count) { this.countMode = opts.count; this.headOnly = !!opts.head; } }
    else { this.wantSelectAfterWrite = true; }
    return this;
  }
  eq(col, val) { this.filtros.push({ tipo: 'eq', col, val }); return this; }
  in(col, vals) { this.filtros.push({ tipo: 'in', col, vals }); return this; }
  lte(col, val) { this.filtros.push({ tipo: 'lte', col, val }); return this; }
  or(expr) { this.filtros.push({ tipo: 'or', expr }); return this; }
  order(col, opts) { this.orders.push({ col, ascending: !opts || opts.ascending !== false }); return this; }
  range(from, to) { this.rangeFrom = from; this.rangeTo = to; return this; }
  limit(n) { this.limitN = n; return this; }
  insert(row) { this.action = 'insert'; this.insertRow = row; return this; }
  update(patch) { this.action = 'update'; this.patch = patch; return this; }
  _match(row) {
    return this.filtros.every((f) => {
      if (f.tipo === 'eq') return String(row[f.col]) === String(f.val);
      if (f.tipo === 'in') return f.vals.map(String).includes(String(row[f.col]));
      if (f.tipo === 'lte') return row[f.col] !== null && row[f.col] !== undefined && String(row[f.col]) <= f.val;
      if (f.tipo === 'or') return cumpleOr(row, f.expr);
      return true;
    });
  }
  _run() {
    const tabla = tablaDe(this.tabla);
    if (this.action === 'insert') {
      if (this.tabla === 'notificaciones' && this.insertRow.referencia_id != null) {
        const dup = tabla.find((r) =>
          r.usuario_destinatario_id === this.insertRow.usuario_destinatario_id &&
          r.tipo === this.insertRow.tipo &&
          r.referencia_tipo === this.insertRow.referencia_tipo &&
          r.referencia_id === this.insertRow.referencia_id
        );
        if (dup) return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_notificaciones_evento"' } });
      }
      const row = {
        id: `n${nextId++}`, leida: false, fecha_creacion: new Date(nowCounter++).toISOString(),
        fecha_lectura: null, actor_id: null, referencia_tipo: null, referencia_id: null, ...this.insertRow
      };
      tabla.push(row);
      return Promise.resolve({ data: row, error: null });
    }
    if (this.action === 'update') {
      const match = tabla.filter((r) => this._match(r));
      match.forEach((r) => Object.assign(r, this.patch));
      const data = this.wantSelectAfterWrite ? match.map((r) => ({ ...r })) : null;
      return Promise.resolve({ data, error: null });
    }
    // select
    let rows = tabla.filter((r) => this._match(r));
    if (this.countMode) return Promise.resolve({ data: this.headOnly ? null : rows.map((r) => ({ ...r })), error: null, count: rows.length });
    for (const o of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const av = a[o.col]; const bv = b[o.col];
        const d = av === bv ? 0 : (av > bv ? 1 : -1);
        return o.ascending ? d : -d;
      });
    }
    if (this.rangeFrom != null) rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null });
  }
  then(resolve, reject) { return this._run().then(resolve, reject); }
}
const fakeClient = { from: (t) => new Builder(t) };

const supabaseJsPath = require.resolve('@supabase/supabase-js');
const fakeModule = new Module(supabaseJsPath);
fakeModule.exports = { createClient: () => fakeClient };
fakeModule.loaded = true;
require.cache[supabaseJsPath] = fakeModule;

const distDir = path.join(__dirname, '..', 'dist');
const {
  crearNotificacion, contarNoLeidas, listarNotificaciones, marcarLeida, marcarTodasLeidas,
  notificarCartaEscalada, notificarCartaResuelta, notificarPasswordCambiada, notificarSolicitudPasswordRechazada
} = require(path.join(distDir, 'services', 'NotificacionesService.js'));

test.beforeEach(() => {
  notificaciones = [];
  gestores = [
    { id: 'gestor-row-1', usuario_id: 'gestor-usuario-1' },
    { id: 'gestor-row-2', usuario_id: 'gestor-usuario-2' },
    { id: 'gestor-row-sin-supervisor', usuario_id: 'gestor-usuario-sin-supervisor' }
  ];
  supervisorGestor = [
    { gestor_id: 'gestor-row-1', supervisor_id: 'supervisor-1', activo: true, fecha_inicio: '2020-01-01', fecha_fin: null },
    { gestor_id: 'gestor-row-2', supervisor_id: 'supervisor-2', activo: true, fecha_inicio: '2020-01-01', fecha_fin: null },
    // Vigencia vencida (fecha_fin en el pasado) -> NO debe resolverse como supervisor vigente.
    { gestor_id: 'gestor-row-2', supervisor_id: 'supervisor-viejo', activo: true, fecha_inicio: '2010-01-01', fecha_fin: '2011-01-01' }
  ];
  nextId = 1;
  nowCounter = Date.now();
});

/* ============================================================================
 * 1) Contador / listado / marcar leída — mecánica básica, scope por usuario
 * ========================================================================== */

test('contarNoLeidas: 0 cuando no hay ninguna', async () => {
  assert.equal(await contarNoLeidas('u1'), 0);
});

test('contarNoLeidas: 1 con una sola no leída', async () => {
  await crearNotificacion({ usuarioDestinatarioId: 'u1', tipo: 'PASSWORD_CAMBIADA', titulo: 't', mensaje: 'm' });
  assert.equal(await contarNoLeidas('u1'), 1);
});

test('contarNoLeidas: varias no leídas cuenta exactamente, e ignora las de OTRO usuario', async () => {
  await crearNotificacion({ usuarioDestinatarioId: 'u1', tipo: 'PASSWORD_CAMBIADA', titulo: 't1', mensaje: 'm' });
  await crearNotificacion({ usuarioDestinatarioId: 'u1', tipo: 'PASSWORD_CAMBIADA', titulo: 't2', mensaje: 'm', referenciaTipo: 'x', referenciaId: 'r2' });
  await crearNotificacion({ usuarioDestinatarioId: 'u2', tipo: 'PASSWORD_CAMBIADA', titulo: 't3', mensaje: 'm' });
  assert.equal(await contarNoLeidas('u1'), 2);
  assert.equal(await contarNoLeidas('u2'), 1);
});

test('contarNoLeidas: una notificación LEÍDA no cuenta', async () => {
  await crearNotificacion({ usuarioDestinatarioId: 'u1', tipo: 'PASSWORD_CAMBIADA', titulo: 't', mensaje: 'm', referenciaTipo: 'x', referenciaId: 'r1' });
  const lista = await listarNotificaciones('u1');
  await marcarLeida(lista[0].id, 'u1');
  assert.equal(await contarNoLeidas('u1'), 0);
});

test('listarNotificaciones: NO LEÍDAS primero, luego por fecha más reciente', async () => {
  await crearNotificacion({ usuarioDestinatarioId: 'u1', tipo: 'PASSWORD_CAMBIADA', titulo: 'vieja-leida', mensaje: 'm', referenciaTipo: 'x', referenciaId: 'r1' });
  const [primeraLeida] = await listarNotificaciones('u1');
  await marcarLeida(primeraLeida.id, 'u1');
  await crearNotificacion({ usuarioDestinatarioId: 'u1', tipo: 'PASSWORD_CAMBIADA', titulo: 'nueva-no-leida-1', mensaje: 'm', referenciaTipo: 'x', referenciaId: 'r2' });
  await crearNotificacion({ usuarioDestinatarioId: 'u1', tipo: 'PASSWORD_CAMBIADA', titulo: 'nueva-no-leida-2', mensaje: 'm', referenciaTipo: 'x', referenciaId: 'r3' });
  const lista = await listarNotificaciones('u1');
  assert.deepEqual(lista.map((n) => n.titulo), ['nueva-no-leida-2', 'nueva-no-leida-1', 'vieja-leida']);
  assert.equal(lista[0].leida, false);
  assert.equal(lista[1].leida, false);
  assert.equal(lista[2].leida, true);
});

test('marcarLeida: marca la propia, fija fecha_lectura, y es idempotente (un segundo clic no cambia nada ni falla)', async () => {
  await crearNotificacion({ usuarioDestinatarioId: 'u1', tipo: 'PASSWORD_CAMBIADA', titulo: 't', mensaje: 'm' });
  const [n] = await listarNotificaciones('u1');
  assert.equal(n.leida, false);
  assert.equal(n.fechaLectura, null);
  const ok1 = await marcarLeida(n.id, 'u1');
  assert.equal(ok1, true);
  const [leida] = await listarNotificaciones('u1');
  assert.equal(leida.leida, true);
  assert.notEqual(leida.fechaLectura, null);
  const fechaLecturaOriginal = leida.fechaLectura;
  const ok2 = await marcarLeida(n.id, 'u1'); // segundo clic
  assert.equal(ok2, true);
  const [leida2] = await listarNotificaciones('u1');
  assert.equal(leida2.fechaLectura, fechaLecturaOriginal); // nunca se vuelve a pisar
});

test('SEGURIDAD: marcarLeida de una notificación de OTRO usuario devuelve false y NO la modifica', async () => {
  await crearNotificacion({ usuarioDestinatarioId: 'victima', tipo: 'PASSWORD_CAMBIADA', titulo: 't', mensaje: 'm' });
  const [n] = await listarNotificaciones('victima');
  const ok = await marcarLeida(n.id, 'atacante'); // el atacante conoce/adivina el id, pero NO es el destinatario
  assert.equal(ok, false);
  const [sigue] = await listarNotificaciones('victima');
  assert.equal(sigue.leida, false); // intacta
});

test('SEGURIDAD: contarNoLeidas/listarNotificaciones de un usuario NUNCA exponen las de otro', async () => {
  await crearNotificacion({ usuarioDestinatarioId: 'victima', tipo: 'PASSWORD_CAMBIADA', titulo: 'privada', mensaje: 'm' });
  const listaAtacante = await listarNotificaciones('atacante');
  assert.equal(listaAtacante.length, 0);
  assert.equal(await contarNoLeidas('atacante'), 0);
});

test('marcarTodasLeidas: marca todas las no leídas del usuario, devuelve la cantidad, y nunca toca las de otro usuario', async () => {
  await crearNotificacion({ usuarioDestinatarioId: 'u1', tipo: 'PASSWORD_CAMBIADA', titulo: 't1', mensaje: 'm', referenciaTipo: 'x', referenciaId: 'r1' });
  await crearNotificacion({ usuarioDestinatarioId: 'u1', tipo: 'PASSWORD_CAMBIADA', titulo: 't2', mensaje: 'm', referenciaTipo: 'x', referenciaId: 'r2' });
  await crearNotificacion({ usuarioDestinatarioId: 'u2', tipo: 'PASSWORD_CAMBIADA', titulo: 't3', mensaje: 'm' });
  const cantidad = await marcarTodasLeidas('u1');
  assert.equal(cantidad, 2);
  assert.equal(await contarNoLeidas('u1'), 0);
  assert.equal(await contarNoLeidas('u2'), 1); // intacta
});

/* ============================================================================
 * 2) Deduplicación — mismo evento nunca genera dos filas
 * ========================================================================== */

test('DUPLICADOS: el mismo evento (destinatario+tipo+referencia) procesado dos veces nunca genera dos notificaciones', async () => {
  const input = { usuarioDestinatarioId: 'u1', tipo: 'CARTA_AUTORIZADA', titulo: 'Carta autorizada', mensaje: 'Código: 123456', referenciaTipo: 'gestion_cartas', referenciaId: 'carta-1' };
  await crearNotificacion(input);
  await crearNotificacion(input); // reintento / doble llamada del mismo evento
  await crearNotificacion(input); // una tercera vez, por si acaso
  const lista = await listarNotificaciones('u1');
  assert.equal(lista.length, 1);
});

test('DUPLICADOS: eventos del MISMO tipo+referencia pero para destinatarios DISTINTOS sí generan una notificación cada uno', async () => {
  await crearNotificacion({ usuarioDestinatarioId: 'supervisor-1', tipo: 'CARTA_ESCALADA', titulo: 't', mensaje: 'm', referenciaTipo: 'gestion_cartas', referenciaId: 'carta-x' });
  await crearNotificacion({ usuarioDestinatarioId: 'supervisor-2', tipo: 'CARTA_ESCALADA', titulo: 't', mensaje: 'm', referenciaTipo: 'gestion_cartas', referenciaId: 'carta-x' });
  assert.equal((await listarNotificaciones('supervisor-1')).length, 1);
  assert.equal((await listarNotificaciones('supervisor-2')).length, 1);
});

/* ============================================================================
 * 3) EVENTOS REALES — destinatario correcto, nunca "todos", nunca inventado
 * ========================================================================== */

test('notificarCartaEscalada: notifica EXACTAMENTE al Supervisor vigente real del gestor (vía gestores + supervisor_gestor), nunca a otro', async () => {
  await notificarCartaEscalada({ cartaId: 'carta-1', codigo: '123456', gestorUsuarioId: 'gestor-usuario-1', pd: 'PD6', nombreCuenta: 'Juan Pérez' });
  const paraSup1 = await listarNotificaciones('supervisor-1');
  assert.equal(paraSup1.length, 1);
  assert.equal(paraSup1[0].tipo, 'CARTA_ESCALADA');
  assert.match(paraSup1[0].titulo, /escaló una carta/i);
  assert.match(paraSup1[0].mensaje, /123456/);
  assert.match(paraSup1[0].mensaje, /PD6/);
  assert.equal(paraSup1[0].referenciaTipo, 'gestion_cartas');
  assert.equal(paraSup1[0].referenciaId, 'carta-1');
  assert.equal(paraSup1[0].actorId, 'gestor-usuario-1');
  // El supervisor de OTRO gestor nunca recibe esta notificación.
  const paraSup2 = await listarNotificaciones('supervisor-2');
  assert.equal(paraSup2.length, 0);
});

test('notificarCartaEscalada: ignora un Supervisor cuya vigencia ya venció (fecha_fin pasada)', async () => {
  await notificarCartaEscalada({ cartaId: 'carta-2', codigo: '999', gestorUsuarioId: 'gestor-usuario-2', pd: 'PD4' });
  const paraSupervisorViejo = await listarNotificaciones('supervisor-viejo');
  assert.equal(paraSupervisorViejo.length, 0); // su vigencia venció en 2011
  const paraSupervisorVigente = await listarNotificaciones('supervisor-2');
  assert.equal(paraSupervisorVigente.length, 1);
});

test('notificarCartaEscalada: SIN destinatario inequívoco (gestor sin Supervisor vigente) NO genera ninguna notificación incorrecta', async () => {
  await notificarCartaEscalada({ cartaId: 'carta-3', codigo: '555', gestorUsuarioId: 'gestor-usuario-sin-supervisor', pd: 'PD1' });
  assert.equal(notificaciones.length, 0);
});

test('notificarCartaEscalada: gestorUsuarioId null (no debería ocurrir, pero es defensivo) tampoco genera notificación', async () => {
  await notificarCartaEscalada({ cartaId: 'carta-4', codigo: '000', gestorUsuarioId: null, pd: null });
  assert.equal(notificaciones.length, 0);
});

test('notificarCartaResuelta (aprobar): notifica ÚNICAMENTE al gestor dueño de la carta', async () => {
  await notificarCartaResuelta({ cartaId: 'carta-5', codigo: '777', gestorUsuarioId: 'gestor-usuario-1', aprobar: true, aprobadoPor: 'supervisor-1' });
  const paraGestor = await listarNotificaciones('gestor-usuario-1');
  assert.equal(paraGestor.length, 1);
  assert.equal(paraGestor[0].tipo, 'CARTA_AUTORIZADA');
  assert.match(paraGestor[0].titulo, /autorizada/i);
  assert.match(paraGestor[0].mensaje, /777/);
  assert.equal(paraGestor[0].actorId, 'supervisor-1');
  // Nadie más recibe esta notificación.
  assert.equal((await listarNotificaciones('gestor-usuario-2')).length, 0);
});

test('notificarCartaResuelta (rechazar): tipo CARTA_RECHAZADA, mismo destinatario (el gestor)', async () => {
  await notificarCartaResuelta({ cartaId: 'carta-6', codigo: '888', gestorUsuarioId: 'gestor-usuario-2', aprobar: false, aprobadoPor: 'supervisor-2' });
  const paraGestor = await listarNotificaciones('gestor-usuario-2');
  assert.equal(paraGestor.length, 1);
  assert.equal(paraGestor[0].tipo, 'CARTA_RECHAZADA');
  assert.match(paraGestor[0].titulo, /rechazada/i);
});

test('notificarCartaResuelta: SIN gestor_id no genera ninguna notificación (nunca un destinatario inventado)', async () => {
  await notificarCartaResuelta({ cartaId: 'carta-7', codigo: '111', gestorUsuarioId: null, aprobar: true, aprobadoPor: 'supervisor-1' });
  assert.equal(notificaciones.length, 0);
});

test('notificarPasswordCambiada: notifica al usuario afectado y NUNCA incluye la contraseña en el mensaje', async () => {
  await notificarPasswordCambiada({ usuarioId: 'usuario-afectado', actorId: 'admin-1' });
  const lista = await listarNotificaciones('usuario-afectado');
  assert.equal(lista.length, 1);
  assert.equal(lista[0].tipo, 'PASSWORD_CAMBIADA');
  assert.match(lista[0].titulo, /contraseña fue actualizada/i);
  // Ninguna contraseña de prueba (ni ninguna cadena típica de password) aparece en el mensaje.
  assert.equal(/avon2026/i.test(lista[0].mensaje), false);
  assert.equal(lista[0].actorId, 'admin-1');
});

test('notificarPasswordCambiada: con referenciaId (aprobación de solicitud propia) queda deduplicada por esa referencia', async () => {
  await notificarPasswordCambiada({ usuarioId: 'u1', actorId: 'admin-1', referenciaId: 'solicitud-1' });
  await notificarPasswordCambiada({ usuarioId: 'u1', actorId: 'admin-1', referenciaId: 'solicitud-1' }); // reintento del mismo evento
  assert.equal((await listarNotificaciones('u1')).length, 1);
});

test('notificarSolicitudPasswordRechazada: notifica al usuario que hizo la solicitud', async () => {
  await notificarSolicitudPasswordRechazada({ usuarioId: 'u1', actorId: 'admin-1', solicitudId: 'solicitud-2' });
  const lista = await listarNotificaciones('u1');
  assert.equal(lista.length, 1);
  assert.equal(lista[0].tipo, 'PASSWORD_SOLICITUD_RECHAZADA');
  assert.match(lista[0].titulo, /rechazada/i);
});

/* ============================================================================
 * 4) Rutas: TODOS los endpoints exigen requireAuth (ninguno queda abierto).
 *    Cada endpoint resuelve el destinatario EXCLUSIVAMENTE desde
 *    req.auth.userId — ninguna ruta acepta un id de usuario por parámetro,
 *    así que no existe forma de pedir las notificaciones de otro usuario
 *    vía la API (la única entrada variable es `:id` en marcarLeida, que es
 *    el id de la NOTIFICACIÓN, no de un usuario, y el servicio ya prueba
 *    arriba que eso no cruza usuarios).
 * ========================================================================== */

test('rutas de notificaciones: las 4 exigen requireAuth como primer middleware (ninguna ruta sin proteger)', () => {
  const notificacionesRoutes = require(path.join(distDir, 'routes', 'notificacionesRoutes.js')).default;
  const { requireAuth } = require(path.join(distDir, 'middleware', 'auth.js'));
  const rutasEsperadas = [
    ['get', '/notificaciones/contador'],
    ['get', '/notificaciones'],
    ['patch', '/notificaciones/:id/leida'],
    ['patch', '/notificaciones/leidas']
  ];
  for (const [method, routePath] of rutasEsperadas) {
    const layer = notificacionesRoutes.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
    assert.ok(layer, `No se encontró la ruta ${method.toUpperCase()} ${routePath}`);
    const primero = layer.route.stack[0] && layer.route.stack[0].handle;
    assert.equal(primero, requireAuth, `${method.toUpperCase()} ${routePath} no exige requireAuth como primer middleware`);
  }
});
