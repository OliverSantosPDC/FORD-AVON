'use strict';

/**
 * Pruebas de `eliminarUsuario`/`validarEliminacionMasiva`/`eliminarUsuariosMasivo`
 * (Secciones 1-3, 8-9 y 16 de la tarea): auto-eliminación bloqueada, la regla
 * de Administrador (solo OTRO Administrador puede eliminar a un Administrador,
 * validada en backend), eliminación exitosa sin relaciones huérfanas, manejo
 * seguro del error de Supabase Auth Admin, y eliminación masiva (selección
 * múltiple, caso mixto permitidos/bloqueados sin eliminación parcial
 * silenciosa, idempotencia).
 *
 * Mismo patrón que los demás test/*.test.cjs: código YA COMPILADO en dist/,
 * cliente Supabase falso en memoria (datos 100% ficticios).
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
  roles: [
    { id: 'role-admin', clave: 'administrador', nombre: 'Administrador' },
    { id: 'role-ges', clave: 'gestor', nombre: 'Gestor' }
  ],
  profiles: [
    { id: 'admin-a', email: 'admin.a@example.com', role_id: 'role-admin' },
    { id: 'admin-b', email: 'admin.b@example.com', role_id: 'role-admin' },
    { id: 'user-a', email: 'gestor.qatest@example.com', role_id: 'role-ges' },
    { id: 'user-b', email: 'gestor2.qatest@example.com', role_id: 'role-ges' }
  ],
  gestores: [{ id: 'gestores-row-1', usuario_id: 'user-a', nombre_cartera: 'QA TEST', activo: true }],
  supervisor_gestor: [{ id: 'sg-1', supervisor_id: 'user-a', gestor_id: 'gestores-row-1', activo: true }],
  supervisor_gerente_zona: [],
  liderazgo_supervisor: [],
  gerente_zona_zona: [],
  auditoria: []
};

let deleteUserCalls = [];
let deleteUserResponse = { error: null };

class Builder {
  constructor(table) { this.table = table; this.action = 'select'; this.selectCols = '*'; this.filters = []; this.patch = null; this.wantSingle = false; }
  select(cols) { this.selectCols = cols; return this; }
  eq(col, val) { this.filters.push({ type: 'eq', col, val }); return this; }
  in(col, vals) { this.filters.push({ type: 'in', col, vals }); return this; }
  or(expr) { this.filters.push({ type: 'or', expr }); return this; }
  single() { this.wantSingle = true; return this; }
  update(patch) { this.action = 'update'; this.patch = patch; return this; }
  delete() { this.action = 'delete'; return this; }
  insert(rows) { this.action = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  _match(row) {
    return this.filters.every((f) => {
      if (f.type === 'eq') return String(row[f.col]) === String(f.val);
      if (f.type === 'in') return (f.vals || []).map(String).includes(String(row[f.col]));
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
    if (this.action === 'insert') {
      this.rows.forEach((row) => table.push({ id: row.id || `id-${Math.random()}`, ...row }));
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
const { eliminarUsuario, validarEliminacionMasiva, eliminarUsuariosMasivo, UsuariosError, UsuariosForbiddenError } = require(path.join(distDir, 'services', 'UsuariosService.js'));

test('eliminarUsuario — un usuario NO puede eliminarse a sí mismo (aplica a cualquier rol, incl. Administrador)', async () => {
  await assert.rejects(
    () => eliminarUsuario('admin-a', 'admin-a', 'administrador'),
    (err) => { assert.ok(err instanceof UsuariosForbiddenError); assert.match(err.message, /No puedes eliminar tu propia cuenta/); return true; }
  );
  assert.equal(deleteUserCalls.length, 0, 'no debe haber llamado a Auth Admin');
});

test('eliminarUsuario — regla de Administrador: un Gestor/Supervisor/etc. NO puede eliminar a un Administrador (403)', async () => {
  deleteUserCalls = [];
  await assert.rejects(
    () => eliminarUsuario('admin-a', 'user-b', 'gestor'),
    (err) => {
      assert.ok(err instanceof UsuariosForbiddenError);
      assert.match(err.message, /Solo un Administrador puede eliminar a otro Administrador/);
      return true;
    }
  );
  assert.equal(deleteUserCalls.length, 0, 'no debe haber tocado Auth Admin');
  assert.ok(db.profiles.some((p) => p.id === 'admin-a'), 'admin-a debe seguir existiendo');
});

test('eliminarUsuario — regla de Administrador: OTRO Administrador SÍ puede eliminarlo', async () => {
  deleteUserCalls = [];
  deleteUserResponse = { error: null };
  const result = await eliminarUsuario('admin-a', 'admin-b', 'administrador');
  assert.equal(result.email, 'admin.a@example.com');
  assert.equal(result.roleClave, 'administrador');
  assert.deepEqual(deleteUserCalls, ['admin-a']);
  assert.equal(db.profiles.some((p) => p.id === 'admin-a'), false);
});

test('eliminarUsuario — elimina correctamente y no deja relaciones huérfanas (Gestor)', async () => {
  deleteUserCalls = [];
  deleteUserResponse = { error: null };
  const result = await eliminarUsuario('user-a', 'user-b', 'gestor');
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
    () => eliminarUsuario('user-c', 'user-b', 'gestor'),
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
  const result = await eliminarUsuario('user-c', 'user-b', 'gestor');
  assert.equal(result.email, 'user-c@example.com');
  assert.equal(db.profiles.some((p) => p.id === 'user-c'), false);
});

test('Eliminación masiva — validarEliminacionMasiva separa permitidos/bloqueados sin eliminar nada', async () => {
  db.profiles.push(
    { id: 'ges-1', email: 'ges1@example.com', role_id: 'role-ges' },
    { id: 'ges-2', email: 'ges2@example.com', role_id: 'role-ges' },
    { id: 'admin-c', email: 'admin.c@example.com', role_id: 'role-admin' }
  );
  deleteUserCalls = [];
  const r = await validarEliminacionMasiva(['ges-1', 'ges-2', 'admin-c', 'no-existe'], 'user-b', 'gestor');
  assert.equal(deleteUserCalls.length, 0, 'validar NUNCA debe eliminar nada');
  assert.equal(r.permitidos.length, 2);
  assert.deepEqual(new Set(r.permitidos.map((p) => p.id)), new Set(['ges-1', 'ges-2']));
  assert.equal(r.bloqueados.length, 2);
  const bloqAdmin = r.bloqueados.find((b) => b.id === 'admin-c');
  assert.match(bloqAdmin.motivo, /Solo un Administrador puede eliminar a otro Administrador/);
  const bloqInexistente = r.bloqueados.find((b) => b.id === 'no-existe');
  assert.match(bloqInexistente.motivo, /no encontrado/i);
  // Todos los perfiles deben seguir existiendo: validar es de solo lectura.
  assert.ok(db.profiles.some((p) => p.id === 'ges-1'));
  assert.ok(db.profiles.some((p) => p.id === 'admin-c'));
});

test('Eliminación masiva — selecciona 2 Gestores, se eliminan ambos, verificado en Auth y en profiles', async () => {
  deleteUserCalls = [];
  const r = await eliminarUsuariosMasivo(['ges-1', 'ges-2'], 'user-b', 'gestor');
  assert.equal(r.eliminados.length, 2);
  assert.equal(r.bloqueados.length, 0);
  assert.equal(r.errores.length, 0);
  assert.deepEqual(new Set(deleteUserCalls), new Set(['ges-1', 'ges-2']));
  assert.equal(db.profiles.some((p) => p.id === 'ges-1' || p.id === 'ges-2'), false);
});

test('Eliminación masiva — CASO MIXTO: un Administrador en la selección NO bloquea a los demás, pero él NUNCA se elimina (nunca parcial silenciosa)', async () => {
  db.profiles.push(
    { id: 'ges-3', email: 'ges3@example.com', role_id: 'role-ges' },
    { id: 'ges-4', email: 'ges4@example.com', role_id: 'role-ges' }
  );
  // admin-c ya existe (rol administrador) de la prueba anterior.
  deleteUserCalls = [];
  const r = await eliminarUsuariosMasivo(['ges-3', 'ges-4', 'admin-c'], 'user-b', 'gestor');
  assert.equal(r.eliminados.length, 2);
  assert.deepEqual(new Set(r.eliminados.map((x) => x.id)), new Set(['ges-3', 'ges-4']));
  assert.equal(r.bloqueados.length, 1);
  assert.equal(r.bloqueados[0].id, 'admin-c');
  assert.match(r.bloqueados[0].motivo, /Solo un Administrador puede eliminar a otro Administrador/);
  // admin-c NUNCA se tocó: ni se eliminó de Auth ni de profiles.
  assert.equal(deleteUserCalls.includes('admin-c'), false);
  assert.ok(db.profiles.some((p) => p.id === 'admin-c'), 'admin-c debe seguir existiendo intacto');
});

test('Eliminación masiva — es idempotente: reintentar sobre ids ya eliminados los reporta bloqueados, sin fallar', async () => {
  deleteUserCalls = [];
  const r = await eliminarUsuariosMasivo(['ges-3', 'ges-4'], 'user-b', 'gestor');
  assert.equal(r.eliminados.length, 0);
  assert.equal(r.errores.length, 0);
  assert.equal(r.bloqueados.length, 2);
  r.bloqueados.forEach((b) => assert.match(b.motivo, /no encontrado/i));
  assert.equal(deleteUserCalls.length, 0, 'no debe intentar Auth Admin sobre ids inexistentes');
});
