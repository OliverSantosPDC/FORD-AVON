'use strict';

/**
 * Política de contraseña temporal administrativa (Avon2026, 15 días).
 * Ejecuta el código YA COMPILADO en dist/ contra un cliente Supabase falso en
 * memoria (mismo patrón que branding-integracion.test.cjs / config-assets-
 * imagenes.test.cjs) y, para requireAuth, un JwtVerifier falso (evita
 * depender de JWKS/red real).
 *
 * Cubre:
 *  1) Administrador NO puede recibir la contraseña temporal (backend re-valida,
 *     nunca confía en el frontend).
 *  2) Usuario normal SÍ puede recibirla — Avon2026 se envía a Supabase Auth,
 *     nunca se guarda en profiles.
 *  3) Vencimiento de exactamente 15 días queda registrado.
 *  4) must_change_password / is_temporary_password quedan en true.
 *  5) loadAuthContext calcula passwordPolicy (mustChangePassword/expired/
 *     diasRestantes) correctamente: recién asignada (15), a mitad de vigencia,
 *     vencida, y "nunca tuvo contraseña temporal" (todo en false/null — no
 *     rompe el login normal).
 *  6) requireAuth bloquea CUALQUIER ruta no permitida cuando expiró, permite
 *     las rutas de auto-servicio (/auth/me, /auth/password-changed,
 *     /auth/event), y no bloquea nada mientras la temporal sigue vigente.
 *  7) limpiarEstadoPasswordTemporal borra los 4 metadatos (nunca la contraseña,
 *     que nunca estuvo ahí).
 *  8) No se persiste 'Avon2026' en texto plano en ninguna fila de `profiles`.
 *
 * Ejecutar (tras `npm run build`): node --test test/password-temporal-policy.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'test-jwt-secret';

const ADMIN_ROLE_ID = 'role-admin';
const GESTOR_ROLE_ID = 'role-gestor';

const db = {
  profiles: [
    {
      id: 'admin-1', email: 'admin@ford-avon.test', nombre: 'Ada', apellido: 'Min', activo: true, role_id: ADMIN_ROLE_ID,
      is_temporary_password: false, must_change_password: false, temporary_password_created_at: null, temporary_password_expires_at: null
    },
    {
      id: 'user-1', email: 'gestor@ford-avon.test', nombre: 'Greta', apellido: 'Gestor', activo: true, role_id: GESTOR_ROLE_ID,
      is_temporary_password: false, must_change_password: false, temporary_password_created_at: null, temporary_password_expires_at: null
    },
    {
      id: 'user-nunca-temporal', email: 'normal@ford-avon.test', nombre: 'Nora', apellido: 'Normal', activo: true, role_id: GESTOR_ROLE_ID,
      is_temporary_password: false, must_change_password: false, temporary_password_created_at: null, temporary_password_expires_at: null
    }
  ],
  roles: [
    { id: ADMIN_ROLE_ID, clave: 'administrador', nombre: 'Administrador' },
    { id: GESTOR_ROLE_ID, clave: 'gestor', nombre: 'Gestor' }
  ],
  role_permissions: [],
  permissions: [],
  auditoria: []
};

/** auth.users falso: id -> password vigente (solo para verificar QUÉ se envió; nunca se lee desde profiles). */
const authUsersPasswords = new Map();

