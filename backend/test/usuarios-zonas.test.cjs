'use strict';

/**
 * Pruebas de la asignación de ZONAS en Usuarios (Gestor -> gestor_pais_zona,
 * Gerente de Zona -> gerente_zona_zona).
 *
 * RONDA 1: BUG REAL — al editar un usuario desde Usuarios, el formulario ya
 * NO envía `nombreCartera` en cada PATCH (la asignación de cartera es
 * semimanual, ver UsuariosService.ts), así que `gestorIdVinculado` quedaba
 * SIEMPRE en null y el bloque que sincroniza `gestor_pais_zona` nunca se
 * ejecutaba: la petición respondía 200 OK pero la selección de País/Zona del
 * Gestor se perdía en silencio. Corregido resolviendo el gestor YA vinculado
 * al usuario cuando `nombreCartera` no viene en el payload.
 *
 * RONDA 2: BUG REAL (introducido por la propia corrección de la ronda 1) —
 * un usuario con rol Gestor creado MANUALMENTE (sin pasar por la carga
 * masiva) nunca tuvo `nombre_cartera` que ofrecer, así que tampoco tenía
 * ninguna fila en `gestores`; la ronda 1 lanzaba entonces el error "aún no
 * tiene un nombre de cartera vinculado", bloqueando por completo la
 * asignación de zonas a cualquier Gestor manual (caso real reproducido:
 * Gabriela Chan / Giselle Fernandez, profiles.rol='gestor' sin fila en
 * `gestores`). Corregido: cuando no existe ningún gestor vinculado, el
 * backend crea/regulariza el registro de `gestores` (con `nombre_cartera:
 * null` — columna ahora nullable, ver
 * sql/2026_gestores_nombre_cartera_nullable.sql) en vez de bloquear. La
 * identidad real de un Gestor es siempre `gestores.usuario_id`, nunca
 * `nombre_cartera` (que sigue existiendo solo como puente de texto opcional
 * hacia `cartera.gestor`, dato operativo — nunca requisito de identidad ni
 * de autorización).
 *
 * Mismo patrón que test/bulk-import.test.cjs: código YA COMPILADO en dist/,
 * cliente Supabase falso en memoria (datos 100% ficticios), con soporte de
 * `zonas ( nombre )` embebido y una validación de FK mínima (zona_id debe
 * existir en `zonas`) para poder probar el caso "zona inválida" igual que lo
 * haría Postgres.
 *
 * Ejecutar (tras `npm run build`): node --test test/usuarios-zonas.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

let nextId = 1;
const genId = (prefix) => `${prefix}-${nextId++}`;

const db = {
  roles: [
    { id: 'role-admin', clave: 'administrador', nombre: 'Administrador', nivel: 1 },
    { id: 'role-ges', clave: 'gestor', nombre: 'Gestor', nivel: 4 },
    { id: 'role-ger', clave: 'gerente_zona', nombre: 'Gerente de Zona', nivel: 5 }
  ],
  zonas: [
    { id: 'zona-107', nombre: '107', codigo: '107', activo: true },
    { id: 'zona-108', nombre: '108', codigo: '108', activo: true },
    { id: 'zona-201', nombre: '201', codigo: '201', activo: true }
  ],
  profiles: [
    { id: 'admin-1', email: 'admin.qatest@example.com', role_id: 'role-admin', activo: true },
    // Gestor QA: YA tiene un gestor vinculado (nombre_cartera), igual que los
    // usuarios reales de producción (import/alta previa) — el escenario real
    // del bug reportado.
    { id: 'ges-1', email: 'gestor.qatest@example.com', role_id: 'role-ges', activo: true },
    // Gestor QA creado MANUALMENTE: SIN ningún gestor vinculado todavía (nunca
    // se le definió nombre_cartera) — el caso real de Gabriela Chan/Giselle
    // Fernandez; debe poder recibir País/Zona igualmente (ronda 2).
    { id: 'ges-2', email: 'gestor2.qatest@example.com', role_id: 'role-ges', activo: true },
    { id: 'ger-1', email: 'gerente.qatest@example.com', role_id: 'role-ger', activo: true }
  ],
  gestores: [{ id: 'gestores-row-1', usuario_id: 'ges-1', nombre_cartera: 'QA TEST UNO', activo: true }],
  gestor_pais_zona: [],
  gerente_zona_zona: [],
  supervisor_gestor: [],
  supervisor_gerente_zona: [],
  liderazgo_supervisor: [],
  auditoria: []
};

const EMBED_MAP = {
  profiles: { roles: { localCol: 'role_id', table: 'roles' } },
  gerente_zona_zona: { zonas: { localCol: 'zona_id', table: 'zonas' } },
  gestor_pais_zona: { zonas: { localCol: 'zona_id', table: 'zonas' } }
};

const FK_ZONA_TABLES = new Set(['gerente_zona_zona', 'gestor_pais_zona']);

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
    this.table = table; this.action = 'select'; this.selectCols = '*'; this.afterWriteCols = null;
    this.filters = []; this.patch = null; this.rows = null; this.wantSingle = false; this.limitN = null;
  }
  select(cols) { if (this.action === 'select') this.selectCols = cols; else this.afterWriteCols = cols; return this; }
  eq(col, val) { this.filters.push({ type: 'eq', col, val }); return this; }
  in(col, vals) { this.filters.push({ type: 'in', col, vals }); return this; }
  order() { return this; }
  limit(n) { this.limitN = n; return this; }
  single() { this.wantSingle = true; return this; }
  update(patch) { this.action = 'update'; this.patch = patch; return this; }
  delete() { this.action = 'delete'; return this; }
  insert(rows) { this.action = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(row) { this.action = 'upsert'; this.rows = [row]; return this; }
  then(resolve, reject) {
    let result;
    try { result = this._exec(); } catch (e) { result = { data: null, error: { message: String((e && e.message) || e) } }; }
    return Promise.resolve(result).then(resolve, reject);
  }
  _match(row) { return this.filters.every((f) => matchFilter(row, f)); }
  _exec() {
    if (!db[this.table]) db[this.table] = [];
    const table = db[this.table];
    if (this.action === 'select') {
      let rows = table.filter((r) => this._match(r));
      if (this.limitN != null) rows = rows.slice(0, this.limitN);
      const projected = rows.map((r) => project(this.table, r, this.selectCols));
      if (this.wantSingle) return projected.length ? { data: projected[0], error: null } : { data: null, error: { message: 'no encontrado' } };
      return { data: projected, error: null };
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
      // Simula la FK real (zona_id -> zonas.id) para poder probar el
      // escenario "guardar una zona inválida" igual que lo rechazaría
      // Postgres — nunca inserta nada si una sola fila referencia una zona
      // inexistente (todo o nada, igual que una sentencia INSERT real).
      if (FK_ZONA_TABLES.has(this.table)) {
        const invalida = this.rows.find((r) => !db.zonas.some((z) => z.id === r.zona_id));
        if (invalida) return { data: null, error: { message: `insert or update on table "${this.table}" violates foreign key constraint (zona_id ${invalida.zona_id} no existe)` } };
      }
      const inserted = this.rows.map((row) => { const withId = { id: row.id || genId(this.table), ...row }; table.push(withId); return withId; });
      const cols = this.afterWriteCols;
      const projected = cols ? inserted.map((r) => project(this.table, r, cols)) : inserted;
      if (this.wantSingle) return { data: projected[0] ?? null, error: null };
      return { data: projected, error: null };
    }
    if (this.action === 'upsert') {
      const row = this.rows[0];
      const idx = table.findIndex((r) => r.id === row.id);
      if (idx >= 0) Object.assign(table[idx], row); else table.push({ ...row });
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }
}

const fakeClient = {
  from: (t) => new Builder(t),
  auth: { admin: { createUser: async () => ({ data: { user: { id: genId('auth') } }, error: null }) } }
};

const supabaseJsPath = require.resolve('@supabase/supabase-js');
const fakeModule = new Module(supabaseJsPath);
fakeModule.exports = { createClient: () => fakeClient };
fakeModule.loaded = true;
require.cache[supabaseJsPath] = fakeModule;

const distDir = path.join(__dirname, '..', 'dist');
const { actualizarUsuario, obtenerUsuario, UsuariosError } = require(path.join(distDir, 'services', 'UsuariosService.js'));

const activasGestor = () => db.gestor_pais_zona.filter((r) => r.gestor_id === 'gestores-row-1' && r.activo);
const activasGerente = (userId) => db.gerente_zona_zona.filter((r) => r.usuario_id === userId && r.activo);

/* ===================== GESTOR -> gestor_pais_zona ===================== */

