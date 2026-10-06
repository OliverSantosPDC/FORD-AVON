'use strict';

/**
 * FORD-AVON — Firma de AUTORIZACIÓN resuelta al aprobar una carta (Operación
 * > Control Operativo), NUNCA elegida por plantilla ni por el Gestor. Cubre,
 * contra el código YA COMPILADO en dist/ (nunca una reimplementación):
 *
 *  - ConfigService.subirFirmaSupervisor/urlFirmaSupervisor: autoservicio sin
 *    gate de rol (la autorización real la exige el middleware de permiso de
 *    la ruta, no una validación de rol aquí) — sube/reemplaza/resuelve la
 *    firma de CUALQUIER id de usuario que el controller le pase (siempre el
 *    usuario autenticado, por diseño del controller).
 *  - GestionService.resolverCarta: aprobar SIN firma configurada se
 *    rechaza con el mensaje EXACTO pedido, sin tocar la carta; aprobar CON
 *    firma configurada snapshotea firma_supervisor_id (quién autoriza) Y
 *    firma_storage_path (la ruta EXACTA vigente en ese instante); rechazar
 *    NUNCA exige firma.
 *  - GestionService.resolverCartasMasivo: filtra por alcance real (nunca
 *    confía en lo que mande el cliente), omite cartas ya resueltas o fuera
 *    de alcance, update atómico con `.eq('estado','PENDIENTE_APROBACION')`
 *    (nunca sobrescribe una carta que cambió de estado justo antes), y
 *    exige la misma firma configurada ANTES de tocar cualquier carta.
 *  - Firma HISTÓRICA: una carta ya aprobada conserva la IMAGEN de firma que
 *    tenía al momento de aprobar — vía `obtenerCarta` (resolución real que
 *    usa el cliente), nunca releyendo la firma ACTUAL del supervisor por su
 *    id — aunque el supervisor reemplace después su firma predeterminada.
 *    Por eso `subirFirmaSupervisor` NUNCA borra el archivo anterior.
 *
 * Sin red ni credenciales: se sustituye @supabase/supabase-js por un
 * cliente falso en memoria (datos 100% ficticios), igual que el resto de
 * la suite (ver scope-fix.test.cjs).
 *
 * Ejecutar (tras `npm run build`): node --test test/autorizacion-firma-control-operativo.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

/* ===== Estado en memoria (datos 100% ficticios) ===== */
let firmasSupervisor = [];
let gestionCartas = [];
let gestores = [
  { id: 'gestor-row-1', usuario_id: 'gestor-usuario-1' },
  { id: 'gestor-row-2', usuario_id: 'gestor-usuario-2' }
];
const storageObjects = new Map();

/** Hook de prueba: simula una condición de CARRERA — justo cuando el
 *  servicio lee el estado de las cartas (ANTES del update atómico), otra
 *  persona resuelve una de ellas por su cuenta. Se activa UNA sola vez. */
let racer = null; // { id, nuevoEstado }

function tablaDe(nombre) {
  if (nombre === 'firmas_supervisor') return firmasSupervisor;
  if (nombre === 'gestion_cartas') return gestionCartas;
  if (nombre === 'gestores') return gestores;
  return [];
}