class Builder {
  constructor(table) {
    this.table = table;
    this.action = 'select';
    this.filters = [];
    this.patch = null;
    this.wantSingle = false;
    this.wantMaybeSingle = false;
  }
  select() { return this; }
  eq(col, val) { this.filters.push({ col, val }); return this; }
  in(col, vals) { this.filters.push({ col, val: vals, isIn: true }); return this; }
  single() { this.wantSingle = true; return this; }
  maybeSingle() { this.wantMaybeSingle = true; return this; }
  update(patch) { this.action = 'update'; this.patch = patch; return this; }
  insert(rows) { this.action = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  // No-ops encadenables: las tablas de alcance (gestor_pais_zona, gerente_zona_zona,
  // etc.) están vacías en este fixture — ScopeService debe resolver un alcance
  // vacío sin error para cualquier rol, esto solo evita que falte un método.
  or() { return this; }
  is() { return this; }
  lte() { return this; }
  gte() { return this; }
  order() { return this; }
  limit() { return this; }
  range() { return this; }
  not() { return this; }
  _match(row) {
    return this.filters.every((f) => (f.isIn ? f.val.map(String).includes(String(row[f.col])) : String(row[f.col]) === String(f.val)));
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
      let rows = table.filter((r) => this._match(r)).map((r) => ({ ...r }));
      // Simula el join `roles ( clave, nombre )` para `profiles`.
      if (this.table === 'profiles') {
        rows = rows.map((r) => ({ ...r, roles: db.roles.find((ro) => ro.id === r.role_id) ?? null }));
      }
      if (this.wantSingle || this.wantMaybeSingle) return { data: rows[0] ?? null, error: (this.wantSingle && !rows[0]) ? { message: 'no encontrado' } : null };
      return { data: rows, error: null };
    }
    if (this.action === 'update') {
      const afectadas = table.filter((r) => this._match(r));
      afectadas.forEach((r) => Object.assign(r, this.patch));
      return { data: null, error: null };
    }
    if (this.action === 'insert') {
      this.rows.forEach((r) => table.push({ ...r }));
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }
}

const fakeClient = {
  from: (t) => new Builder(t),
  auth: {
    admin: {
      updateUserById: async (id, attrs) => {
        if (attrs.password) authUsersPasswords.set(id, attrs.password);
        return { data: { user: { id } }, error: null };
      }
    }
  }
};

const supabaseJsPath = require.resolve('@supabase/supabase-js');
const fakeSupabaseModule = new Module(supabaseJsPath);
fakeSupabaseModule.exports = { createClient: () => fakeClient };
fakeSupabaseModule.loaded = true;
require.cache[supabaseJsPath] = fakeSupabaseModule;

const distDir = path.join(__dirname, '..', 'dist');

// Fake de JwtVerifier: requireAuth solo necesita resolver un userId a partir
// del token — aquí el "token" ES el userId, sin firma/red real.
const jwtVerifierPath = path.join(distDir, 'services', 'JwtVerifier.js');
const fakeJwtModule = new Module(jwtVerifierPath);
fakeJwtModule.exports = {
  verifySupabaseToken: async (token) => ({ userId: token }),
  tokenDiagnostics: () => ({})
};
fakeJwtModule.loaded = true;
fakeJwtModule.filename = jwtVerifierPath;
require.cache[jwtVerifierPath] = fakeJwtModule;

const {
  restablecerPasswordTemporal,
  limpiarEstadoPasswordTemporal,
  UsuariosForbiddenError
} = require(path.join(distDir, 'services', 'UsuariosService.js'));
const { loadAuthContext } = require(path.join(distDir, 'services', 'PerfilService.js'));
const { requireAuth } = require(path.join(distDir, 'middleware', 'auth.js'));

const DIA_MS = 24 * 60 * 60 * 1000;

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

test('restablecerPasswordTemporal: rechaza a un usuario con rol administrador', async () => {
  await assert.rejects(() => restablecerPasswordTemporal('admin-1'), UsuariosForbiddenError);
  assert.equal(authUsersPasswords.has('admin-1'), false, 'nunca debe llamar a Supabase Auth para un administrador');
  const perfil = db.profiles.find((p) => p.id === 'admin-1');
  assert.equal(perfil.must_change_password, false, 'el estado temporal de un administrador nunca se activa');
});

test('restablecerPasswordTemporal: usuario NO administrador recibe Avon2026, con vencimiento de exactamente 15 días', async () => {
  const antes = Date.now();
  const { email, expiresAt } = await restablecerPasswordTemporal('user-1');
  const despues = Date.now();

  assert.equal(email, 'gestor@ford-avon.test');
  assert.equal(authUsersPasswords.get('user-1'), 'Avon2026', 'Supabase Auth debe recibir exactamente la contraseña fija Avon2026');

  const perfil = db.profiles.find((p) => p.id === 'user-1');
  assert.equal(perfil.is_temporary_password, true);
  assert.equal(perfil.must_change_password, true);
  assert.ok(perfil.temporary_password_created_at, 'debe registrar fecha/hora de inicio');
  assert.ok(perfil.temporary_password_expires_at, 'debe registrar fecha/hora de vencimiento');

  const creadoMs = new Date(perfil.temporary_password_created_at).getTime();
  const vencMs = new Date(perfil.temporary_password_expires_at).getTime();
  assert.equal(vencMs - creadoMs, 15 * DIA_MS, 'la vigencia debe ser de EXACTAMENTE 15 días, no aproximada');
  assert.ok(creadoMs >= antes && creadoMs <= despues, 'temporary_password_created_at debe ser "ahora" real, no un valor inventado');
  assert.equal(new Date(expiresAt).getTime(), vencMs, 'el valor devuelto al controller debe coincidir con lo persistido');
});

test('No se almacena Avon2026 en texto plano en ninguna fila de profiles', () => {
  for (const fila of db.profiles) {
    for (const valor of Object.values(fila)) {
      if (typeof valor === 'string') assert.equal(valor.includes('Avon2026'), false, `profiles no debe contener la contraseña en texto plano: ${JSON.stringify(fila)}`);
    }
  }
});

test('limpiarEstadoPasswordTemporal: borra los 4 metadatos de vigencia (nunca hubo contraseña que borrar)', async () => {
  await limpiarEstadoPasswordTemporal('user-1');
  const perfil = db.profiles.find((p) => p.id === 'user-1');
  assert.deepEqual(
    { a: perfil.is_temporary_password, b: perfil.must_change_password, c: perfil.temporary_password_created_at, d: perfil.temporary_password_expires_at },
    { a: false, b: false, c: null, d: null }
  );
});

test('loadAuthContext: usuario que NUNCA tuvo contraseña temporal -> passwordPolicy inerte (no rompe el login normal)', async () => {
  const ctx = await loadAuthContext('user-nunca-temporal');
  assert.deepEqual(ctx.passwordPolicy, {
    mustChangePassword: false,
    isTemporaryPassword: false,
    temporaryPasswordCreatedAt: null,
    temporaryPasswordExpiresAt: null,
    expired: false,
    diasRestantes: null
  });
});

test('loadAuthContext: contraseña temporal recién asignada -> 15 días restantes, no vencida', async () => {
  const perfil = db.profiles.find((p) => p.id === 'user-1');
  const ahora = new Date();
  Object.assign(perfil, {
    is_temporary_password: true,
    must_change_password: true,
    temporary_password_created_at: ahora.toISOString(),
    temporary_password_expires_at: new Date(ahora.getTime() + 15 * DIA_MS).toISOString()
  });
  const ctx = await loadAuthContext('user-1');
  assert.equal(ctx.passwordPolicy.mustChangePassword, true);
  assert.equal(ctx.passwordPolicy.expired, false);
  assert.equal(ctx.passwordPolicy.diasRestantes, 15);
});

test('loadAuthContext: a mitad de vigencia (7 días y unas horas restantes) -> diasRestantes=8 (techo, no aproximado)', async () => {
  const perfil = db.profiles.find((p) => p.id === 'user-1');
  const ahora = Date.now();
  Object.assign(perfil, {
    is_temporary_password: true,
    must_change_password: true,
    temporary_password_created_at: new Date(ahora - 7 * DIA_MS).toISOString(),
    // Quedan 8 días y unas horas: Math.ceil debe dar 8 (nunca 7, nunca redondeado "aprox" a 7.5).
    temporary_password_expires_at: new Date(ahora + 7 * DIA_MS + 3 * 60 * 60 * 1000).toISOString()
  });
  const ctx = await loadAuthContext('user-1');
  assert.equal(ctx.passwordPolicy.expired, false);
  assert.equal(ctx.passwordPolicy.diasRestantes, 8);
});

test('loadAuthContext: contraseña temporal VENCIDA -> expired=true, diasRestantes=0', async () => {
  const perfil = db.profiles.find((p) => p.id === 'user-1');
  const ahora = Date.now();
  Object.assign(perfil, {
    is_temporary_password: true,
    must_change_password: true,
    temporary_password_created_at: new Date(ahora - 20 * DIA_MS).toISOString(),
    temporary_password_expires_at: new Date(ahora - 5 * DIA_MS).toISOString()
  });
  const ctx = await loadAuthContext('user-1');
  assert.equal(ctx.passwordPolicy.expired, true);
  assert.equal(ctx.passwordPolicy.diasRestantes, 0);
});

/* ===== requireAuth: bloqueo real por contraseña temporal vencida ===== */

function mockReq(userId, originalUrl) {
  return { headers: { authorization: `Bearer ${userId}` }, originalUrl };
}

test('requireAuth: usuario con contraseña temporal VIGENTE (no vencida) NO es bloqueado en ninguna ruta', async () => {
  const perfil = db.profiles.find((p) => p.id === 'user-1');
  const ahora = Date.now();
  Object.assign(perfil, {
    must_change_password: true,
    temporary_password_expires_at: new Date(ahora + 10 * DIA_MS).toISOString()
  });
  const req = mockReq('user-1', '/api/dashboard');
  const res = mockRes();
  let nextCalled = false;
  await requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true, 'mientras no venza, el resto de la app debe seguir funcionando normalmente');
  assert.equal(res.body, null, 'no debe responder nada por su cuenta si deja pasar');
});

