'use strict';

/**
 * FORD-AVON — Firma de carta CONFIGURABLE POR SUPERVISOR (Configuración >
 * Plantillas): pruebas aisladas de ConfigService contra el código YA
 * COMPILADO en dist/ (nunca una reimplementación), con un cliente Supabase
 * falso en memoria (datos 100% ficticios), igual que el resto de la suite.
 *
 * Cubre:
 *  - listarSupervisoresFirma(): SOLO perfiles con rol supervisor (nunca una
 *    lista hardcodeada), incluye activos e inactivos, marca tieneFirma
 *    según exista o no una fila en firmas_supervisor.
 *  - esSupervisor(): true solo para perfiles reales con rol supervisor.
 *  - subirFirmaSupervisor(): rechaza contentType no-imagen y supervisorId
 *    inválido SIN tocar Storage ni firmas_supervisor; con una imagen válida,
 *    sube+persiste (upsert, nunca dos filas por supervisor) y reemplaza la
 *    anterior (se borra SOLO tras confirmar la nueva).
 *  - urlFirmaSupervisor(): URL firmada real para quien tiene firma, `null`
 *    para quien no (nunca lanza), `null` si supervisorId es `null` ("Sin
 *    firma" explícito).
 *  - guardarPlantillaCarta(): persiste firma_supervisor_id en config_plantillas
 *    Y en config_plantillas_versiones (auditoría), incluyendo volver a "Sin
 *    firma" (null) explícitamente.
 *
 * Ejecutar (tras `npm run build`): node --test test/firma-supervisor-plantillas.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

/* ===== Datos ficticios de prueba (NO son datos reales de producción) ===== */
const ROLES = [
  { id: 'role-supervisor', clave: 'supervisor' },
  { id: 'role-gestor', clave: 'gestor' }
];
const PROFILES = [
  { id: 'sup-1', nombre: 'Daniel', apellido: 'Monge', activo: true, role_id: 'role-supervisor' },
  { id: 'sup-2', nombre: 'Oliver', apellido: 'Santos', activo: true, role_id: 'role-supervisor' },
  { id: 'sup-3-inactivo', nombre: 'Ana', apellido: 'Retirada', activo: false, role_id: 'role-supervisor' },
  { id: 'gestor-1', nombre: 'Un', apellido: 'Gestor', activo: true, role_id: 'role-gestor' }
];
let firmasSupervisorRows = [{ supervisor_id: 'sup-1', storage_path: 'firmas/sup-1_1_original.png' }];
let configPlantillasRows = [
  { clave: 'carta_pd1', contenido: 'texto', asunto: 'asunto', activo: true, version: 3, firma_supervisor_id: null }
];
let configPlantillasVersionesRows = [];

/** Simula el bucket Storage `config-assets`: path -> { contentType, buffer }. */
const storageObjects = new Map();
storageObjects.set('firmas/sup-1_1_original.png', { contentType: 'image/png' });

function filasDe(tabla) {
  if (tabla === 'roles') return ROLES;
  if (tabla === 'profiles') return PROFILES;
  if (tabla === 'firmas_supervisor') return firmasSupervisorRows;
  if (tabla === 'config_plantillas') return configPlantillasRows;
  if (tabla === 'config_plantillas_versiones') return configPlantillasVersionesRows;
  return [];
}