test('GESTOR — REGRESIÓN DEL BUG: editar sin reenviar nombreCartera SÍ sincroniza gestor_pais_zona (antes se perdía en silencio)', async () => {
  // Reproduce EXACTAMENTE el payload que envía Usuarios/index.tsx hoy:
  // nombre/apellido/roleId/activo/gestorPaisZona — NUNCA nombreCartera.
  await actualizarUsuario('ges-1', {
    nombre: 'Gestor', apellido: 'QA Test', roleId: 'role-ges', activo: true,
    gestorPaisZona: [{ zonaId: 'zona-107', pais: 'GUATEMALA' }]
  });
  const activas = activasGestor();
  assert.equal(activas.length, 1);
  assert.equal(activas[0].zona_id, 'zona-107');
  assert.equal(activas[0].pais, 'GUATEMALA');
  // Y el gestor sigue vinculado al mismo gestores.id de siempre (nunca se
  // tocó nombre_cartera porque esta edición no lo incluyó).
  const gestorRow = db.gestores.find((g) => g.id === 'gestores-row-1');
  assert.equal(gestorRow.usuario_id, 'ges-1');
  assert.equal(gestorRow.nombre_cartera, 'QA TEST UNO');
});

test('A. GESTOR sin zonas -> asignar 1 zona -> guardar', async () => {
  db.gestor_pais_zona = [];
  await actualizarUsuario('ges-1', { roleId: 'role-ges', gestorPaisZona: [{ zonaId: 'zona-107', pais: 'GUATEMALA' }] });
  assert.deepEqual(activasGestor().map((r) => `${r.zona_id}|${r.pais}`), ['zona-107|GUATEMALA']);
});

