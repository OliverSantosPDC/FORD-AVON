'use strict';

/**
 * Pruebas de la RONDA "Completar asignaciones dinámicas y edición de
 * usuarios": persistencia de CONTACTO/PAIS/NOMBRE COMPLETO (antes se
 * parseaban del Excel pero nunca se guardaban — ver
 * sql/2026_profiles_campos_plantilla.sql), edición manual de correo con
 * verificación de duplicados + sincronización con Supabase Auth, y el
 * catálogo de País/División/Zona de Gerentes de zona (fuente del botón "GV:
 * todas las zonas" en el formulario manual).
 *
 * Mismo patrón que test/usuarios-import.test.cjs: código YA COMPILADO en
 * dist/, cliente Supabase falso en memoria. A diferencia de ese archivo,
 * este Builder SÍ soporta filtros sobre columnas de un embed
 * (`eq('roles.clave', 'supervisor')`), necesario para ejercitar
 * obtenerCatalogos() de punta a punta.
 *
 * Ejecutar (tras `npm run build`): node --test test/usuarios-campos-plantilla.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const ExcelJS = require('exceljs');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

let nextId = 1;
const genId = (prefix) => `${prefix}-${nextId++}`;

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
  profiles: [],
  gestores: [],
  gestor_pais_zona: [],
  gerente_zona_zona: [],
  supervisor_gestor: [],
  supervisor_gerente_zona: [],
  liderazgo_supervisor: [],
  cartera: [
    { id: 1, pais: 'GUATEMALA', zona: '101' }
  ],
  auditoria: []
};

const EMBED_MAP = {
  profiles: { roles: { localCol: 'role_id', table: 'roles' } },
  gerente_zona_zona: { zonas: { localCol: 'zona_id', table: 'zonas' } },
  gestor_pais_zona: { zonas: { localCol: 'zona_id', table: 'zonas' } }
};
const FK_ZONA_TABLES = new Set(['gerente_zona_zona', 'gestor_pais_zona']);

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

/** A diferencia del Builder de usuarios-import.test.cjs, resuelve filtros
 *  `eq('roles.clave', valor)` contra la tabla embebida (vía EMBED_MAP),
 *  igual que haría PostgREST — necesario para obtenerCatalogos() (Supervisor/
 *  Gerente de zona se filtran por `roles.clave` con `roles!inner`). */
const matchFilter = (table, row, f) => {
  let col = f.col;
  let value = (col2) => row[col2];
  if (col.includes('.')) {
    const [embedName, subcol] = col.split('.');
    const rel = EMBED_MAP[table] && EMBED_MAP[table][embedName];
    const related = rel ? db[rel.table].find((r) => r.id === row[rel.localCol]) : null;
    value = () => (related ? related[subcol] : undefined);
    col = subcol;
  }
  if (f.type === 'eq') return String(value(col)) === String(f.val);
  if (f.type === 'in') return (f.vals || []).map(String).includes(String(value(col)));
  return true;
};