class Builder {
  constructor(table) {
    this.table = table;
    this.action = 'select';
    this.filters = [];
    this.inFilters = [];
    this.patch = null;
    this.upsertRows = null;
    this.conflictCol = null;
    this.insertRow = null;
    this.order = () => this;
  }
  select() { return this; }
  eq(col, val) { this.filters.push({ col, val }); return this; }
  in(col, vals) { this.inFilters.push({ col, vals }); return this; }
  maybeSingle() { this.wantSingle = true; return this._run(); }
  single() { this.wantSingle = true; this.wantError404 = true; return this._run(); }
  update(patch) { this.action = 'update'; this.patch = patch; return this; }
  upsert(rows, opts) {
    this.action = 'upsert';
    this.upsertRows = Array.isArray(rows) ? rows : [rows];
    this.conflictCol = (opts && opts.onConflict) || 'id';
    return this; // upsert() en Supabase real también se encadena con .select() etc.; aquí basta then().
  }
  insert(row) { this.action = 'insert'; this.insertRow = { ...row }; return this; }
  _match(row) {
    return this.filters.every((f) => String(row[f.col]) === String(f.val))
      && this.inFilters.every((f) => f.vals.map(String).includes(String(row[f.col])));
  }
  _rows() { return (filasDe(this.table) || []).filter((r) => this._match(r)); }
  _run() {
    if (this.action === 'update') {
      const table = filasDe(this.table);
      let touched = 0;
      table.forEach((r) => { if (this._match(r)) { Object.assign(r, this.patch); touched += 1; } });
      return Promise.resolve({ data: null, error: null, count: touched });
    }
    if (this.action === 'upsert') {
      const table = filasDe(this.table);
      for (const row of this.upsertRows) {
        const idx = table.findIndex((r) => String(r[this.conflictCol]) === String(row[this.conflictCol]));
        if (idx >= 0) Object.assign(table[idx], row); else table.push({ ...row });
      }
      return Promise.resolve({ data: null, error: null });
    }
    if (this.action === 'insert') {
      filasDe(this.table).push(this.insertRow);
      return Promise.resolve({ data: this.insertRow, error: null });
    }
    // select
    const rows = this._rows();
    if (this.wantSingle) {
      if (this.wantError404 && rows.length === 0) return Promise.resolve({ data: null, error: { message: 'no encontrado' } });
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    }
    return Promise.resolve({ data: rows, error: null });
  }
  then(resolve, reject) { return this._run().then(resolve, reject); }
}