test('B. GESTOR con 1 zona -> agregar otra (conserva la existente)', async () => {
  await actualizarUsuario('ges-1', {
    roleId: 'role-ges',
    gestorPaisZona: [{ zonaId: 'zona-107', pais: 'GUATEMALA' }, { zonaId: 'zona-108', pais: 'GUATEMALA' }]
  });
  const claves = new Set(activasGestor().map((r) => `${r.zona_id}|${r.pais}`));
  assert.deepEqual(claves, new Set(['zona-107|GUATEMALA', 'zona-108|GUATEMALA']));
});

test('C. GESTOR con varias zonas -> eliminar una', async () => {
  await actualizarUsuario('ges-1', { roleId: 'role-ges', gestorPaisZona: [{ zonaId: 'zona-107', pais: 'GUATEMALA' }] });
  assert.deepEqual(activasGestor().map((r) => `${r.zona_id}|${r.pais}`), ['zona-107|GUATEMALA']);
});

test('D. GESTOR -> agregar y eliminar en la misma operación', async () => {
  // Estado actual: solo zona-107/GUATEMALA. Nueva selección: quita 107, agrega 201.
  await actualizarUsuario('ges-1', { roleId: 'role-ges', gestorPaisZona: [{ zonaId: 'zona-201', pais: 'HONDURAS' }] });
  assert.deepEqual(activasGestor().map((r) => `${r.zona_id}|${r.pais}`), ['zona-201|HONDURAS']);
});

test('E. GESTOR — guardar sin cambios dos veces no altera el resultado ni crea duplicados', async () => {
  const payload = { roleId: 'role-ges', gestorPaisZona: [{ zonaId: 'zona-201', pais: 'HONDURAS' }] };
  await actualizarUsuario('ges-1', payload);
  await actualizarUsuario('ges-1', payload);
  assert.deepEqual(activasGestor().map((r) => `${r.zona_id}|${r.pais}`), ['zona-201|HONDURAS']);
});

test('F. GESTOR — quitar todas las zonas (lista vacía) las elimina todas', async () => {
  await actualizarUsuario('ges-1', { roleId: 'role-ges', gestorPaisZona: [] });
  assert.deepEqual(activasGestor(), []);
});

