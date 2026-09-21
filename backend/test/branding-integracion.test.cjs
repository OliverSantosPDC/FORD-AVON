'use strict';

/**
 * Integración Configuración → aplicación (Logo principal, Logo Login,
 * Favicon): valida los DOS puntos de entrada reales que usa el frontend
 * para resolver estos assets, no solo la función de servicio subyacente
 * (esa ya está cubierta en config-assets-imagenes.test.cjs).
 *
 *  - GET /api/branding (brandingRoutes, público, sin sesión): usado por
 *    Login y por el <link rel="icon"> del navegador. Se invoca el handler
 *    real extraído del Router (mismo código que corre en producción), no
 *    una reimplementación.
 *  - GET /configuracion/assets/:clave/url (ConfigController.urlAsset):
 *    usado por el Sidebar/Header para logo_principal. Es la ruta cuyo
 *    permiso se relajó de 'configuracion.ver' a solo requireAuth — este
 *    archivo no re-verifica el middleware (eso es responsabilidad de
 *    configRoutes.ts/auth.ts), solo el comportamiento del handler.
 *
 * Cubre además el caso que config-assets-imagenes.test.cjs no cubre: una
 * clave CON path guardado en config_general pero cuyo archivo ya no existe
 * en Storage (borrado, o falla de createSignedUrl por cualquier motivo) —
 * debe resolver a null en ambos endpoints, nunca lanzar ni romper la
 * pantalla.
 *
 * Ejecutar (tras `npm run build`): node --test test/branding-integracion.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const db = {
  config_general: [
    { clave: 'logo_principal', valor: '', updated_at: null, updated_by: null },
    { clave: 'logo_login', valor: '', updated_at: null, updated_by: null },
    { clave: 'favicon', valor: '', updated_at: null, updated_by: null }
  ]
};
/** Simula el bucket Storage `config-assets`: path -> { contentType, buffer }. */
const storageObjects = new Map();
/** Cuando true, createSignedUrl falla para TODO path (simula expiración/caída de Storage). */
let signedUrlFalla = false;

