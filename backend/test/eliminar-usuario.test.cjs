'use strict';

/**
 * Pruebas de `eliminarUsuario` (Sección 1-2 y 14-A de la tarea): auto-eliminación
 * bloqueada, eliminación exitosa sin dejar relaciones huérfanas, y manejo
 * seguro del error de Supabase Auth Admin (nunca expone el "{}" crudo).
 * Mismo patrón que los demás test/*.test.cjs: código YA COMPILADO en dist/,
 * cliente Supabase falso en memoria (datos ficticios).
 *
 * Ejecutar (tras `npm run build`): node --test test/eliminar-usuario.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const db = {
  roles: [{ id: 'role-ges', clave: 'gestor', nombre: 'Gestor' }],
  profiles: [
    { id: 'user-a', email: 'gestor.qatest@example.com', role_id: 'role-ges' },
    { id: 'user-b', email: 'gestor2.qatest@example.com', role_id: 'role-ges' }
  ],
  gestores: [{ id: 'gestores-row-1', usuario_id: 'user-a', nombre_cartera: 'QA TEST', activo: true }],
  supervisor_gestor: [{ id: 'sg-1', supervisor_id: 'user-a', gestor_id: 'gestores-row-1', activo: true }],
  supervisor_gerente_zona: [],
  liderazgo_supervisor: [],
  gerente_zona_zona: []
};

let deleteUserCalls = [];
let deleteUserResponse = { error: null };

class Builder {
  constructor(table) { this.table = table; this.action = 'select'; this.selectCols = '*'; this.filters = []; this.patch = null; this.wantSingle = false; }
  select(cols) { this.selectCols = cols; return this; }
  eq(col, val) { this.filters.push({ type: 'eq', col, val }); return this; }
  or(expr) { this.filters.push({ type: 'or', expr }); return this; }
  single() { this.wantSingle = true; return this; }
  update(patch) { this.action = 'update'; this.patch = patch; return this; }
  delete() { this.action = 'delete'; return this; }
  _match(row) {
    return this.filters.every((f) => {
      if (f.type === 'eq') return String(row[f.col]) === String(f.val);
      if (f.type === 'or') return f.expr.split(',').some((clause) => {
        const m = clause.match(/^([\w.]+)\.eq\.(.+)$/);
        return m && String(row[m[1]]) === String(m[2]);
      });
      return true;
    });
  }
  _project(row) {
    if (this.table === 'profiles' && this.selectCols.includes('roles')) {
      const rol = db.roles.find((r) => r.id === row.role_id);
      return { ...row, roles: rol ? { clave: rol.clave, nombre: rol.nombre } : null };
    }
    return { ...row };
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
      const rows = table.filter((r) => this._match(r)).map((r) => this._project(r));
      if (this.wantSingle) return rows.length ? { data: rows[0], error: null } : { data: null, error: { message: 'no encontrado' } };
      return { data: rows, error: null };
    }
    if (this.action === 'update') {
      table.filter((r) => this._match(r)).forEach((r) => Object.assign(r, this.patch));
      return { data: null, error: null };
    }
    if (this.action === 'delete') {
      db[this.table] = table.filter((r) => !this._match(r));
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }
}

const fakeClient = {
  from: (t) => new Builder(t),
  auth: {
    admin: {
      deleteUser: async (id) => { deleteUserCalls.push(id); return deleteUserResponse; }
    }
  }
};

const supabaseJsPath = require.resolve('@supabase/supabase-js');
const fakeModule = new Module(supabaseJsPath);
fakeModule.exports = { createClient: () => fakeClient };
fakeModule.loaded = true;
require.cache[supabaseJsPath] = fakeModule;

const distDir = path.join(__dirname, '..', 'dist');
const { eliminarUsuario, UsuariosError } = require(path.join(distDir, 'services', 'UsuariosService.js'));

test('eliminarUsuario — un Administrador no puede eliminarse a sí mismo', async () => {
  await assert.rejects(
    () => eliminarUsuario('user-a', 'user-a'),
    (err) => { assert.ok(err instanceof UsuariosError); assert.match(err.message, /No puedes eliminar tu propia cuenta/); return true; }
  );
  assert.equal(deleteUserCalls.length, 0, 'no debe haber llamado a Auth Admin');
});

test('eliminarUsuario — elimina correctamente y no deja relaciones huérfanas', async () => {
  deleteUserCalls = [];
  deleteUserResponse = { error: null };
  const result = await eliminarUsuario('user-a', 'user-b');
  assert.equal(result.email, 'gestor.qatest@example.com');
  assert.equal(result.roleClave, 'gestor');
  assert.deepEqual(deleteUserCalls, ['user-a']);
  assert.equal(db.profiles.some((p) => p.id === 'user-a'), false, 'el perfil debe quedar eliminado');
  assert.equal(db.supervisor_gestor.some((r) => r.supervisor_id === 'user-a'), false, 'sin relaciones huérfanas en supervisor_gestor');
  assert.equal(db.gestores.find((g) => g.id === 'gestores-row-1').usuario_id, null, 'gestores.usuario_id debe quedar desvinculado, no huérfano');
});

test('eliminarUsuario — un error "{}" de Auth Admin nunca llega crudo al usuario', async () => {
  db.profiles.push({ id: 'user-c', email: 'user-c@example.com', role_id: 'role-ges' });
  deleteUserCalls = [];
  deleteUserResponse = { error: { name: 'AuthApiError', message: '{}', status: 500 } };
  await assert.rejects(
    () => eliminarUsuario('user-c', 'user-b'),
    (err) => {
      assert.ok(err instanceof UsuariosError);
      assert.equal(err.message.includes('{}'), false, `el mensaje no debe contener "{}" crudo: ${err.message}`);
      assert.match(err.message, /No se pudo eliminar el usuario de Auth/);
      assert.match(err.message, /estado HTTP: 500/);
      return true;
    }
  );
});

test('eliminarUsuario — un usuario ya inexistente en Auth (404 / user_not_found) NO bloquea la eliminación', async () => {
  deleteUserCalls = [];
  deleteUserResponse = { error: { name: 'AuthApiError', message: 'User not found', status: 404, code: 'user_not_found' } };
  const result = await eliminarUsuario('user-c', 'user-b');
  assert.equal(result.email, 'user-c@example.com');
  assert.equal(db.profiles.some((p) => p.id === 'user-c'), false);
});
