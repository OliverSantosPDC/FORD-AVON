'use strict';

/**
 * CORRECCIÓN ARQUITECTÓNICA — eliminar la dependencia de identidad basada en
 * texto libre (`asignaciones.gestor_nuevo`) hacia una referencia estable y
 * VALIDADA (`asignaciones.gestor_nuevo_id` → `gestores.id`), manteniendo:
 *
 *   USUARIOS → ROLES → RELACIONES → PAÍS/ZONA → ScopeService →
 *   PERSONAS AUTORIZADAS → CARTERA SCOPEADA → FILTROS → MÉTRICAS → VISUALES
 *
 * y, para Asignación:
 *
 *   ASIGNACIÓN → gestor_id validado → identidad real de `gestores` →
 *   gestor efectivo → filtros/métricas/visuales
 *
 * NUNCA: ASIGNACIÓN → texto libre gestor_nuevo → identidad paralela → filtros/visuales.
 *
 * Fase 2 (Supabase, ya aplicada, aditiva): `asignaciones.gestor_anterior_id`
 * y `asignaciones.gestor_nuevo_id` (uuid, FK a `gestores.id`). Las columnas
 * de texto `gestor_anterior`/`gestor_nuevo` se conservan por compatibilidad
 * (Fase 5, pendiente de aprobación futura) pero YA NO son la fuente del
 * gestor efectivo.
 *
 * Ejecutar (tras `npm run build`): node --test test/asignacion-identidad-validada.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const AYER = '2020-01-01';

const db = {
  acceso_global_temporal: [],
  roles: [],
  zonas: [],
  gestor_pais_zona: [],
  gerente_zona_zona: [],
  supervisor_gestor: [],
  supervisor_gerente_zona: [],
  liderazgo_supervisor: [],
  profiles: [{ id: 'user-real', activo: true }, { id: 'user-real2', activo: true }, { id: 'user-desact', activo: true }],
  gestores: [
    { id: 'g-real', usuario_id: 'user-real', nombre_cartera: 'Gestor Real Validado', activo: true },
    { id: 'g-real2', usuario_id: 'user-real2', nombre_cartera: 'Gestor Efectivo Dos', activo: true },
    // Vinculado a un usuario, pero DESACTIVADO: ya no es una identidad vigente.
    { id: 'g-desactivado', usuario_id: 'user-desact', nombre_cartera: 'Gestor Fue Desactivado', activo: false },
    // Huérfano: usuario_id null (registro histórico, nunca una identidad real).
    { id: 'g-huerfano', usuario_id: null, nombre_cartera: 'Gestor Huerfano Sin Usuario', activo: true }
  ],
  asignaciones: []
};

const parseOrClause = (expr) => expr.split(',').map((clause) => {
  const m = clause.match(/^([\w.]+)\.(is|eq|gte|lte)\.(.+)$/);
  if (!m) return () => false;
  const [, col, op, rawVal] = m;
  return (row) => {
    const v = row[col];
    if (op === 'is') return rawVal === 'null' ? (v === null || v === undefined) : String(v) === rawVal;
    if (op === 'eq') return String(v) === rawVal;
    if (op === 'gte') return v !== null && v !== undefined && String(v) >= rawVal;
    if (op === 'lte') return v !== null && v !== undefined && String(v) <= rawVal;
    return false;
  };
});

let autoId = 0;
class Builder {
  constructor(table) { this.table = table; this.filters = []; this.limitN = null; this.rangeArgs = null; this._order = null; }
  select() { return this; }
  order(col, opts) { this._order = { col, asc: !(opts && opts.ascending === false) }; return this; }
  eq(col, val) { this.filters.push((row) => String(row[col]) === String(val)); return this; }
  in(col, vals) { this.filters.push((row) => (vals || []).map(String).includes(String(row[col]))); return this; }
  lte(col, val) { this.filters.push((row) => row[col] !== null && row[col] !== undefined && String(row[col]) <= String(val)); return this; }
  gte(col, val) { this.filters.push((row) => row[col] !== null && row[col] !== undefined && String(row[col]) >= String(val)); return this; }
  or(expr) { const preds = parseOrClause(expr); this.filters.push((row) => preds.some((p) => p(row))); return this; }
  limit(n) { this.limitN = n; return this; }
  range(from, to) { this.rangeArgs = [from, to]; return this; }
  insert(payload) {
    const rows = Array.isArray(payload) ? payload : [payload];
    const inserted = rows.map((r) => ({ id: r.id ?? `auto-${++autoId}`, ...r }));
    db[this.table].push(...inserted);
    this._lastInserted = inserted;
    return this;
  }
  _rows() {
    let rows = (this._lastInserted ?? db[this.table] ?? []).filter((row) => this.filters.every((f) => f(row)));
    if (this._order) {
      const { col, asc } = this._order;
      rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.rangeArgs) { const [from, to] = this.rangeArgs; rows = rows.slice(from, to + 1); }
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    return rows.map((r) => ({ ...r }));
  }
  single() { const rows = this._rows(); return Promise.resolve({ data: rows[0] ?? null, error: null }); }
  maybeSingle() { const rows = this._rows(); return Promise.resolve({ data: rows[0] ?? null, error: null }); }
  then(resolve, reject) { return Promise.resolve({ data: this._rows(), error: null }).then(resolve, reject); }
}

const fakeClient = { from: (t) => new Builder(t) };
const supabaseJsPath = require.resolve('@supabase/supabase-js');
const fakeModule = new Module(supabaseJsPath);
fakeModule.exports = { createClient: () => fakeClient };
fakeModule.loaded = true;
require.cache[supabaseJsPath] = fakeModule;

const distDir = path.join(__dirname, '..', 'dist');
const { resolveScopeContext } = require(path.join(distDir, 'services', 'ScopeService.js'));
const { aplicar, reasignarManual } = require(path.join(distDir, 'services', 'AsignacionService.js'));
const { CarteraService } = require(path.join(distDir, 'services', 'CarteraService.js'));
const { CarteraRepository } = require(path.join(distDir, 'repositories', 'CarteraRepository.js'));

const ctxAdmin = { userId: 'user-admin', role: 'administrador', permissions: [], isGlobal: true, scope: { paises: [], zonas: [], gestores: [] }, gestorIds: [], zonaIds: [], gerenteZonaIds: [] };

// ---------- FASE 3: aplicar() nunca inventa identidad ----------

test('1/2) aplicar(): resuelve gestor_nuevo_id contra gestores reales; NUNCA inserta una asignación hacia un nombre inexistente, huérfano o desactivado', async () => {
  db.asignaciones = [];
  const rows = [
    { codigo: 'CTA-1', gestor: 'Gestor Original 1', pais: 'GUATEMALA' },
    { codigo: 'CTA-2', gestor: 'Gestor Original 2', pais: 'GUATEMALA' },
    { codigo: 'CTA-3', gestor: 'Gestor Original 3', pais: 'GUATEMALA' },
    { codigo: 'CTA-4', gestor: 'Gestor Original 4', pais: 'GUATEMALA' }
  ];
  const regla = {
    grupoPrioritarioPct: 100,
    criterio: 'cuentas',
    // CTA-1 -> real (debe insertarse); CTA-2 -> no existe (omitida);
    // CTA-3 -> desactivado (omitida); CTA-4 -> huérfano sin usuario (omitida).
    gestoresPrioritario: ['Gestor Real Validado', 'Nombre Que No Existe En Gestores', 'Gestor Fue Desactivado', 'Gestor Huerfano Sin Usuario'],
    gestoresResto: []
  };
  const resultado = await aplicar(ctxAdmin, rows, regla);
  assert.equal(resultado.afectadas, 1, 'Solo 1 de las 4 propuestas resuelve a una identidad real validada');
  assert.equal(db.asignaciones.length, 1);
  const [fila] = db.asignaciones;
  assert.equal(fila.codigo, 'CTA-1');
  assert.equal(fila.gestor_nuevo_id, 'g-real', 'gestor_nuevo_id apunta al Gestor real (id 4)');
  assert.equal(fila.gestor_nuevo, 'Gestor Real Validado');
  assert.ok(!db.asignaciones.some((a) => a.codigo === 'CTA-2'), 'Nombre inexistente: nunca se persiste (no se inventa identidad)');
  assert.ok(!db.asignaciones.some((a) => a.codigo === 'CTA-3'), 'Gestor desactivado: nunca se persiste');
  assert.ok(!db.asignaciones.some((a) => a.codigo === 'CTA-4'), 'Gestor huérfano (sin usuario): nunca se persiste');
});

// ---------- FASE 3: reasignarManual() conserva su validación y ahora persiste el ID ----------

test('3/4) reasignarManual(): conserva la validación existente (rechaza destino inexistente/inactivo) y persiste gestor_nuevo_id real', async () => {
  db.asignaciones = [];
  await assert.rejects(
    () => reasignarManual(ctxAdmin, { codigo: 'CTA-X', gestorNuevo: 'Nombre Que No Existe En Gestores', motivo: 'prueba' }),
    /no existe o está inactivo/
  );
  await assert.rejects(
    () => reasignarManual(ctxAdmin, { codigo: 'CTA-X', gestorNuevo: 'Gestor Fue Desactivado', motivo: 'prueba' }),
    /no existe o está inactivo/
  );
  const { id } = await reasignarManual(ctxAdmin, { codigo: 'CTA-X', gestorNuevo: 'Gestor Real Validado', gestorAnterior: 'Gestor Efectivo Dos', motivo: 'prueba válida' });
  const fila = db.asignaciones.find((a) => a.id === id);
  assert.ok(fila);
  assert.equal(fila.gestor_nuevo_id, 'g-real');
  assert.equal(fila.gestor_anterior_id, 'g-real2', 'gestor_anterior_id se resuelve cuando el nombre anterior sí corresponde a un Gestor real');
});

test('gestor_anterior_id queda NULL (best-effort) cuando el nombre anterior no resuelve a ningún Gestor real, sin bloquear la reasignación', async () => {
  db.asignaciones = [];
  const { id } = await reasignarManual(ctxAdmin, { codigo: 'CTA-Y', gestorNuevo: 'Gestor Real Validado', gestorAnterior: 'Texto Historico Sin Usuario', motivo: 'prueba' });
  const fila = db.asignaciones.find((a) => a.id === id);
  assert.equal(fila.gestor_anterior_id, null);
  assert.equal(fila.gestor_nuevo_id, 'g-real');
});

// ---------- FASE 4: overlay del gestor efectivo, extremo a extremo ----------

const CARTERA_ROWS = [
  { codigo: 'CTA-CON-ID', gestor: 'Gestor Original CTA-CON-ID', pais: 'GUATEMALA', zona: '107', pd_actual: 'PD1', campania_adeuda: 'C1', saldo_inicial_usd: 100, saldo_actual_usd: 100, saldo_inicial: 100, saldo_actual: 100 },
  { codigo: 'CTA-SIN-ID', gestor: 'Gestor Original CTA-SIN-ID', pais: 'GUATEMALA', zona: '107', pd_actual: 'PD1', campania_adeuda: 'C1', saldo_inicial_usd: 100, saldo_actual_usd: 100, saldo_inicial: 100, saldo_actual: 100 },
  { codigo: 'CTA-ID-DESACT', gestor: 'Gestor Original CTA-ID-DESACT', pais: 'GUATEMALA', zona: '107', pd_actual: 'PD1', campania_adeuda: 'C1', saldo_inicial_usd: 100, saldo_actual_usd: 100, saldo_inicial: 100, saldo_actual: 100 }
];
const carteraService = new CarteraService(new CarteraRepository({ getCartera: async () => CARTERA_ROWS.map((r) => ({ ...r })) }));

test('5/6/7/8/9) El gestor efectivo (overlay) se resuelve EXCLUSIVAMENTE vía gestor_nuevo_id -> gestores.nombre_cartera; sin override vigente se resuelve por País-Zona (gestor_pais_zona), NUNCA por el texto crudo de cartera.gestor', async () => {
  db.asignaciones = [
    // Vigente y válida: debe sobrescribir el gestor de CTA-CON-ID.
    { id: 'a-1', codigo: 'CTA-CON-ID', gestor_nuevo: 'Gestor Real Validado', gestor_nuevo_id: 'g-real', tipo: 'MANUAL', created_at: '2026-01-02T00:00:00Z' },
    // Fila LEGADO (anterior a esta corrección): sin gestor_nuevo_id — el texto
    // crudo NUNCA debe usarse como gestor efectivo.
    { id: 'a-2', codigo: 'CTA-SIN-ID', gestor_nuevo: 'Texto Crudo Legado Sin ID', gestor_nuevo_id: null, tipo: 'MANUAL', created_at: '2026-01-02T00:00:00Z' },
    // Apunta a un Gestor que EXISTÍA al escribir pero fue desactivado después:
    // re-validado en la lectura, ya no debe aportar gestor efectivo.
    { id: 'a-3', codigo: 'CTA-ID-DESACT', gestor_nuevo: 'Gestor Fue Desactivado', gestor_nuevo_id: 'g-desactivado', tipo: 'MANUAL', created_at: '2026-01-02T00:00:00Z' }
  ];

  const dash = await carteraService.getDashboard(undefined, ctxAdmin);

  const ctaConId = dash.cuentas.find((c) => c.codigo === 'CTA-CON-ID');
  assert.equal(ctaConId.gestor, 'Gestor Real Validado', 'Gestor efectivo resuelto desde gestores.nombre_cartera vía gestor_nuevo_id');

  // Sin gestor_nuevo_id vigente, y sin ninguna relación gestor_pais_zona real
  // para GUATEMALA/107 en este fixture: NUNCA el texto crudo de cartera.gestor
  // ("Gestor Original CTA-SIN-ID") — cae en 'Sin gestor asignado'.
  const ctaSinId = dash.cuentas.find((c) => c.codigo === 'CTA-SIN-ID');
  assert.equal(ctaSinId.gestor, 'Sin gestor asignado', 'Sin gestor_nuevo_id ni gestor_pais_zona: nunca el texto crudo de cartera.gestor');

  // Gestor desactivado después de la asignación: ya no es gestor efectivo, y
  // tampoco hay gestor_pais_zona real para esta geografía en el fixture.
  const ctaDesact = dash.cuentas.find((c) => c.codigo === 'CTA-ID-DESACT');
  assert.equal(ctaDesact.gestor, 'Sin gestor asignado', 'Gestor desactivado: nunca vuelve a mostrar el texto crudo de cartera.gestor');

  // Top Gestores (J) y Centro de Inteligencia reflejan el mismo gestor efectivo.
  assert.ok(dash.topGestores.some((g) => g.nombre === 'Gestor Real Validado'));
  assert.ok(!dash.topGestores.some((g) => g.nombre === 'Texto Crudo Legado Sin ID'));

  const intel = await carteraService.getInteligencia(ctxAdmin);
  assert.ok(intel.rankingGestores.some((g) => g.nombre === 'Gestor Real Validado'));
});

// ---------- FASE 6: los filtros siguen viniendo de Usuarios/ScopeService, no de ASIGNACION ----------

test('10/11) El catálogo del filtro Gestor sigue viniendo EXCLUSIVAMENTE de usuarios/roles/relaciones: ASIGNACION nunca introduce nombres huérfanos en filtros ni visuales', async () => {
  db.asignaciones = [
    { id: 'a-4', codigo: 'CTA-CON-ID', gestor_nuevo: 'Nombre Que Solo Existe En Asignaciones', gestor_nuevo_id: null, tipo: 'MANUAL', created_at: '2026-01-03T00:00:00Z' }
  ];
  const ctx = await resolveScopeContext({ userId: 'user-admin', roleClave: 'administrador', permissions: [] });
  const dash = await carteraService.getDashboard(undefined, ctx);
  // El catálogo de personas (filterOptions.gestor) sale de `gestores`, nunca de `asignaciones`.
  assert.ok(!dash.filterOptions.gestor.includes('Nombre Que Solo Existe En Asignaciones'));
  assert.ok(dash.filterOptions.gestor.includes('Gestor Real Validado'));
  assert.ok(dash.filterOptions.gestor.includes('Gestor Efectivo Dos'));
});

// ---------- FASE: RD no se ve afectado (no se fuerza ninguna relación) ----------

test('12) RD: esta corrección no toca gestor_pais_zona/gerente_zona_zona — el comportamiento de RD (0 relaciones de Gerente) permanece intacto', () => {
  assert.deepEqual(db.gerente_zona_zona, [], 'La Fase 2-4 de asignaciones no agrega ninguna relación gerente_zona_zona');
});