class Builder {
  constructor(table) {
    this.table = table;
    this.action = 'select';
    this.filters = [];
    this.patch = null;
    this.rows = null;
    this.wantMaybeSingle = false;
  }
  select() { return this; }
  eq(col, val) { this.filters.push({ col, val }); return this; }
  maybeSingle() { this.wantMaybeSingle = true; return this; }
  update(patch) { this.action = 'update'; this.patch = patch; return this; }
  upsert(rows, opts) { this.action = 'upsert'; this.rows = Array.isArray(rows) ? rows : [rows]; this.conflictCol = (opts && opts.onConflict) || 'id'; return this; }
  _match(row) { return this.filters.every((f) => String(row[f.col]) === String(f.val)); }
  then(resolve, reject) {
    let result;
    try { result = this._exec(); } catch (e) { result = { data: null, error: { message: String((e && e.message) || e) } }; }
    return Promise.resolve(result).then(resolve, reject);
  }
  _exec() {
    if (!db[this.table]) db[this.table] = [];
    const table = db[this.table];
    if (this.action === 'select') {
      const rows = table.filter((r) => this._match(r)).map((r) => ({ ...r }));
      if (this.wantMaybeSingle) return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    }
    if (this.action === 'upsert') {
      for (const row of this.rows) {
        const idx = table.findIndex((r) => String(r[this.conflictCol]) === String(row[this.conflictCol]));
        if (idx >= 0) Object.assign(table[idx], row); else table.push({ ...row });
      }
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }
}

const fakeStorageBucket = {
  upload: async (p, buffer, opts) => {
    if (storageObjects.has(p)) return { data: null, error: { message: 'ya existe' } };
    storageObjects.set(p, { buffer, contentType: opts && opts.contentType });
    return { data: { path: p }, error: null };
  },
  remove: async (paths) => { paths.forEach((p) => storageObjects.delete(p)); return { data: null, error: null }; },
  createSignedUrl: async (p, ttl) => {
    if (signedUrlFalla) return { data: null, error: { message: 'signed url expirada/Storage no disponible (simulado)' } };
    if (!storageObjects.has(p)) return { data: null, error: { message: 'no encontrado' } };
    return { data: { signedUrl: `https://signed.example.invalid/${p}?ttl=${ttl}` }, error: null };
  }
};

const fakeClient = {
  from: (t) => new Builder(t),
  storage: { from: () => fakeStorageBucket }
};

const supabaseJsPath = require.resolve('@supabase/supabase-js');
const fakeModule = new Module(supabaseJsPath);
fakeModule.exports = { createClient: () => fakeClient };
fakeModule.loaded = true;
require.cache[supabaseJsPath] = fakeModule;

const distDir = path.join(__dirname, '..', 'dist');
const { subirAsset } = require(path.join(distDir, 'services', 'ConfigService.js'));
const brandingRouter = require(path.join(distDir, 'routes', 'brandingRoutes.js')).default;
const { ConfigController } = require(path.join(distDir, 'controllers', 'ConfigController.js'));

// Extrae el handler real registrado por el Router (mismo código que corre
// montado en main.ts), en vez de reimplementar la lógica del endpoint.
const brandingHandler = brandingRouter.stack.find((l) => l.route && l.route.path === '/branding').route.stack[0].handle;

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

test('GET /api/branding: sin ninguna imagen configurada, responde { logoLogin: null, favicon: null } sin lanzar', async () => {
  const res = mockRes();
  await brandingHandler({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { logoLogin: null, favicon: null });
});

test('GET /api/branding: con logo_login y favicon configurados, resuelve ambas URLs reales', async () => {
  const login = await subirAsset('logo_login', 'login.png', Buffer.from('x'), 'image/png', 'admin-1');
  const fav = await subirAsset('favicon', 'fav.png', Buffer.from('y'), 'image/png', 'admin-1');

  const res = mockRes();
  await brandingHandler({}, res);

  assert.ok(res.body.logoLogin && res.body.logoLogin.includes(login.path), 'logoLogin debe apuntar al path recién guardado');
  assert.ok(res.body.favicon && res.body.favicon.includes(fav.path), 'favicon debe apuntar al path recién guardado');
});

test('GET /api/branding: nunca expone logo_principal (solo logoLogin/favicon, ninguna clave arbitraria)', async () => {
  const res = mockRes();
  await brandingHandler({}, res);
  assert.deepEqual(Object.keys(res.body).sort(), ['favicon', 'logoLogin']);
});

test('GET /api/branding: si Storage falla al firmar la URL (expirada/no disponible), responde null en vez de lanzar', async () => {
  signedUrlFalla = true;
  try {
    const res = mockRes();
    await brandingHandler({}, res);
    assert.equal(res.statusCode, 200, 'debe responder 200 igual, nunca un 500 por esto');
    assert.deepEqual(res.body, { logoLogin: null, favicon: null });
  } finally {
    signedUrlFalla = false;
  }
});

test('ConfigController.urlAsset (usado por Sidebar/Header para logo_principal): resuelve la URL cuando está configurado', async () => {
  const subida = await subirAsset('logo_principal', 'principal.png', Buffer.from('z'), 'image/png', 'admin-1');
  const controller = new ConfigController();
  const res = mockRes();
  await controller.urlAsset({ params: { clave: 'logo_principal' } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.url && res.body.url.includes(subida.path));
});

test('ConfigController.urlAsset: clave sin configurar responde { url: null }, no un error', async () => {
  const controller = new ConfigController();
  const res = mockRes();
  await controller.urlAsset({ params: { clave: 'clave_nunca_configurada' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { url: null });
});

test('ConfigController.urlAsset: path guardado pero archivo ya no existe en Storage (borrado) responde { url: null }, nunca rompe', async () => {
  const subida = await subirAsset('logo_principal', 'sera-borrado.png', Buffer.from('w'), 'image/png', 'admin-1');
  storageObjects.delete(subida.path); // simula que el archivo desapareció de Storage sin que config_general se enterara

  const controller = new ConfigController();
  const res = mockRes();
  await controller.urlAsset({ params: { clave: 'logo_principal' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { url: null });
});