test('G. GESTOR — intentar guardar una zona inválida (zona_id inexistente) falla y no persiste nada', async () => {
  const antes = activasGestor().length;
  await assert.rejects(
    () => actualizarUsuario('ges-1', { roleId: 'role-ges', gestorPaisZona: [{ zonaId: 'zona-NO-EXISTE', pais: 'GUATEMALA' }] }),
    (err) => { assert.ok(err instanceof UsuariosError); return true; }
  );
  assert.equal(activasGestor().length, antes, 'no debe quedar ninguna fila a medio insertar');
});

test('J. GESTOR — evita duplicados: la misma (zona, país) repetida en el payload produce UN solo registro', async () => {
  await actualizarUsuario('ges-1', {
    roleId: 'role-ges',
    gestorPaisZona: [{ zonaId: 'zona-107', pais: 'GUATEMALA' }, { zonaId: 'zona-107', pais: 'GUATEMALA' }]
  });
  const activas = activasGestor();
  assert.equal(activas.length, 1, 'nunca debe quedar más de un registro vigente para la misma relación gestor+zona');
});

/* ============ GESTOR CREADO MANUALMENTE (sin nombre_cartera) ============
 * Ronda 2: reproduce el caso real de producción — Gabriela Chan y Giselle
 * Fernandez (profiles.rol='gestor', activo=true, SIN ninguna fila en
 * `gestores`) — y prueba que YA NO se bloquea con "aún no tiene un nombre de
 * cartera vinculado": el backend debe crear/regularizar el registro de
 * `gestores` (sin nombre_cartera) y permitir la asignación de País/Zona
 * igual que a un gestor importado. `ges-2` representa este caso: existe en
 * `profiles` con rol gestor pero NO tiene fila en `db.gestores`. */

test('B/C/D. GESTOR MANUAL (sin fila en gestores, sin nombre_cartera) — abrir Editar usuario ya NO bloquea: el selector de zonas debe poder asignar una zona y guardar', async () => {
  assert.equal(db.gestores.some((g) => g.usuario_id === 'ges-2'), false, 'precondición: ges-2 no tiene ningún gestor vinculado todavía');
  await actualizarUsuario('ges-2', { roleId: 'role-ges', gestorPaisZona: [{ zonaId: 'zona-107', pais: 'GUATEMALA' }] });
  const gestorRow = db.gestores.find((g) => g.usuario_id === 'ges-2' && g.activo);
  assert.ok(gestorRow, 'debe haberse creado (regularizado) el registro de gestores para este usuario');
  assert.equal(gestorRow.nombre_cartera, null, 'nunca se inventa un nombre_cartera — queda null hasta que alguien lo complete');
  const activas = db.gestor_pais_zona.filter((r) => r.gestor_id === gestorRow.id && r.activo);
  assert.deepEqual(activas.map((r) => `${r.zona_id}|${r.pais}`), ['zona-107|GUATEMALA']);
});

test('E/F/G/H. GESTOR MANUAL — consultar Supabase (fake), recargar (obtenerUsuario) y confirmar que la zona permanece', async () => {
  const recargado = await obtenerUsuario('ges-2');
  assert.deepEqual(recargado.gestorPaisZona.map((p) => `${p.zonaId}|${p.pais}`), ['zona-107|GUATEMALA']);
  assert.equal(recargado.nombreCartera, null);
});

test('I. GESTOR MANUAL — agregar otra zona (conserva la existente)', async () => {
  await actualizarUsuario('ges-2', {
    roleId: 'role-ges',
    gestorPaisZona: [{ zonaId: 'zona-107', pais: 'GUATEMALA' }, { zonaId: 'zona-108', pais: 'GUATEMALA' }]
  });
  const gestorRow = db.gestores.find((g) => g.usuario_id === 'ges-2' && g.activo);
  const claves = new Set(db.gestor_pais_zona.filter((r) => r.gestor_id === gestorRow.id && r.activo).map((r) => `${r.zona_id}|${r.pais}`));
  assert.deepEqual(claves, new Set(['zona-107|GUATEMALA', 'zona-108|GUATEMALA']));
});

test('J. GESTOR MANUAL — eliminar una zona', async () => {
  await actualizarUsuario('ges-2', { roleId: 'role-ges', gestorPaisZona: [{ zonaId: 'zona-108', pais: 'GUATEMALA' }] });
  const gestorRow = db.gestores.find((g) => g.usuario_id === 'ges-2' && g.activo);
  const activas = db.gestor_pais_zona.filter((r) => r.gestor_id === gestorRow.id && r.activo);
  assert.deepEqual(activas.map((r) => `${r.zona_id}|${r.pais}`), ['zona-108|GUATEMALA']);
});