const fakeStorageBucket = {
  upload: async (storagePath, buffer, opts) => {
    if (storageObjects.has(storagePath)) return { data: null, error: { message: 'ya existe' } };
    storageObjects.set(storagePath, { buffer, contentType: opts && opts.contentType });
    return { data: { path: storagePath }, error: null };
  },
  remove: async (paths) => { paths.forEach((p) => storageObjects.delete(p)); return { data: null, error: null }; },
  createSignedUrl: async (storagePath) => {
    if (!storageObjects.has(storagePath)) return { data: null, error: { message: 'no encontrado' } };
    return { data: { signedUrl: `https://signed.example.invalid/${storagePath}` }, error: null };
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
const {
  listarSupervisoresFirma, esSupervisor, subirFirmaSupervisor, urlFirmaSupervisor,
  guardarPlantillaCarta, leerPlantillaCarta
} = require(path.join(distDir, 'services', 'ConfigService.js'));

/* ============================================================================
 * 1) listarSupervisoresFirma / esSupervisor — SOLO supervisores reales
 * ========================================================================== */

test('listarSupervisoresFirma: solo perfiles con rol supervisor (nunca gestores ni otros roles), incluye activos e inactivos', async () => {
  const lista = await listarSupervisoresFirma();
  const ids = lista.map((s) => s.id);
  assert.deepEqual(new Set(ids), new Set(['sup-1', 'sup-2', 'sup-3-inactivo']));
  assert.ok(!ids.includes('gestor-1'), 'un gestor nunca debe aparecer como candidato a firma');
  const inactivo = lista.find((s) => s.id === 'sup-3-inactivo');
  assert.equal(inactivo.activo, false, 'un supervisor inactivo se muestra, con su estado real, nunca se oculta silenciosamente');
});

test('listarSupervisoresFirma: tieneFirma=true solo para quien ya tiene fila en firmas_supervisor', async () => {
  const lista = await listarSupervisoresFirma();
  assert.equal(lista.find((s) => s.id === 'sup-1').tieneFirma, true);
  assert.equal(lista.find((s) => s.id === 'sup-2').tieneFirma, false, '"Sin firma configurada" — nunca se inventa una imagen');
});

test('esSupervisor: true solo para un perfil REAL con rol supervisor', async () => {
  assert.equal(await esSupervisor('sup-1'), true);
  assert.equal(await esSupervisor('sup-2'), true);
  assert.equal(await esSupervisor('gestor-1'), false, 'un gestor no es un supervisor válido para firma');
  assert.equal(await esSupervisor('id-inexistente'), false);
});

/* ============================================================================
 * 2) subirFirmaSupervisor / urlFirmaSupervisor
 * ========================================================================== */

test('subirFirmaSupervisor: rechaza contentType que no sea imagen, sin tocar Storage ni firmas_supervisor', async () => {
  const antes = JSON.stringify(firmasSupervisorRows);
  await assert.rejects(
    () => subirFirmaSupervisor('sup-2', 'documento.pdf', Buffer.from('%PDF'), 'application/pdf', 'admin-1'),
    /imagen/i
  );
  assert.equal(JSON.stringify(firmasSupervisorRows), antes);
});

test('subirFirmaSupervisor: rechaza un supervisorId que no corresponde a un supervisor real (ni gestor, ni id inexistente)', async () => {
  await assert.rejects(
    () => subirFirmaSupervisor('gestor-1', 'firma.png', Buffer.from('x'), 'image/png', 'admin-1'),
    /no encontrado/i
  );
  await assert.rejects(
    () => subirFirmaSupervisor('no-existe', 'firma.png', Buffer.from('x'), 'image/png', 'admin-1'),
    /no encontrado/i
  );
});

test('subirFirmaSupervisor: con una imagen válida para un supervisor SIN firma previa, sube y persiste (fila nueva, upsert)', async () => {
  assert.equal(await urlFirmaSupervisor('sup-2'), null, 'antes de subir, sup-2 no tiene firma');

  const r = await subirFirmaSupervisor('sup-2', 'firma sup2 (v1).png', Buffer.from('bytes'), 'image/png', 'admin-1');
  assert.match(r.path, /^firmas\/sup-2_\d+_firma_sup2__v1_\.png$/);
  assert.ok(storageObjects.has(r.path));

  const url = await urlFirmaSupervisor('sup-2');
  assert.ok(url && url.includes(r.path), 'urlFirmaSupervisor debe resolver la imagen recién subida');
});

test('subirFirmaSupervisor: reemplaza la firma existente de un supervisor (upsert, nunca dos filas) y limpia la anterior tras confirmar la nueva', async () => {
  const antes = await urlFirmaSupervisor('sup-1');
  assert.match(antes, /sup-1_1_original\.png/);

  const r2 = await subirFirmaSupervisor('sup-1', 'nueva.png', Buffer.from('v2'), 'image/png', 'admin-1');
  assert.notEqual(r2.path, 'firmas/sup-1_1_original.png');

  const filasSup1 = firmasSupervisorRows.filter((f) => f.supervisor_id === 'sup-1');
  assert.equal(filasSup1.length, 1, 'nunca debe quedar más de una fila de firma por supervisor');
  assert.equal(filasSup1[0].storage_path, r2.path);

  assert.ok(!storageObjects.has('firmas/sup-1_1_original.png'), 'el archivo anterior se elimina tras confirmar el nuevo');

  const urlNueva = await urlFirmaSupervisor('sup-1');
  assert.ok(urlNueva.includes(r2.path));
});

test('urlFirmaSupervisor: devuelve null (nunca lanza) para "Sin firma" explícito (supervisorId null)', async () => {
  assert.equal(await urlFirmaSupervisor(null), null);
});

/* ============================================================================
 * 3) guardarPlantillaCarta: persiste firma_supervisor_id (incluyendo "Sin firma")
 * ========================================================================== */

test('guardarPlantillaCarta: persiste firma_supervisor_id en config_plantillas Y en config_plantillas_versiones (auditoría)', async () => {
  const r = await guardarPlantillaCarta('carta_pd1', { contenido: 'nuevo texto', asunto: 'nuevo asunto', activo: true, firmaSupervisorId: 'sup-1' }, 'admin-1');
  assert.equal(r.version, 4);

  const fila = await leerPlantillaCarta('carta_pd1');
  assert.equal(fila.firma_supervisor_id, 'sup-1');

  const ultimaVersion = configPlantillasVersionesRows[configPlantillasVersionesRows.length - 1];
  assert.equal(ultimaVersion.firma_supervisor_id, 'sup-1');
  assert.equal(ultimaVersion.version, 4);
});

test('guardarPlantillaCarta: volver a "Sin firma" (firmaSupervisorId=null) se persiste explícitamente, nunca deja el valor anterior', async () => {
  await guardarPlantillaCarta('carta_pd1', { contenido: 'texto', asunto: 'asunto', activo: true, firmaSupervisorId: null }, 'admin-1');
  const fila = await leerPlantillaCarta('carta_pd1');
  assert.equal(fila.firma_supervisor_id, null);
});
