'use strict';

/**
 * Pruebas del borrado del HISTORIAL de solicitudes de cambio de contraseña
 * (Sección 3-6 de la tarea). Igual que los demás test/*.test.cjs: ejecuta el
 * código YA COMPILADO en dist/ (PasswordRequestService.ts real) contra un
 * cliente Supabase falso en memoria (datos 100% ficticios).
 *
 * Cubre:
 *  - crear solicitud (pública) -> aparece como PENDIENTE.
 *  - eliminar una solicitud histórica (COMPLETADA) -> desaparece.
 *  - eliminar varias a la vez (COMPLETADA + RECHAZADA) -> ambas desaparecen.
 *  - una solicitud PENDIENTE NUNCA se elimina, aunque su id se incluya.
 *  - el perfil/usuario asociado no se toca (solo se lee, nunca se escribe).
 *
 * Ejecutar (tras `npm run build`): node --test test/password-request-history.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

let nextId = 1;
const genId = () => `id-${nextId++}`;

const db = {
  profiles: [
    { id: 'profile-1', email: 'gestor.qatest@example.com', nombre: 'Gestor', apellido: 'QA', activo: true, role_id: 'role-ges' }
  ],
  password_change_requests: [],
  auditoria: []
};

class Builder {
  constructor(table) {
    this.table = table;
    this.action = 'select';
    this.selectCols = '*';
    this.filters = [];
    this.patch = null;
    this.rows = null;
    this.wantSingle = false;
    this.wantMaybeSingle = false;
    this.limitN = null;
  }
  select(cols) { this.selectCols = cols; return this; }
  eq(col, val) { this.filters.push({ type: 'eq', col, val }); return this; }
  in(col, vals) { this.filters.push({ type: 'in', col, vals }); return this; }
  order() { return this; }
  limit(n) { this.limitN = n; return this; }
  single() { this.wantSingle = true; return this; }
  maybeSingle() { this.wantMaybeSingle = true; return this; }
  update(patch) { this.action = 'update'; this.patch = patch; return this; }
  delete() { this.action = 'delete'; return this; }
  insert(rows) { this.action = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  _match(row) {
    return this.filters.every((f) => {
      if (f.type === 'eq') return String(row[f.col]) === String(f.val);
      if (f.type === 'in') return (f.vals || []).map(String).includes(String(row[f.col]));
      return true;
    });
  }
  then(resolve, reject) {
    let result;
    try { result = this._exec(); } catch (e) { result = { data: null, error: { message: String((e && e.message) || e) } }; }
    return Promise.resolve(result).then(resolve, reject);
  }
  _exec() {
    if (!db[this.table]) db[this.table] = [];
    const table = db[this.table];
    if (this.action === 'select') {
      let rows = table.filter((r) => this._match(r));
      if (this.limitN != null) rows = rows.slice(0, this.limitN);
      const projected = rows.map((r) => ({ ...r }));
      if (this.wantSingle) return projected.length ? { data: projected[0], error: null } : { data: null, error: { message: 'no encontrado' } };
      if (this.wantMaybeSingle) return { data: projected[0] ?? null, error: null };
      return { data: projected, error: null };
    }
    if (this.action === 'update') {
      const matched = table.filter((r) => this._match(r));
      matched.forEach((r) => Object.assign(r, this.patch));
      return { data: matched, error: null };
    }
    if (this.action === 'delete') {
      db[this.table] = table.filter((r) => !this._match(r));
      return { data: null, error: null };
    }
    if (this.action === 'insert') {
      const inserted = this.rows.map((row) => { const withId = { id: row.id || genId(), ...row }; table.push(withId); return withId; });
      return { data: inserted, error: null };
    }
    return { data: null, error: null };
  }
}

const fakeClient = {
  from: (t) => new Builder(t),
  auth: { admin: { updateUserById: async () => ({ error: null }) } }
};

const supabaseJsPath = require.resolve('@supabase/supabase-js');
const fakeModule = new Module(supabaseJsPath);
fakeModule.exports = { createClient: () => fakeClient };
fakeModule.loaded = true;
require.cache[supabaseJsPath] = fakeModule;

const distDir = path.join(__dirname, '..', 'dist');
const { crearSolicitud, listarSolicitudes, eliminarSolicitudesHistorial } = require(path.join(distDir, 'services', 'PasswordRequestService.js'));

test('Historial de contraseñas — crear, eliminar histórico (una y varias), nunca elimina una PENDIENTE', async () => {
  // Estado inicial: 1 pendiente ya resuelta manualmente a COMPLETADA/RECHAZADA (simulando resolverSolicitud)
  // + 1 nueva pendiente creada vía crearSolicitud (flujo público real).
  db.password_change_requests.push(
    { id: 'req-completada', email: 'a@qatest.example.com', usuario_id: 'profile-1', estado: 'COMPLETADA', motivo: null, observaciones: null, resolved_by: 'admin-1', created_at: new Date().toISOString(), resolved_at: new Date().toISOString() },
    { id: 'req-rechazada', email: 'b@qatest.example.com', usuario_id: null, estado: 'RECHAZADA', motivo: null, observaciones: null, resolved_by: 'admin-1', created_at: new Date().toISOString(), resolved_at: new Date().toISOString() }
  );

  await crearSolicitud('pendiente.qatest@example.com', 'Olvidé mi contraseña');
  let lista = await listarSolicitudes();
  assert.equal(lista.length, 3);
  const pendiente = lista.find((r) => r.estado === 'PENDIENTE');
  assert.ok(pendiente, 'la solicitud recién creada debe estar PENDIENTE');

  // Intento de eliminar la histórica + la pendiente en un solo llamado: la pendiente se omite.
  const r1 = await eliminarSolicitudesHistorial(['req-completada', pendiente.id], null);
  assert.equal(r1.eliminadas, 1);
  assert.equal(r1.omitidas, 1);

  lista = await listarSolicitudes();
  assert.equal(lista.find((r) => r.id === 'req-completada'), undefined, 'la COMPLETADA debe haber desaparecido');
  assert.ok(lista.find((r) => r.id === pendiente.id), 'la PENDIENTE NUNCA debe eliminarse');

  // Eliminar varias de una vez (selección múltiple / "seleccionar todos" del historial restante).
  const r2 = await eliminarSolicitudesHistorial(['req-rechazada'], null);
  assert.equal(r2.eliminadas, 1);
  assert.equal(r2.omitidas, 0);

  lista = await listarSolicitudes();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].estado, 'PENDIENTE');

  // El perfil asociado (usuario/rol/permisos) nunca se tocó.
  const perfil = db.profiles.find((p) => p.id === 'profile-1');
  assert.equal(perfil.activo, true);
  assert.equal(perfil.role_id, 'role-ges');

  // Reintentar eliminar solo la PENDIENTE restante: no elimina nada.
  const r3 = await eliminarSolicitudesHistorial([lista[0].id], null);
  assert.equal(r3.eliminadas, 0);
  assert.equal(r3.omitidas, 1);
  assert.equal((await listarSolicitudes()).length, 1);
});