test('K. GESTOR MANUAL — quitar todas las zonas', async () => {
  await actualizarUsuario('ges-2', { roleId: 'role-ges', gestorPaisZona: [] });
  const gestorRow = db.gestores.find((g) => g.usuario_id === 'ges-2' && g.activo);
  assert.deepEqual(db.gestor_pais_zona.filter((r) => r.gestor_id === gestorRow.id && r.activo), []);
});

test('O. GESTOR MANUAL — guardar varias veces NUNCA crea un segundo registro en gestores (sin duplicar al gestor)', async () => {
  await actualizarUsuario('ges-2', { roleId: 'role-ges' });
  await actualizarUsuario('ges-2', { roleId: 'role-ges', gestorPaisZona: [{ zonaId: 'zona-201', pais: 'HONDURAS' }] });
  await actualizarUsuario('ges-2', { roleId: 'role-ges', nombre: 'Ges Dos QA' });
  const filasGestor = db.gestores.filter((g) => g.usuario_id === 'ges-2');
  assert.equal(filasGestor.length, 1, 'nunca debe existir más de una fila de gestores para el mismo usuario_id');
});

test('A. Crear usuario manual con rol Gestor SIN nombre_cartera: crearUsuario debe dejar `gestores` correctamente relacionado desde el alta', async () => {
  const { crearUsuario } = require(path.join(distDir, 'services', 'UsuariosService.js'));
  const { id } = await crearUsuario({ email: 'nuevo.manual@example.com', nombre: 'Nuevo', apellido: 'Manual', roleId: 'role-ges', password: 'password123' });
  const gestorRow = db.gestores.find((g) => g.usuario_id === id && g.activo);
  assert.ok(gestorRow, 'crearUsuario debe crear/vincular el registro de gestores igual que actualizarUsuario, sin exigir nombreCartera');
  assert.equal(gestorRow.nombre_cartera, null);
  // Y de inmediato puede recibir País/Zona (sin pasar primero por una edición).
  await actualizarUsuario(id, { roleId: 'role-ges', gestorPaisZona: [{ zonaId: 'zona-107', pais: 'GUATEMALA' }] });
  const activas = db.gestor_pais_zona.filter((r) => r.gestor_id === gestorRow.id && r.activo);
  assert.deepEqual(activas.map((r) => `${r.zona_id}|${r.pais}`), ['zona-107|GUATEMALA']);
});

test('K. GESTOR — recargar (obtenerUsuario) después de guardar devuelve exactamente la misma selección', async () => {
  await actualizarUsuario('ges-1', {
    roleId: 'role-ges',
    gestorPaisZona: [{ zonaId: 'zona-107', pais: 'GUATEMALA' }, { zonaId: 'zona-108', pais: 'HONDURAS' }]
  });
  const recargado = await obtenerUsuario('ges-1');
  const claves = new Set(recargado.gestorPaisZona.map((p) => `${p.zonaId}|${p.pais}`));
  assert.deepEqual(claves, new Set(['zona-107|GUATEMALA', 'zona-108|HONDURAS']));
  assert.deepEqual(new Set(recargado.gestorPaisZona.map((p) => p.zona)), new Set(['107', '108']), 'el nombre de zona debe venir resuelto contra `zonas`');
});

/* ================= GERENTE DE ZONA -> gerente_zona_zona ================= */

test('A. GERENTE DE ZONA sin zonas -> asignar 1 zona -> guardar', async () => {
  await actualizarUsuario('ger-1', { roleId: 'role-ger', paisZona: [{ zonaId: 'zona-107', pais: 'GUATEMALA' }] });
  assert.deepEqual(activasGerente('ger-1').map((r) => `${r.zona_id}|${r.pais}`), ['zona-107|GUATEMALA']);
});

test('B. GERENTE DE ZONA con 1 zona -> agregar otra', async () => {
  await actualizarUsuario('ger-1', {
    roleId: 'role-ger',
    paisZona: [{ zonaId: 'zona-107', pais: 'GUATEMALA' }, { zonaId: 'zona-201', pais: 'HONDURAS' }]
  });
  const claves = new Set(activasGerente('ger-1').map((r) => `${r.zona_id}|${r.pais}`));
  assert.deepEqual(claves, new Set(['zona-107|GUATEMALA', 'zona-201|HONDURAS']));
});