class Builder {
  constructor(table) {
    this.table = table; this.action = 'select'; this.selectCols = '*'; this.afterWriteCols = null;
    this.filters = []; this.patch = null; this.rows = null; this.wantSingle = false; this.limitN = null; this.rangeArgs = null;
  }
  select(cols) { if (this.action === 'select') this.selectCols = cols; else this.afterWriteCols = cols; return this; }
  eq(col, val) { this.filters.push({ type: 'eq', col, val }); return this; }
  in(col, vals) { this.filters.push({ type: 'in', col, vals }); return this; }
  order() { return this; }
  limit(n) { this.limitN = n; return this; }
  range(from, to) { this.rangeArgs = [from, to]; return this; }
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
  _match(row) { return this.filters.every((f) => matchFilter(this.table, row, f)); }
  _exec() {
    if (!db[this.table]) db[this.table] = [];
    const table = db[this.table];
    if (this.action === 'select') {
      let rows = table.filter((r) => this._match(r));
      if (this.rangeArgs) { const [from, to] = this.rangeArgs; rows = rows.slice(from, to + 1); }
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
      if (FK_ZONA_TABLES.has(this.table)) {
        const invalida = this.rows.find((r) => !db.zonas.some((z) => z.id === r.zona_id));
        if (invalida) return { data: null, error: { message: `FK violation: zona_id ${invalida.zona_id} no existe` } };
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

const authUpdateCalls = [];
const fakeClient = {
  from: (t) => new Builder(t),
  auth: {
    admin: {
      createUser: async ({ email }) => ({ data: { user: { id: genId('auth') } }, error: null }),
      updateUserById: async (id, patch) => {
        authUpdateCalls.push({ id, patch });
        // Simula el mismo error real de Supabase Auth cuando el correo ya
        // está en uso por otra cuenta de Auth (profiles.email ya lo cubre,
        // pero el mock también debe poder fallar si algo lo invoca igual).
        return { data: { user: { id } }, error: null };
      }
    }
  }
};

const supabaseJsPath = require.resolve('@supabase/supabase-js');
const fakeModule = new Module(supabaseJsPath);
fakeModule.exports = { createClient: () => fakeClient };
fakeModule.loaded = true;
require.cache[supabaseJsPath] = fakeModule;

const distDir = path.join(__dirname, '..', 'dist');
const {
  crearUsuario, actualizarUsuario, obtenerUsuario, obtenerCatalogos, UsuariosError,
  validarImportacionUsuarios, aplicarImportacionUsuarios
} = require(path.join(distDir, 'services', 'UsuariosService.js'));
const { generarPlantillaAdministrativa, generarPlantillaComercial, parsearWorkbookUsuarios } = require(path.join(distDir, 'utils', 'usuariosImportExcel.js'));

/* ============ 1. crearUsuario persiste contacto/pais/nombreCompleto ============ */

test('crearUsuario persiste contacto/pais/nombreCompleto y obtenerUsuario los devuelve igual', async () => {
  const { id } = await crearUsuario({
    email: 'nueva.gestora@example.com', nombre: 'Nueva', apellido: 'Gestora', roleId: 'role-ges',
    contacto: '5555-1234', pais: 'GUATEMALA', nombreCompleto: 'Nueva Gestora Oficial', password: 'password123'
  });
  const perfil = db.profiles.find((p) => p.id === id);
  assert.equal(perfil.contacto, '5555-1234');
  assert.equal(perfil.pais, 'GUATEMALA');
  assert.equal(perfil.nombre_completo, 'Nueva Gestora Oficial');

  const recargado = await obtenerUsuario(id);
  assert.equal(recargado.contacto, '5555-1234');
  assert.equal(recargado.pais, 'GUATEMALA');
  assert.equal(recargado.nombreCompleto, 'Nueva Gestora Oficial');
});

test('crearUsuario SIN nombreCompleto lo deriva automáticamente de nombre + apellido', async () => {
  const { id } = await crearUsuario({ email: 'sin.completo@example.com', nombre: 'Juan', apellido: 'Lopez', roleId: 'role-ges' });
  const perfil = db.profiles.find((p) => p.id === id);
  assert.equal(perfil.nombre_completo, 'Juan Lopez');
  assert.equal(perfil.contacto, null);
  assert.equal(perfil.pais, null);
});

/* ============ 2. actualizarUsuario: edición manual de los 3 campos ============ */

test('actualizarUsuario actualiza contacto/pais y conserva el resto; persiste tras recargar', async () => {
  const { id } = await crearUsuario({ email: 'editable.campos@example.com', nombre: 'Ana', apellido: 'Reyes', roleId: 'role-ges' });
  await actualizarUsuario(id, { contacto: '7777-0000', pais: 'HONDURAS' });
  const recargado = await obtenerUsuario(id);
  assert.equal(recargado.contacto, '7777-0000');
  assert.equal(recargado.pais, 'HONDURAS');
  // nombreCompleto no se tocó en este PATCH: sigue el derivado original.
  assert.equal(recargado.nombreCompleto, 'Ana Reyes');
});

test('actualizarUsuario: nombreCompleto manual se respeta tal cual (no se recalcula aunque cambien nombre/apellido en otro PATCH posterior)', async () => {
  const { id } = await crearUsuario({ email: 'nombrecorregido@example.com', nombre: 'Pedro', apellido: 'Gomez', roleId: 'role-ges' });
  await actualizarUsuario(id, { nombreCompleto: 'Pedro Gómez (Corregido)' });
  let recargado = await obtenerUsuario(id);
  assert.equal(recargado.nombreCompleto, 'Pedro Gómez (Corregido)');

  // Un PATCH posterior que NO incluye nombreCompleto no debe recalcularlo.
  await actualizarUsuario(id, { contacto: '1111-2222' });
  recargado = await obtenerUsuario(id);
  assert.equal(recargado.nombreCompleto, 'Pedro Gómez (Corregido)', 'un PATCH que no toca nombreCompleto no debe pisar la corrección manual');
});

test('actualizarUsuario: si nombre/apellido Y nombreCompleto cambian en el MISMO PATCH, usa los valores nuevos (no los obsoletos)', async () => {
  const { id } = await crearUsuario({ email: 'mismopatch@example.com', nombre: 'Vieja', apellido: 'Viejo', roleId: 'role-ges' });
  await actualizarUsuario(id, { nombre: 'Nueva', apellido: 'Nuevo', nombreCompleto: '' });
  const recargado = await obtenerUsuario(id);
  assert.equal(recargado.nombreCompleto, 'Nueva Nuevo', 'con nombreCompleto vacío debe derivar de los nombre/apellido NUEVOS de este mismo PATCH');
});

/* ============ 3. Cambio de correo: duplicado, éxito, relaciones intactas ============ */

test('actualizarUsuario: cambiar el correo a uno YA EN USO por otra cuenta falla y no aplica ningún cambio', async () => {
  const { id: idA } = await crearUsuario({ email: 'correo.ocupado@example.com', nombre: 'A', roleId: 'role-ges' });
  const { id: idB } = await crearUsuario({ email: 'otro.correo@example.com', nombre: 'B', roleId: 'role-ges' });
  const callsAntes = authUpdateCalls.length;

  await assert.rejects(
    () => actualizarUsuario(idB, { email: 'correo.ocupado@example.com', contacto: 'NUEVO-CONTACTO' }),
    (err) => { assert.ok(err instanceof UsuariosError); assert.match(err.message, /Ya existe otra cuenta/); return true; }
  );

  const perfilB = db.profiles.find((p) => p.id === idB);
  assert.equal(perfilB.email, 'otro.correo@example.com', 'el correo de B no debe cambiar');
  assert.equal(perfilB.contacto, null, 'tampoco debe aplicarse el resto del PATCH cuando el correo es inválido');
  assert.equal(authUpdateCalls.length, callsAntes, 'nunca debe llamarse a Supabase Auth para un correo duplicado');
  void idA;
});

test('actualizarUsuario: cambiar el correo a uno libre actualiza Auth + profiles.email y conserva las relaciones (indexadas por id, nunca por email)', async () => {
  const sup = { id: genId('profile'), email: 'sup.correo@example.com', role_id: 'role-sup', activo: true };
  const g1 = { id: genId('gestores'), usuario_id: genId('profile'), nombre_cartera: 'G UNO', activo: true };
  db.profiles.push(sup);
  db.gestores.push(g1);
  await actualizarUsuario(sup.id, { roleId: 'role-sup', gestorIds: [g1.id] });
  assert.equal(db.supervisor_gestor.filter((r) => r.supervisor_id === sup.id && r.activo).length, 1);

  const callsAntes = authUpdateCalls.length;
  await actualizarUsuario(sup.id, { email: 'sup.correo.nuevo@example.com' });

  assert.equal(authUpdateCalls.length, callsAntes + 1);
  assert.equal(authUpdateCalls[authUpdateCalls.length - 1].id, sup.id);
  assert.equal(authUpdateCalls[authUpdateCalls.length - 1].patch.email, 'sup.correo.nuevo@example.com');
  const perfil = db.profiles.find((p) => p.id === sup.id);
  assert.equal(perfil.email, 'sup.correo.nuevo@example.com');

  // La relación supervisor_gestor sigue intacta: nunca se indexó por email.
  const activas = db.supervisor_gestor.filter((r) => r.supervisor_id === sup.id && r.activo);
  assert.equal(activas.length, 1);
  assert.equal(activas[0].gestor_id, g1.id);
});

test('actualizarUsuario: reenviar el MISMO correo (sin cambio real) no llama a Supabase Auth', async () => {
  const { id } = await crearUsuario({ email: 'correo.sinCambio@example.com', nombre: 'Z', roleId: 'role-ges' });
  const callsAntes = authUpdateCalls.length;
  await actualizarUsuario(id, { email: 'CORREO.SINCAMBIO@EXAMPLE.COM', contacto: 'X' });
  assert.equal(authUpdateCalls.length, callsAntes, 'mismo correo (normalizado) no debe disparar ninguna llamada a Auth');
  const perfil = db.profiles.find((p) => p.id === id);
  assert.equal(perfil.contacto, 'X', 'el resto del PATCH sí debe aplicarse normalmente');
});

/* ===== 4. Catálogo País/División/Zona de Gerentes (fuente del botón "GV") ===== */

test('obtenerCatalogos().gerenteZonaPaisDivisionZona expone varias divisiones distintas para el mismo país, sin colapsarlas', async () => {
  const { id: gerId } = await crearUsuario({ email: 'gerente.multidivision@example.com', nombre: 'Gerente', apellido: 'Multi', roleId: 'role-ger' });
  await actualizarUsuario(gerId, {
    roleId: 'role-ger',
    paisZona: [
      { zonaId: 'zona-101', pais: 'GUATEMALA', division: 'CONACASTE' },
      { zonaId: 'zona-104', pais: 'GUATEMALA', division: 'CONACASTE' },
      { zonaId: 'zona-201', pais: 'GUATEMALA', division: 'OCCIDENTE' }
    ]
  });

  const catalogos = await obtenerCatalogos();
  const paraGuatemala = catalogos.gerenteZonaPaisDivisionZona.filter((z) => z.pais === 'GUATEMALA');
  const divisiones = new Set(paraGuatemala.map((z) => z.division));
  assert.deepEqual(divisiones, new Set(['CONACASTE', 'OCCIDENTE']), 'ambas divisiones deben listarse por separado, nunca colapsadas');
  const zonasConacaste = new Set(paraGuatemala.filter((z) => z.division === 'CONACASTE').map((z) => z.zona));
  assert.deepEqual(zonasConacaste, new Set(['101', '104']));
  const zonasOccidente = new Set(paraGuatemala.filter((z) => z.division === 'OCCIDENTE').map((z) => z.zona));
  assert.deepEqual(zonasOccidente, new Set(['201']), 'misma fuente que usaría el botón "GV: todas las zonas" del formulario manual para OCCIDENTE');
});

test('obtenerCatalogos() también resuelve supervisores/gerentesZona vía roles.clave (embed !inner) sin romper', async () => {
  const catalogos = await obtenerCatalogos();
  assert.ok(Array.isArray(catalogos.supervisores));
  assert.ok(catalogos.supervisores.some((s) => s.id));
  assert.ok(Array.isArray(catalogos.gerentesZona));
  assert.ok(catalogos.gerentesZona.some((g) => g.id));
});

/* ===== 5. Round-trip de plantillas: generar -> llenar -> parsear -> validar -> aplicar ===== */

test('Round-trip plantilla Administrativa: generar -> llenar -> parsear -> validar -> aplicar persiste CONTACTO/PAIS/NOMBRE COMPLETO', async () => {
  const rolesCatalogo = db.roles.map((r) => ({ clave: r.clave, nombre: r.nombre, nivel: r.nivel }));
  const buffer = await generarPlantillaAdministrativa(rolesCatalogo);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('Administrativo');
  ws.addRow(['Laura', 'Fuentes', 'Laura Fuentes', 'laura.fuentes@example.com', '4444-5555', 'liderazgo', 2, 'GUATEMALA']);
  const llenado = Buffer.from(await wb.xlsx.writeBuffer());

  const parsed = await parsearWorkbookUsuarios(llenado);
  const fila = parsed.filas.find((f) => f.correo === 'laura.fuentes@example.com');
  assert.ok(fila, 'la fila recién agregada debe parsearse');

  const { items } = await validarImportacionUsuarios(parsed);
  const item = items.find((it) => it.email === 'laura.fuentes@example.com');
  assert.equal(item.estado, 'VALIDO', JSON.stringify(item));

  await aplicarImportacionUsuarios(parsed, true, null);
  const perfil = db.profiles.find((p) => p.email === 'laura.fuentes@example.com');
  assert.ok(perfil, 'round-trip debe crear el perfil');
  assert.equal(perfil.contacto, '4444-5555', 'BUG corregido: CONTACTO ya se persiste (antes se descartaba tras parsear)');
  assert.equal(perfil.pais, 'GUATEMALA', 'BUG corregido: PAIS ya se persiste (antes solo se usaba para validar, nunca se guardaba)');
  assert.equal(perfil.nombre_completo, 'Laura Fuentes', 'BUG corregido: NOMBRE COMPLETO ya se persiste');
});

test('Round-trip plantilla Comercial: generar -> llenar -> parsear -> validar -> aplicar persiste división/zona Y los 3 campos nuevos', async () => {
  const rolesCatalogo = db.roles.map((r) => ({ clave: r.clave, nombre: r.nombre, nivel: r.nivel }));
  const buffer = await generarPlantillaComercial(rolesCatalogo);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('Comercial');
  ws.addRow(['Mario', 'Castillo', 'Mario Castillo', 'mario.castillo@example.com', '6666-7777', 'gerente_zona', 5, 'GUATEMALA', 'CONACASTE', '101']);
  const llenado = Buffer.from(await wb.xlsx.writeBuffer());

  const parsed = await parsearWorkbookUsuarios(llenado);
  const { items } = await validarImportacionUsuarios(parsed);
  assert.equal(items.find((it) => it.email === 'mario.castillo@example.com').estado, 'VALIDO');

  await aplicarImportacionUsuarios(parsed, true, null);
  const perfil = db.profiles.find((p) => p.email === 'mario.castillo@example.com');
  assert.equal(perfil.contacto, '6666-7777');
  assert.equal(perfil.pais, 'GUATEMALA');
  assert.equal(perfil.nombre_completo, 'Mario Castillo');
  const asignacion = db.gerente_zona_zona.find((r) => r.usuario_id === perfil.id && r.activo);
  assert.ok(asignacion);
  assert.equal(asignacion.division, 'CONACASTE');
  assert.equal(db.zonas.find((z) => z.id === asignacion.zona_id).nombre, '101');
});

test('Round-trip: encabezados generados son EXACTAMENTE los que el parser espera (compatibilidad de re-importación garantizada)', async () => {
  const rolesCatalogo = db.roles.map((r) => ({ clave: r.clave, nombre: r.nombre, nivel: r.nivel }));
  const bufAdmin = await generarPlantillaAdministrativa(rolesCatalogo);
  const bufComercial = await generarPlantillaComercial(rolesCatalogo);

  const leerEncabezados = async (buf, hoja) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet(hoja);
    const headers = [];
    ws.getRow(1).eachCell((cell) => headers.push(String(cell.value)));
    return headers;
  };

  assert.deepEqual(await leerEncabezados(bufAdmin, 'Administrativo'), ['NOMBRE', 'APELLIDO', 'NOMBRE COMPLETO', 'CORREO', 'CONTACTO', 'ROL', 'NIVEL', 'PAIS']);
  assert.deepEqual(await leerEncabezados(bufComercial, 'Comercial'), ['NOMBRE', 'APELLIDO', 'NOMBRE COMPLETO', 'CORREO', 'CONTACTO', 'ROL', 'NIVEL', 'PAIS', 'DIVISION', 'ZONA']);
});