class Builder {
  constructor(tabla) {
    this.tabla = tabla;
    this.action = 'select';
    this.filtros = [];
    this.patch = null;
    this.upsertRows = null;
    this.conflictCol = null;
    this.wantSelectAfterWrite = false;
    this.single = false;
  }
  select() { if (this.action === 'select') { /* no-op: no filtramos por columnas */ } else { this.wantSelectAfterWrite = true; } return this; }
  eq(col, val) { this.filtros.push({ tipo: 'eq', col, val }); return this; }
  in(col, vals) { this.filtros.push({ tipo: 'in', col, vals }); return this; }
  maybeSingle() { this.single = true; return this._run(); }
  limit() { return this._run(); }
  update(patch) { this.action = 'update'; this.patch = patch; return this; }
  upsert(rows, opts) { this.action = 'upsert'; this.upsertRows = Array.isArray(rows) ? rows : [rows]; this.conflictCol = (opts && opts.onConflict) || 'id'; return this; }
  _match(row) {
    return this.filtros.every((f) => f.tipo === 'eq' ? String(row[f.col]) === String(f.val) : f.vals.map(String).includes(String(row[f.col])));
  }
  _run() {
    const tabla = tablaDe(this.tabla);
    if (this.action === 'update') {
      const match = tabla.filter((r) => this._match(r));
      match.forEach((r) => Object.assign(r, this.patch));
      const data = this.wantSelectAfterWrite ? match.map((r) => ({ ...r })) : null;
      return Promise.resolve({ data, error: null });
    }
    if (this.action === 'upsert') {
      for (const row of this.upsertRows) {
        const idx = tabla.findIndex((r) => String(r[this.conflictCol]) === String(row[this.conflictCol]));
        if (idx >= 0) Object.assign(tabla[idx], row); else tabla.push({ ...row });
      }
      return Promise.resolve({ data: null, error: null });
    }
    // select
    const rows = tabla.filter((r) => this._match(r)).map((r) => ({ ...r }));
    // Hook de carrera: se dispara SOLO en la lectura de gestion_cartas (el
    // pre-read de resolverCartasMasivo), justo antes de devolver — simula
    // que, entre ese read y el update atómico que viene después, alguien
    // más ya resolvió esa carta.
    if (racer && this.tabla === 'gestion_cartas' && !this.single) {
      const real = gestionCartas.find((r) => String(r.id) === String(racer.id));
      if (real) real.estado = racer.nuevoEstado;
      racer = null; // una sola vez
    }
    if (this.single) return Promise.resolve({ data: rows[0] ?? null, error: null });
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

const fakeClient = { from: (t) => new Builder(t), storage: { from: () => fakeStorageBucket } };

const supabaseJsPath = require.resolve('@supabase/supabase-js');
const fakeModule = new Module(supabaseJsPath);
fakeModule.exports = { createClient: () => fakeClient };
fakeModule.loaded = true;
require.cache[supabaseJsPath] = fakeModule;

const distDir = path.join(__dirname, '..', 'dist');
const { subirFirmaSupervisor, urlFirmaSupervisor } = require(path.join(distDir, 'services', 'ConfigService.js'));
const { resolverCarta, resolverCartasMasivo, obtenerCarta, SIN_FIRMA_AUTORIZACION_MSG } = require(path.join(distDir, 'services', 'GestionService.js'));

test.beforeEach(() => {
  firmasSupervisor = [{ supervisor_id: 'sup-con-firma', storage_path: 'firmas/sup-con-firma_1_firma.png' }];
  storageObjects.clear();
  storageObjects.set('firmas/sup-con-firma_1_firma.png', { contentType: 'image/png' });
  gestionCartas = [
    { id: 'c1', codigo: 'C-001', gestor_id: 'gestor-usuario-1', estado: 'PENDIENTE_APROBACION', contenido: 'x' },
    { id: 'c2', codigo: 'C-002', gestor_id: 'gestor-usuario-1', estado: 'PENDIENTE_APROBACION', contenido: 'x' },
    { id: 'c3', codigo: 'C-003', gestor_id: 'gestor-usuario-2', estado: 'PENDIENTE_APROBACION', contenido: 'x' }
  ];
  gestores = [{ id: 'gestor-row-1', usuario_id: 'gestor-usuario-1' }, { id: 'gestor-row-2', usuario_id: 'gestor-usuario-2' }];
  racer = null;
});

/* ============================================================================
 * 1) ConfigService.subirFirmaSupervisor/urlFirmaSupervisor — autoservicio,
 *    sin gate de rol (la autorización la exige la ruta, no este servicio).
 * ========================================================================== */

test('subirFirmaSupervisor: rechaza contentType que no sea imagen, sin tocar Storage ni firmas_supervisor', async () => {
  const antes = JSON.stringify(firmasSupervisor);
  await assert.rejects(() => subirFirmaSupervisor('cualquier-usuario', 'doc.pdf', Buffer.from('%PDF'), 'application/pdf', 'cualquier-usuario'), /imagen/i);
  assert.equal(JSON.stringify(firmasSupervisor), antes);
});

test('subirFirmaSupervisor: sube/resuelve la firma de CUALQUIER usuarioId (autoservicio, sin validar rol aquí)', async () => {
  assert.equal(await urlFirmaSupervisor('usuario-nuevo'), null);
  const r = await subirFirmaSupervisor('usuario-nuevo', 'firma.png', Buffer.from('bytes'), 'image/png', 'usuario-nuevo');
  assert.match(r.path, /^firmas\/usuario-nuevo_\d+_firma\.png$/);
  const url = await urlFirmaSupervisor('usuario-nuevo');
  assert.ok(url && url.includes(r.path));
});

test('subirFirmaSupervisor: reemplaza (upsert, nunca dos filas) pero NUNCA borra el archivo anterior — puede ser el snapshot histórico de una carta ya aprobada', async () => {
  const r2 = await subirFirmaSupervisor('sup-con-firma', 'nueva.png', Buffer.from('v2'), 'image/png', 'sup-con-firma');
  const filas = firmasSupervisor.filter((f) => f.supervisor_id === 'sup-con-firma');
  assert.equal(filas.length, 1);
  assert.equal(filas[0].storage_path, r2.path);
  assert.ok(storageObjects.has('firmas/sup-con-firma_1_firma.png'));
});

test('urlFirmaSupervisor: null para usuarioId null (equivalente a "sin firma")', async () => {
  assert.equal(await urlFirmaSupervisor(null), null);
});

/* ============================================================================
 * 2) resolverCarta (individual): firma OBLIGATORIA para aprobar, snapshot
 *    en el momento de aprobar, rechazar NUNCA exige firma.
 * ========================================================================== */

test('resolverCarta: aprobar SIN firma configurada se rechaza con el mensaje EXACTO, sin tocar la carta', async () => {
  await assert.rejects(() => resolverCarta('c1', true, null, 'usuario-sin-firma'), new RegExp(SIN_FIRMA_AUTORIZACION_MSG.replace(/[.]/g, '\\.')));
  const carta = gestionCartas.find((c) => c.id === 'c1');
  assert.equal(carta.estado, 'PENDIENTE_APROBACION');
  assert.equal('firma_supervisor_id' in carta, false);
});

test('resolverCarta: aprobar CON firma configurada snapshotea firma_supervisor_id = quien autoriza Y firma_storage_path = la ruta vigente en ese instante', async () => {
  await resolverCarta('c1', true, 'comentario ok', 'sup-con-firma');
  const carta = gestionCartas.find((c) => c.id === 'c1');
  assert.equal(carta.estado, 'APROBADA');
  assert.equal(carta.aprobado_por, 'sup-con-firma');
  assert.equal(carta.firma_supervisor_id, 'sup-con-firma');
  assert.equal(carta.firma_storage_path, 'firmas/sup-con-firma_1_firma.png');
  assert.equal(carta.comentario_aprobacion, 'comentario ok');
});

test('resolverCarta: rechazar NUNCA exige firma (aunque quien rechaza no tenga ninguna configurada)', async () => {
  await resolverCarta('c1', false, 'no corresponde', 'usuario-sin-firma');
  const carta = gestionCartas.find((c) => c.id === 'c1');
  assert.equal(carta.estado, 'RECHAZADA');
  assert.equal(carta.aprobado_por, 'usuario-sin-firma');
  assert.equal('firma_supervisor_id' in carta, false);
});

/* ============================================================================
 * 3) resolverCartasMasivo: alcance real, omitidas, atomicidad, firma única
 * ========================================================================== */

const ctxGlobal = { isGlobal: true, userId: 'sup-con-firma', gestorIds: [] };
const ctxSoloGestor1 = { isGlobal: false, userId: 'sup-con-firma', gestorIds: ['gestor-row-1'] };

test('resolverCartasMasivo: sin firma configurada rechaza TODO antes de tocar ninguna carta', async () => {
  await assert.rejects(() => resolverCartasMasivo(['c1', 'c2'], null, 'usuario-sin-firma', ctxGlobal), new RegExp(SIN_FIRMA_AUTORIZACION_MSG.replace(/[.]/g, '\\.')));
  assert.ok(gestionCartas.every((c) => c.estado === 'PENDIENTE_APROBACION'));
});

test('resolverCartasMasivo: éxito total dentro de alcance global — todas reciben la misma firma de quien autoriza', async () => {
  const r = await resolverCartasMasivo(['c1', 'c2', 'c3'], 'lote', 'sup-con-firma', ctxGlobal);
  assert.deepEqual(new Set(r.autorizadas), new Set(['c1', 'c2', 'c3']));
  assert.equal(r.omitidas.length, 0);
  gestionCartas.forEach((c) => {
    assert.equal(c.estado, 'APROBADA');
    assert.equal(c.firma_supervisor_id, 'sup-con-firma');
    assert.equal(c.firma_storage_path, 'firmas/sup-con-firma_1_firma.png');
    assert.equal(c.aprobado_por, 'sup-con-firma');
  });
});

test('resolverCartasMasivo: respeta el ALCANCE real — una carta de un gestor fuera de alcance queda omitida, el resto se autoriza', async () => {
  // ctxSoloGestor1 solo ve a gestor-usuario-1 (c1, c2); c3 es de gestor-usuario-2.
  const r = await resolverCartasMasivo(['c1', 'c2', 'c3'], null, 'sup-con-firma', ctxSoloGestor1);
  assert.deepEqual(new Set(r.autorizadas), new Set(['c1', 'c2']));
  assert.equal(r.omitidas.length, 1);
  assert.equal(r.omitidas[0].id, 'c3');
  assert.match(r.omitidas[0].motivo, /alcance/i);
  const c3 = gestionCartas.find((c) => c.id === 'c3');
  assert.equal(c3.estado, 'PENDIENTE_APROBACION'); // nunca tocada
});

test('resolverCartasMasivo: una carta YA resuelta (distinto estado al seleccionarla) queda omitida, nunca sobrescrita', async () => {
  gestionCartas.find((c) => c.id === 'c2').estado = 'RECHAZADA';
  const r = await resolverCartasMasivo(['c1', 'c2'], null, 'sup-con-firma', ctxGlobal);
  assert.deepEqual(r.autorizadas, ['c1']);
  assert.equal(r.omitidas.length, 1);
  assert.equal(r.omitidas[0].id, 'c2');
  assert.match(r.omitidas[0].motivo, /RECHAZADA/);
  assert.equal(gestionCartas.find((c) => c.id === 'c2').estado, 'RECHAZADA'); // intacta
});

test('resolverCartasMasivo: id inexistente queda omitido con motivo claro, el resto se autoriza igual', async () => {
  const r = await resolverCartasMasivo(['c1', 'no-existe'], null, 'sup-con-firma', ctxGlobal);
  assert.deepEqual(r.autorizadas, ['c1']);
  assert.equal(r.omitidas.length, 1);
  assert.equal(r.omitidas[0].id, 'no-existe');
  assert.match(r.omitidas[0].motivo, /no encontrada/i);
});

test('resolverCartasMasivo: CONDICIÓN DE CARRERA — una carta resuelta por otra persona justo entre la selección y el update atómico NUNCA se sobrescribe', async () => {
  // Simula: justo después de leer el estado de las cartas (antes del UPDATE
  // atómico con .eq('estado','PENDIENTE_APROBACION')), alguien más aprueba c2.
  racer = { id: 'c2', nuevoEstado: 'APROBADA' };
  const r = await resolverCartasMasivo(['c1', 'c2'], null, 'sup-con-firma', ctxGlobal);
  assert.deepEqual(r.autorizadas, ['c1']);
  assert.equal(r.omitidas.length, 1);
  assert.equal(r.omitidas[0].id, 'c2');
  // c2 NUNCA fue tocada por esta llamada: sigue con la firma/estado que le
  // puso la otra persona, nunca sobrescrita por esta autorización masiva.
  assert.equal(gestionCartas.find((c) => c.id === 'c2').estado, 'APROBADA');
  assert.equal('firma_supervisor_id' in gestionCartas.find((c) => c.id === 'c2'), false);
});

/* ============================================================================
 * 4) Firma HISTÓRICA: una carta ya aprobada conserva la IMAGEN de firma que
 *    tenía al aprobar, aunque el supervisor cambie después su firma
 *    predeterminada — validado con obtenerCarta (la resolución REAL), no
 *    solo con la columna firma_supervisor_id.
 * ========================================================================== */

test('firma histórica: cambiar la firma predeterminada del supervisor NO altera la IMAGEN de firma de una carta ya aprobada (resuelta vía obtenerCarta)', async () => {
  await resolverCarta('c1', true, null, 'sup-con-firma');
  const carta = gestionCartas.find((c) => c.id === 'c1');
  assert.equal(carta.firma_supervisor_id, 'sup-con-firma');
  assert.equal(carta.firma_storage_path, 'firmas/sup-con-firma_1_firma.png');

  const detalleAntes = await obtenerCarta('c1');
  assert.match(detalleAntes.firmaUrl, /firmas\/sup-con-firma_1_firma\.png/);

  // El supervisor reemplaza su firma predeterminada DESPUÉS de haber
  // aprobado c1 (CONFIGURACIÓN ACTUAL del supervisor ya es otra).
  const nueva = await subirFirmaSupervisor('sup-con-firma', 'firma-nueva.png', Buffer.from('nueva'), 'image/png', 'sup-con-firma');
  assert.notEqual(nueva.path, 'firmas/sup-con-firma_1_firma.png');

  // La firma ACTUAL del supervisor (autoservicio / vista previa de una carta
  // PENDIENTE que él mismo fuera a autorizar) sí refleja la nueva.
  assert.match(await urlFirmaSupervisor('sup-con-firma'), new RegExp(nueva.path.replace(/[/.]/g, '\\$&')));

  // Pero la carta c1, YA APROBADA, sigue mostrando la IMAGEN histórica — ni
  // la columna snapshot ni la URL resuelta cambian por el reemplazo.
  assert.equal(carta.firma_supervisor_id, 'sup-con-firma');
  assert.equal(carta.firma_storage_path, 'firmas/sup-con-firma_1_firma.png');
  const detalleDespues = await obtenerCarta('c1');
  assert.match(detalleDespues.firmaUrl, /firmas\/sup-con-firma_1_firma\.png/);
  assert.ok(!detalleDespues.firmaUrl.includes(nueva.path));

  // Una carta aprobada DESPUÉS del cambio (c2) recibe el snapshot de la
  // firma NUEVA, nunca la vieja — cada carta conserva SU PROPIO momento.
  await resolverCarta('c2', true, null, 'sup-con-firma');
  const carta2 = gestionCartas.find((c) => c.id === 'c2');
  assert.equal(carta2.firma_storage_path, nueva.path);
  const detalleC2 = await obtenerCarta('c2');
  assert.ok(detalleC2.firmaUrl.includes(nueva.path));
});
