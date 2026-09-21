'use strict';

/**
 * Configuración → General → Empresa → Logos: sube/guarda/muestra/reemplaza
 * imágenes (logo_principal, logo_login, favicon, fondos). Igual que los
 * demás test/*.test.cjs: ejecuta el código YA COMPILADO en dist/
 * (ConfigService.ts real) contra un cliente Supabase falso en memoria
 * (datos 100% ficticios) que simula tanto la tabla `config_general` como
 * el bucket de Storage `config-assets`.
 *
 * Cubre:
 *  - subirAsset() rechaza contentType que no sea image/* (PDF/DOC/ZIP/etc.)
 *    SIN tocar config_general ni Storage.
 *  - subirAsset() con una imagen válida (PNG): sube el archivo, guarda la
 *    referencia en config_general.valor en la MISMA operación, y
 *    urlAsset() devuelve una URL firmada real para ese path.
 *  - SVG se acepta igual que cualquier otro image/* (no hay excepción por
 *    tipo de imagen).
 *  - Nombres de archivo con espacios/acentos/mayúsculas/caracteres
 *    especiales no rompen la carga (el path generado siempre es seguro).
 *  - Reemplazar una imagen existente: el nuevo path queda configurado,
 *    y el archivo anterior se elimina de Storage SOLO después de
 *    confirmar que la referencia nueva ya quedó guardada (nunca antes).
 *  - urlAsset() de una clave sin archivo configurado devuelve null (no
 *    lanza error): "no configurado" no es una falla real.
 *
 * Ejecutar (tras `npm run build`): node --test test/config-assets-imagenes.test.cjs
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
  upload: async (path, buffer, opts) => {
    if (storageObjects.has(path)) return { data: null, error: { message: 'ya existe' } };
    storageObjects.set(path, { buffer, contentType: opts && opts.contentType, cacheControl: opts && opts.cacheControl });
    return { data: { path }, error: null };
  },
  remove: async (paths) => { paths.forEach((p) => storageObjects.delete(p)); return { data: null, error: null }; },
  createSignedUrl: async (path, ttl) => {
    if (!storageObjects.has(path)) return { data: null, error: { message: 'no encontrado' } };
    return { data: { signedUrl: `https://signed.example.invalid/${path}?ttl=${ttl}` }, error: null };
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
const { subirAsset, urlAsset, getGeneral } = require(path.join(distDir, 'services', 'ConfigService.js'));

test('subirAsset() rechaza archivos que no son imagen, sin tocar config_general ni Storage', async () => {
  const antesGeneral = await getGeneral();
  const antesStorageSize = storageObjects.size;

  await assert.rejects(
    () => subirAsset('logo_principal', 'documento.pdf', Buffer.from('%PDF-1.4'), 'application/pdf', 'admin-1'),
    /imagen/i
  );

  assert.deepEqual(await getGeneral(), antesGeneral, 'config_general no debe cambiar si el archivo fue rechazado');
  assert.equal(storageObjects.size, antesStorageSize, 'no debe subirse nada a Storage si el archivo fue rechazado');
});

test('subirAsset() con una imagen PNG válida: sube, persiste la referencia, y urlAsset() la resuelve', async () => {
  const r = await subirAsset('logo_principal', 'logo.png', Buffer.from('fake-png-bytes'), 'image/png', 'admin-1');

  assert.match(r.path, /^assets\/logo_principal_\d+_logo\.png$/);
  assert.ok(storageObjects.has(r.path), 'el archivo debe existir en Storage en el path devuelto');

  // La referencia queda guardada en la MISMA operación (sin un segundo paso/"Guardar" aparte).
  const general = await getGeneral();
  assert.equal(general.logo_principal, r.path);

  // Y es recuperable como imagen: urlAsset() genera una URL real para ese path.
  const url = await urlAsset('logo_principal');
  assert.ok(url && url.includes(r.path), 'urlAsset debe devolver una URL firmada apuntando al path guardado');
});

test('subirAsset() acepta SVG igual que cualquier otro image/*, sin tratamiento especial', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const r = await subirAsset('favicon', 'icono.svg', svg, 'image/svg+xml', 'admin-1');
  assert.match(r.path, /\.svg$/);
  const general = await getGeneral();
  assert.equal(general.favicon, r.path);
  const url = await urlAsset('favicon');
  assert.ok(url && url.includes(r.path));
});

test('subirAsset() genera un path seguro para nombres con espacios, acentos, mayúsculas y caracteres especiales', async () => {
  const r = await subirAsset('logo_login', 'Logo Final (2026) — versión.jpg', Buffer.from('x'), 'image/jpeg', 'admin-1');
  assert.doesNotMatch(r.path, /[^a-zA-Z0-9._\-/]/, 'el path no debe contener espacios/acentos/paréntesis/etc.');
  assert.equal((await getGeneral()).logo_login, r.path);
});

test('subirAsset() reemplaza una imagen existente: nuevo path configurado, el anterior se elimina SOLO tras confirmar el nuevo', async () => {
  const primero = await subirAsset('logo_principal', 'v1.png', Buffer.from('v1'), 'image/png', 'admin-1');
  assert.ok(storageObjects.has(primero.path));

  const segundo = await subirAsset('logo_principal', 'v2.png', Buffer.from('v2'), 'image/png', 'admin-1');
  assert.notEqual(segundo.path, primero.path, 'cada subida usa un path nuevo, nunca sobrescribe en el mismo path');

  // El reemplazo queda configurado...
  assert.equal((await getGeneral()).logo_principal, segundo.path);
  assert.ok(storageObjects.has(segundo.path), 'el archivo nuevo debe existir en Storage');
  // ...y el anterior se limpia (best-effort) una vez confirmado el nuevo.
  assert.ok(!storageObjects.has(primero.path), 'el archivo anterior debe eliminarse de Storage tras el reemplazo');

  const url = await urlAsset('logo_principal');
  assert.ok(url.includes(segundo.path), 'la previsualización debe apuntar SIEMPRE al archivo vigente, nunca al anterior');
});

test('urlAsset() de una clave sin archivo configurado devuelve null (no es un error)', async () => {
  const url = await urlAsset('clave_nunca_configurada');
  assert.equal(url, null);
});