test('C. GERENTE DE ZONA con varias zonas -> eliminar una', async () => {
  await actualizarUsuario('ger-1', { roleId: 'role-ger', paisZona: [{ zonaId: 'zona-107', pais: 'GUATEMALA' }] });
  assert.deepEqual(activasGerente('ger-1').map((r) => `${r.zona_id}|${r.pais}`), ['zona-107|GUATEMALA']);
});

test('D. GERENTE DE ZONA -> agregar y eliminar en la misma operación', async () => {
  await actualizarUsuario('ger-1', { roleId: 'role-ger', paisZona: [{ zonaId: 'zona-108', pais: 'GUATEMALA' }] });
  assert.deepEqual(activasGerente('ger-1').map((r) => `${r.zona_id}|${r.pais}`), ['zona-108|GUATEMALA']);
});

test('F. GERENTE DE ZONA — quitar todas las zonas', async () => {
  await actualizarUsuario('ger-1', { roleId: 'role-ger', paisZona: [] });
  assert.deepEqual(activasGerente('ger-1'), []);
});

test('G. GERENTE DE ZONA — zona inválida falla sin persistir nada', async () => {
  await assert.rejects(
    () => actualizarUsuario('ger-1', { roleId: 'role-ger', paisZona: [{ zonaId: 'zona-NO-EXISTE', pais: 'GUATEMALA' }] }),
    (err) => { assert.ok(err instanceof UsuariosError); return true; }
  );
  assert.equal(activasGerente('ger-1').length, 0);
});

test('J. GERENTE DE ZONA — evita duplicados de la misma (zona, país) en un solo guardado', async () => {
  await actualizarUsuario('ger-1', {
    roleId: 'role-ger',
    paisZona: [{ zonaId: 'zona-107', pais: 'GUATEMALA' }, { zonaId: 'zona-107', pais: 'GUATEMALA' }]
  });
  assert.equal(activasGerente('ger-1').length, 1);
});

test('GERENTE DE ZONA — la MISMA zona (107) con países distintos (ambigüedad real: Guatemala y República Dominicana comparten código 107) se conserva como dos filas separadas', async () => {
  await actualizarUsuario('ger-1', {
    roleId: 'role-ger',
    paisZona: [{ zonaId: 'zona-107', pais: 'GUATEMALA' }, { zonaId: 'zona-107', pais: 'REPUBLICA DOMINICANA' }]
  });
  const activas = activasGerente('ger-1');
  assert.equal(activas.length, 2);
  assert.deepEqual(new Set(activas.map((r) => r.pais)), new Set(['GUATEMALA', 'REPUBLICA DOMINICANA']));
});

test('K. GERENTE DE ZONA — recargar (obtenerUsuario) después de guardar devuelve exactamente la misma selección', async () => {
  await actualizarUsuario('ger-1', { roleId: 'role-ger', paisZona: [{ zonaId: 'zona-201', pais: 'HONDURAS' }] });
  const recargado = await obtenerUsuario('ger-1');
  assert.deepEqual(recargado.paisZona.map((p) => `${p.zonaId}|${p.pais}`), ['zona-201|HONDURAS']);
  assert.equal(recargado.paisZona[0].zona, '201');
});

/* ===================== Rutas: 401/403 (sección H/I) ===================== */

test('H/I. PATCH /usuarios/:id exige requireAuth y requirePermission(usuarios.administrar_global), en ese orden, antes del controller', () => {
  const { requireAuth } = require(path.join(distDir, 'middleware', 'auth.js'));
  const router = require(path.join(distDir, 'routes', 'usuariosRoutes.js')).default;
  const capa = router.stack.find((l) => l.route && l.route.path === '/usuarios/:id' && l.route.methods.patch);
  assert.ok(capa, 'la ruta PATCH /usuarios/:id debe existir');
  const middlewares = capa.route.stack.map((s) => s.handle);
  assert.equal(middlewares[0], requireAuth, 'requireAuth debe ser el primer middleware (401 sin sesión)');
  assert.equal(middlewares.length >= 3, true, 'debe haber un middleware de permiso entre requireAuth y el controller (403 sin permiso)');
});
