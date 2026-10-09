'use strict';

/**
 * Vista jerárquica de Usuarios (Configuración > Usuarios): sustituye la
 * tabla plana por un árbol Administrador / Liderazgo -> Supervisor ->
 * Gestor + Gerente de zona -> País -> División -> Zona.
 *
 * Prueba `obtenerArbolUsuarios` (UsuariosService): debe normalizar las
 * relaciones oficiales (liderazgo_supervisor, supervisor_gestor,
 * supervisor_gerente_zona, gestor_pais_zona, gerente_zona_zona) a pares
 * planos indexados por `profiles.id` — NUNCA por nombre, y resolver
 * `supervisor_gestor.gestor_id` (que apunta a `gestores.id`, no a
 * `profiles.id`) al usuario real. También confirma que el refactor
 * compartido (`cargarRelacionesAlcance`) no rompió `obtenerResumenAlcance`
 * (ver test/usuarios-zonas.test.cjs para su cobertura original — aquí solo
 * se verifica que sigue respondiendo con la misma forma tras el refactor).
 *
 * Mismo patrón que test/usuarios-import.test.cjs: código YA COMPILADO en
 * dist/, cliente Supabase falso en memoria.
 *
 * Ejecutar (tras `npm run build`): node --test test/usuarios-arbol.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const db = {
  roles: [
    { id: 'role-admin', clave: 'administrador', nombre: 'Administrador', nivel: 1 },
    { id: 'role-lid', clave: 'liderazgo', nombre: 'Liderazgo', nivel: 2 },
    { id: 'role-sup', clave: 'supervisor', nombre: 'Supervisor', nivel: 3 },
    { id: 'role-ges', clave: 'gestor', nombre: 'Gestor', nivel: 4 },
    { id: 'role-ger', clave: 'gerente_zona', nombre: 'Gerente de Zona', nivel: 5 }
  ],
  zonas: [
    { id: 'zona-101', nombre: '101', codigo: '101', activo: true },
    { id: 'zona-104', nombre: '104', codigo: '104', activo: true },
    { id: 'zona-201', nombre: '201', codigo: '201', activo: true }
  ],
  profiles: [
    { id: 'admin-1', nombre: 'Ana', apellido: 'Admin', email: 'admin@example.com', activo: true, role_id: 'role-admin', contacto: null, pais: null, nombre_completo: 'Ana Admin' },
    { id: 'lid-1', nombre: 'Luis', apellido: 'Lider', email: 'lider@example.com', activo: true, role_id: 'role-lid', contacto: null, pais: null, nombre_completo: 'Luis Lider' },
    { id: 'sup-1', nombre: 'Sara', apellido: 'Supervisa', email: 'sup1@example.com', activo: true, role_id: 'role-sup', contacto: null, pais: null, nombre_completo: 'Sara Supervisa' },
    { id: 'sup-2', nombre: 'Saul', apellido: 'Solo', email: 'sup2@example.com', activo: true, role_id: 'role-sup', contacto: null, pais: null, nombre_completo: 'Saul Solo' },
    { id: 'ges-1', nombre: 'Gaby', apellido: 'Gestora', email: 'gaby@example.com', activo: true, role_id: 'role-ges', contacto: '555', pais: 'GUATEMALA', nombre_completo: 'Gaby Gestora' },
    { id: 'ges-2', nombre: 'Gus', apellido: 'Gestor', email: 'gus@example.com', activo: true, role_id: 'role-ges', contacto: null, pais: null, nombre_completo: 'Gus Gestor' },
    { id: 'ger-1', nombre: 'Gerardo', apellido: 'Zona', email: 'gerardo@example.com', activo: true, role_id: 'role-ger', contacto: null, pais: null, nombre_completo: 'Gerardo Zona' }
  ],
  // ges-2 deliberadamente SIN fila en `gestores` (gestor "manual" sin nombre_cartera
  // vinculado todavía) — nunca debe aparecer como relación inventada.
  gestores: [{ id: 'gestores-row-1', usuario_id: 'ges-1', nombre_cartera: 'GABY CARTERA', activo: true }],
  liderazgo_supervisor: [{ liderazgo_id: 'lid-1', supervisor_id: 'sup-1', activo: true }],
  supervisor_gestor: [{ supervisor_id: 'sup-1', gestor_id: 'gestores-row-1', activo: true }],
  supervisor_gerente_zona: [{ supervisor_id: 'sup-1', gerente_zona_id: 'ger-1', activo: true }],
  gestor_pais_zona: [
    { gestor_id: 'gestores-row-1', zona_id: 'zona-101', pais: 'GUATEMALA', activo: true },
    { gestor_id: 'gestores-row-1', zona_id: 'zona-104', pais: 'GUATEMALA', activo: true }
  ],
  gerente_zona_zona: [
    { usuario_id: 'ger-1', zona_id: 'zona-101', pais: 'GUATEMALA', division: 'CONACASTE', activo: true },
    { usuario_id: 'ger-1', zona_id: 'zona-201', pais: 'GUATEMALA', division: 'OCCIDENTE', activo: true }
  ],
  cartera: [{ id: 1, pais: 'GUATEMALA', zona: '101', sector: '5' }],
  auditoria: []
};

const EMBED_MAP = {
  profiles: { roles: { localCol: 'role_id', table: 'roles' } },
  gerente_zona_zona: { zonas: { localCol: 'zona_id', table: 'zonas' } },
  gestor_pais_zona: { zonas: { localCol: 'zona_id', table: 'zonas' } }
};

const matchFilter = (row, f) => {
  if (f.type === 'eq') return String(row[f.col]) === String(f.val);
  if (f.type === 'in') return (f.vals || []).map(String).includes(String(row[f.col]));
  return true;
};
const splitTopLevel = (s) => {
  const parts = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
};
const project = (table, row, cols) => {
  if (!row) return row;
  if (!cols || cols === '*') return { ...row };
  const out = {};
  for (const raw of splitTopLevel(cols)) {
    const m = raw.match(/^(\w+)(?:!inner)?\s*\(([^)]*)\)$/);
    if (m) {
      const [, embedName, innerCols] = m;
      const rel = EMBED_MAP[table] && EMBED_MAP[table][embedName];
      if (rel) {
        const related = db[rel.table].find((r) => r.id === row[rel.localCol]);
        out[embedName] = related ? project(rel.table, related, innerCols.trim() || '*') : null;
      } else out[embedName] = null;
    } else out[raw] = row[raw];
  }
  return out;
};

class Builder {
  constructor(table) {
    this.table = table; this.action = 'select'; this.selectCols = '*';
    this.filters = []; this.limitN = null; this.rangeArgs = null; this.wantSingle = false;
  }
  select(cols) { this.selectCols = cols; return this; }
  eq(col, val) { this.filters.push({ type: 'eq', col, val }); return this; }
  in(col, vals) { this.filters.push({ type: 'in', col, vals }); return this; }
  order() { return this; }
  limit(n) { this.limitN = n; return this; }
  range(from, to) { this.rangeArgs = [from, to]; return this; }
  single() { this.wantSingle = true; return this; }
  then(resolve, reject) {
    let result;
    try { result = this._exec(); } catch (e) { result = { data: null, error: { message: String((e && e.message) || e) } }; }
    return Promise.resolve(result).then(resolve, reject);
  }
  _match(row) { return this.filters.every((f) => matchFilter(row, f)); }
  _exec() {
    if (!db[this.table]) db[this.table] = [];
    let rows = db[this.table].filter((r) => this._match(r));
    if (this.rangeArgs) { const [from, to] = this.rangeArgs; rows = rows.slice(from, to + 1); }
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    const projected = rows.map((r) => project(this.table, r, this.selectCols));
    if (this.wantSingle) return projected.length ? { data: projected[0], error: null } : { data: null, error: { message: 'no encontrado' } };
    return { data: projected, error: null };
  }
}

const fakeClient = { from: (t) => new Builder(t) };
const supabaseJsPath = require.resolve('@supabase/supabase-js');
const fakeModule = new Module(supabaseJsPath);
fakeModule.exports = { createClient: () => fakeClient };
fakeModule.loaded = true;
require.cache[supabaseJsPath] = fakeModule;

const distDir = path.join(__dirname, '..', 'dist');
const { obtenerArbolUsuarios, obtenerResumenAlcance } = require(path.join(distDir, 'services', 'UsuariosService.js'));

test('obtenerArbolUsuarios: incluye a TODOS los usuarios de profiles, cada uno con sus datos de identidad', async () => {
  const arbol = await obtenerArbolUsuarios();
  assert.equal(arbol.usuarios.length, db.profiles.length);
  const ger1 = arbol.usuarios.find((u) => u.id === 'ger-1');
  assert.equal(ger1.nombre, 'Gerardo');
  assert.equal(ger1.roleClave, 'gerente_zona');
  assert.equal(ger1.nivel, 5);
});

test('obtenerArbolUsuarios: liderazgoSupervisor/supervisorGerenteZona reflejan EXACTAMENTE las filas reales (nunca inventadas)', async () => {
  const arbol = await obtenerArbolUsuarios();
  assert.deepEqual(arbol.liderazgoSupervisor, [{ liderazgoId: 'lid-1', supervisorId: 'sup-1' }]);
  assert.deepEqual(arbol.supervisorGerenteZona, [{ supervisorId: 'sup-1', gerenteZonaId: 'ger-1' }]);
});

test('obtenerArbolUsuarios: supervisorGestor resuelve gestores.id -> profiles.id (gestor_id de la relación NUNCA es un id de usuario directo)', async () => {
  const arbol = await obtenerArbolUsuarios();
  assert.deepEqual(arbol.supervisorGestor, [{ supervisorId: 'sup-1', gestorUsuarioId: 'ges-1' }]);
});

test('obtenerArbolUsuarios: gerenteZonaZona expone TODAS las combinaciones País/División/Zona de un Gerente con varias divisiones, sin colapsarlas', async () => {
  const arbol = await obtenerArbolUsuarios();
  const filasGer1 = arbol.gerenteZonaZona.filter((r) => r.usuarioId === 'ger-1');
  assert.equal(filasGer1.length, 2);
  assert.deepEqual(new Set(filasGer1.map((r) => r.division)), new Set(['CONACASTE', 'OCCIDENTE']));
  assert.deepEqual(new Set(filasGer1.map((r) => r.zona)), new Set(['101', '201']));
  filasGer1.forEach((r) => assert.equal(r.pais, 'GUATEMALA'));
});

test('obtenerArbolUsuarios: gestorPaisZona resuelve al usuario real y conserva ambas zonas', async () => {
  const arbol = await obtenerArbolUsuarios();
  const filasGes1 = arbol.gestorPaisZona.filter((r) => r.gestorUsuarioId === 'ges-1');
  assert.deepEqual(new Set(filasGes1.map((r) => r.zona)), new Set(['101', '104']));
});

test('obtenerArbolUsuarios: sup-2 (sin Liderazgo, sin Gestores/Gerentes) y ges-2 (sin fila en `gestores`) no generan ninguna relación inventada', async () => {
  const arbol = await obtenerArbolUsuarios();
  assert.equal(arbol.liderazgoSupervisor.some((r) => r.supervisorId === 'sup-2'), false);
  assert.equal(arbol.supervisorGestor.some((r) => r.supervisorId === 'sup-2'), false);
  assert.equal(arbol.supervisorGerenteZona.some((r) => r.supervisorId === 'sup-2'), false);
  // ges-2 SÍ aparece en `usuarios` (nunca se oculta la cuenta) pero en NINGUNA relación.
  assert.ok(arbol.usuarios.some((u) => u.id === 'ges-2'));
  assert.equal(arbol.gestorPaisZona.some((r) => r.gestorUsuarioId === 'ges-2'), false);
  assert.equal(arbol.supervisorGestor.some((r) => r.gestorUsuarioId === 'ges-2'), false);
});

test('obtenerArbolUsuarios: una sola ronda de llamadas (no recalcula ni vuelve a consultar por usuario — nunca N+1)', async () => {
  let llamadas = 0;
  const originalFrom = fakeClient.from;
  fakeClient.from = (t) => { llamadas += 1; return originalFrom(t); };
  try {
    await obtenerArbolUsuarios();
  } finally {
    fakeClient.from = originalFrom;
  }
  // 7 tablas fuente (profiles, gestores, supervisor_gestor, liderazgo_supervisor,
  // gerente_zona_zona, gestor_pais_zona, supervisor_gerente_zona) + las páginas de
  // `cartera` (1 página, dataset pequeño) = 8 llamadas, independiente de cuántos
  // usuarios existan (nunca una llamada extra por usuario).
  assert.equal(llamadas, 8);
});

test('obtenerResumenAlcance sigue funcionando tras compartir el loader con obtenerArbolUsuarios (mismo refactor, sin regresión)', async () => {
  const resumen = await obtenerResumenAlcance();
  assert.equal(resumen.totalUsuarios, db.profiles.length);
  const itemGer1 = resumen.items.find((i) => i.userId === 'ger-1');
  assert.equal(itemGer1.totalZonas, 2);
  const itemSup1 = resumen.items.find((i) => i.userId === 'sup-1');
  assert.equal(itemSup1.totalGestores, 1);
});