test('requireAuth: contraseña temporal VENCIDA bloquea una ruta cualquiera (p. ej. /api/dashboard) con 403', async () => {
  const perfil = db.profiles.find((p) => p.id === 'user-1');
  Object.assign(perfil, {
    must_change_password: true,
    temporary_password_expires_at: new Date(Date.now() - DIA_MS).toISOString()
  });
  const req = mockReq('user-1', '/api/dashboard');
  const res = mockRes();
  let nextCalled = false;
  await requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false, 'ninguna ruta ajena a cambiar la contraseña debe ejecutarse mientras está vencida');
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'PASSWORD_TEMPORAL_VENCIDA');
});

test('requireAuth: contraseña temporal VENCIDA NO bloquea /api/auth/me, /api/auth/password-changed ni /api/auth/event (nunca deja al usuario sin salida)', async () => {
  const perfil = db.profiles.find((p) => p.id === 'user-1');
  Object.assign(perfil, {
    must_change_password: true,
    temporary_password_expires_at: new Date(Date.now() - DIA_MS).toISOString()
  });
  for (const ruta of ['/api/auth/me', '/api/auth/password-changed', '/api/auth/event']) {
    const req = mockReq('user-1', ruta);
    const res = mockRes();
    let nextCalled = false;
    // eslint-disable-next-line no-await-in-loop
    await requireAuth(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true, `${ruta} debe seguir siendo alcanzable aunque la contraseña haya vencido`);
  }
});

test('requireAuth: usuario que nunca tuvo contraseña temporal navega con normalidad (login normal no se rompe)', async () => {
  const req = mockReq('user-nunca-temporal', '/api/dashboard');
  const res = mockRes();
  let nextCalled = false;
  await requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.body, null);
});
