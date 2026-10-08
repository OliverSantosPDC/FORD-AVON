'use strict';

/**
 * Pruebas de la IMPORTACIÓN MASIVA DE USUARIOS (Configuración > Usuarios,
 * plantillas Administrativa/Comercial) — reemplaza el antiguo módulo
 * "Gestión masiva de Usuarios" de Repositorio (eliminado por completo).
 *
 * Cubre lo exigido por la tarea (Sección 8):
 *  - Descargar ambas plantillas con encabezados EXACTOS.
 *  - El parser tolera la hoja "Adminstrativo" (error ortográfico real del
 *    archivo de referencia) además de "Administrativo".
 *  - Importar una persona administrativa (CREAR).
 *  - Importar una gerente con varias zonas (misma persona, varias filas).
 *  - Procesar varias filas del mismo correo SIN duplicar usuarios.
 *  - Preservar división y zona de cada asignación.
 *  - Expandir el marcador ZONA="GV" (todas las zonas conocidas de esa
 *    división), tanto desde el propio archivo como desde BD existente.
 *  - Rechazar correos/roles/niveles/países/zonas inválidos (incluida "ST",
 *    un código no numérico que NO es el marcador especial).
 *  - Reportar conflictos de identidad (mismo correo, NOMBRE/ROL distintos)
 *    sin aplicar ninguna fila de ese correo.
 *  - Asignar varios Supervisores a un Liderazgo y varios Gestores a un
 *    Supervisor (reutilizando actualizarUsuario, igual que la edición manual).
 *
 * Mismo patrón que test/usuarios-zonas.test.cjs: código YA COMPILADO en
 * dist/, cliente Supabase falso en memoria (datos 100% ficticios), con
 * soporte de embeds (`zonas ( nombre )`, `roles ( clave )`), FK mínima de
 * zona_id y paginación por `.range()` (usada por el catálogo real de países
 * de cartera).
 *
 * Ejecutar (tras `npm run build`): node --test test/usuarios-import.test.cjs
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
    { id: 'zona-104', nombre: '104', codigo: '104', activo: true }
  ],
  profiles: [],
  gestores: [],
  gestor_pais_zona: [],
  gerente_zona_zona: [],
  supervisor_gestor: [],
  supervisor_gerente_zona: [],
  liderazgo_supervisor: [],
  cartera: [
    { id: 1, pais: 'GUATEMALA', zona: '101' },
    { id: 2, pais: 'HONDURAS', zona: '301' }
  ],
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
  _match(row) { return this.filters.every((f) => matchFilter(row, f)); }
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
const { validarImportacionUsuarios, aplicarImportacionUsuarios, actualizarUsuario } = require(path.join(distDir, 'services', 'UsuariosService.js'));
const { generarPlantillaAdministrativa, generarPlantillaComercial, parsearWorkbookUsuarios } = require(path.join(distDir, 'utils', 'usuariosImportExcel.js'));

const rolesCatalogo = db.roles.map((r) => ({ clave: r.clave, nombre: r.nombre, nivel: r.nivel }));

const headerRow = async (buffer, sheetName) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet(sheetName);
  const headers = [];
  ws.getRow(1).eachCell((cell) => headers.push(String(cell.value)));
  return headers;
};

/* ===================== 1. Plantillas: encabezados exactos ===================== */

test('Plantilla Administrativa: hoja "Administrativo" con encabezados EXACTOS', async () => {
  const buffer = await generarPlantillaAdministrativa(rolesCatalogo);
  const headers = await headerRow(buffer, 'Administrativo');
  assert.deepEqual(headers, ['NOMBRE', 'APELLIDO', 'NOMBRE COMPLETO', 'CORREO', 'CONTACTO', 'ROL', 'NIVEL', 'PAIS']);
});

test('Plantilla Comercial: hoja "Comercial" con encabezados EXACTOS (administrativas + DIVISION/ZONA)', async () => {
  const buffer = await generarPlantillaComercial(rolesCatalogo);
  const headers = await headerRow(buffer, 'Comercial');
  assert.deepEqual(headers, ['NOMBRE', 'APELLIDO', 'NOMBRE COMPLETO', 'CORREO', 'CONTACTO', 'ROL', 'NIVEL', 'PAIS', 'DIVISION', 'ZONA']);
});

/* ============ 2. Parser: tolera "Adminstrativo" (error ortográfico real) ============ */

const buildWorkbookBuffer = async (sheetName, headers, rows) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(headers);
  rows.forEach((r) => ws.addRow(r));
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
};

test('parsearWorkbookUsuarios: reconoce la hoja "Adminstrativo" (typo real del archivo de referencia) como Administrativo', async () => {
  const buf = await buildWorkbookBuffer('Adminstrativo', ['NOMBRE', 'APELLIDO', 'NOMBRE COMPLETO', 'CORREO', 'CONTACTO', 'ROL', 'NIVEL', 'PAIS'],
    [['Ana', 'Lopez', 'Ana Lopez', 'ana.lopez@ejemplo.com', '555', 'gestor', 4, 'GUATEMALA']]);
  const parsed = await parsearWorkbookUsuarios(buf);
  assert.ok(parsed.hojasPresentes.has('Administrativo'));
  assert.equal(parsed.filas.length, 1);
  assert.equal(parsed.filas[0].correo, 'ana.lopez@ejemplo.com');
});

test('parsearWorkbookUsuarios: reconoce "Administrativo" (ortografía correcta) y "Comercial" en el mismo archivo', async () => {
  const wb = new ExcelJS.Workbook();
  const wsA = wb.addWorksheet('Administrativo');
  wsA.addRow(['NOMBRE', 'APELLIDO', 'NOMBRE COMPLETO', 'CORREO', 'CONTACTO', 'ROL', 'NIVEL', 'PAIS']);
  wsA.addRow(['Ana', 'Lopez', 'Ana Lopez', 'ana2@ejemplo.com', '555', 'gestor', 4, 'GUATEMALA']);
  const wsC = wb.addWorksheet('Comercial');
  wsC.addRow(['NOMBRE', 'APELLIDO', 'NOMBRE COMPLETO', 'CORREO', 'CONTACTO', 'ROL', 'NIVEL', 'PAIS', 'DIVISION', 'ZONA']);
  wsC.addRow(['Gerente', 'Uno', 'Gerente Uno', 'gerente1@ejemplo.com', '555', 'gerente_zona', 5, 'GUATEMALA', 'CONACASTE', '101']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const parsed = await parsearWorkbookUsuarios(buf);
  assert.ok(parsed.hojasPresentes.has('Administrativo'));
  assert.ok(parsed.hojasPresentes.has('Comercial'));
  assert.equal(parsed.filas.length, 2);
});

/* ===================== 3. Importar persona administrativa ===================== */

const filaAdmin = (overrides) => ({
  hoja: 'Administrativo', fila: 2, nombre: 'Leo', apellido: 'Perez', nombreCompleto: 'Leo Perez',
  correo: 'leo.perez@ejemplo.com', contacto: '555', rol: 'liderazgo', nivel: '2', pais: 'GUATEMALA',
  division: '', zona: '', ...overrides
});

test('Importar una persona administrativa (CREAR): queda VALIDA y crea el perfil con el rol correcto', async () => {
  const parsed = { filas: [filaAdmin()], hojasPresentes: new Set(['Administrativo']) };
  const { items, resumen } = await validarImportacionUsuarios(parsed);
  assert.equal(items[0].estado, 'VALIDO');
  assert.equal(resumen.creaciones, 1);

  const antes = db.profiles.length;
  const { resultados } = await aplicarImportacionUsuarios(parsed, true, null);
  assert.equal(resultados[0].resultado, 'OK');
  assert.equal(db.profiles.length, antes + 1);
  const creado = db.profiles.find((p) => p.email === 'leo.perez@ejemplo.com');
  assert.ok(creado);
  assert.equal(creado.role_id, 'role-lid');
});

/* ================ 4/5. Gerente con varias zonas + división/zona preservadas ================ */

const filaComercial = (overrides) => ({
  hoja: 'Comercial', fila: 2, nombre: 'Gaby', apellido: 'Ramirez', nombreCompleto: 'Gaby Ramirez',
  correo: 'gaby.ramirez@ejemplo.com', contacto: '555', rol: 'gerente_zona', nivel: '5', pais: 'GUATEMALA',
  division: 'CONACASTE', zona: '101', ...overrides
});

test('Importar una gerente con varias zonas: UN solo usuario, con AMBAS asignaciones (división/zona preservadas)', async () => {
  const filas = [
    filaComercial({ fila: 2, zona: '101' }),
    filaComercial({ fila: 3, zona: '104' })
  ];
  const parsed = { filas, hojasPresentes: new Set(['Comercial']) };
  const antesPerfiles = db.profiles.length;
  const { resultados, resumen } = await aplicarImportacionUsuarios(parsed, true, null);
  assert.equal(resultados.every((r) => r.resultado === 'OK'), true);
  assert.equal(db.profiles.length, antesPerfiles + 1, 'procesar 2 filas del mismo correo nunca duplica el usuario');
  assert.equal(resumen.relacionesAsignadas, 2);

  const perfil = db.profiles.find((p) => p.email === 'gaby.ramirez@ejemplo.com');
  const asignaciones = db.gerente_zona_zona.filter((r) => r.usuario_id === perfil.id && r.activo);
  assert.equal(asignaciones.length, 2);
  assert.deepEqual(new Set(asignaciones.map((a) => a.division)), new Set(['CONACASTE']));
  const zonasAsignadas = new Set(asignaciones.map((a) => {
    const z = db.zonas.find((zz) => zz.id === a.zona_id);
    return z.nombre;
  }));
  assert.deepEqual(zonasAsignadas, new Set(['101', '104']));
});

/* ===================== 6. Expansión del marcador ZONA="GV" ===================== */

test('GV (dentro del mismo archivo): expande a TODAS las zonas reales de esa división vistas en el archivo', async () => {
  const filas = [
    filaComercial({ correo: 'persona.a@ejemplo.com', nombre: 'Persona', apellido: 'A', division: 'DIV_GV_1', fila: 2, zona: '101' }),
    filaComercial({ correo: 'persona.a@ejemplo.com', nombre: 'Persona', apellido: 'A', division: 'DIV_GV_1', fila: 3, zona: '104' }),
    filaComercial({ correo: 'persona.gv@ejemplo.com', nombre: 'Persona', apellido: 'GV', division: 'DIV_GV_1', fila: 4, zona: 'GV' })
  ];
  const parsed = { filas, hojasPresentes: new Set(['Comercial']) };
  const { items } = await validarImportacionUsuarios(parsed);
  assert.ok(items.every((it) => it.estado === 'VALIDO'), JSON.stringify(items));

  await aplicarImportacionUsuarios(parsed, true, null);
  const perfilGV = db.profiles.find((p) => p.email === 'persona.gv@ejemplo.com');
  const asignacionesGV = db.gerente_zona_zona.filter((r) => r.usuario_id === perfilGV.id && r.activo);
  const zonasGV = new Set(asignacionesGV.map((a) => db.zonas.find((z) => z.id === a.zona_id).nombre));
  assert.deepEqual(zonasGV, new Set(['101', '104']));
});

test('GV (desde BD existente): si el archivo no repite zonas reales, expande usando gerente_zona_zona ya vigente para esa división', async () => {
  // Pre-condición: ya existe una Gerente con 1 zona real en la división DIV_GV_2.
  const filaSemilla = filaComercial({ correo: 'semilla@ejemplo.com', nombre: 'Semilla', apellido: 'Uno', division: 'DIV_GV_2', fila: 2, zona: '101' });
  await aplicarImportacionUsuarios({ filas: [filaSemilla], hojasPresentes: new Set(['Comercial']) }, true, null);

  // Ahora un GV para otra persona, en la MISMA división, sin ninguna fila real en el archivo.
  const filaGV = filaComercial({ correo: 'gv2@ejemplo.com', nombre: 'GV', apellido: 'Dos', division: 'DIV_GV_2', fila: 2, zona: 'GV' });
  const parsed = { filas: [filaGV], hojasPresentes: new Set(['Comercial']) };
  const { items } = await validarImportacionUsuarios(parsed);
  assert.equal(items[0].estado, 'VALIDO');

  await aplicarImportacionUsuarios(parsed, true, null);
  const perfilGV2 = db.profiles.find((p) => p.email === 'gv2@ejemplo.com');
  const asignaciones = db.gerente_zona_zona.filter((r) => r.usuario_id === perfilGV2.id && r.activo);
  assert.equal(asignaciones.length, 1);
  assert.equal(db.zonas.find((z) => z.id === asignaciones[0].zona_id).nombre, '101');
});

test('GV sin ninguna zona conocida para esa división: queda en ERROR y no se aplica nada', async () => {
  const filaGV = filaComercial({ correo: 'gv.huerfano@ejemplo.com', division: 'DIVISION_SIN_ZONAS_NUNCA_USADA', fila: 2, zona: 'GV' });
  const parsed = { filas: [filaGV], hojasPresentes: new Set(['Comercial']) };
  const { items, resumen } = await validarImportacionUsuarios(parsed);
  assert.equal(items[0].estado, 'ERROR');
  assert.equal(items[0].columna, 'ZONA');
  assert.equal(resumen.errores, 1);

  const antes = db.profiles.length;
  await aplicarImportacionUsuarios(parsed, true, null);
  assert.equal(db.profiles.length, antes, 'una fila con error nunca crea el usuario');
});

/* ===================== 7. Validaciones: ST, PAIS, NIVEL, ROL, conflicto ===================== */

test('ZONA="ST" (código no numérico, no es el marcador GV): queda en ERROR con mensaje claro', async () => {
  const fila = filaComercial({ correo: 'tiendas@ejemplo.com', division: 'Tiendas', zona: 'ST' });
  const { items } = await validarImportacionUsuarios({ filas: [fila], hojasPresentes: new Set(['Comercial']) });
  assert.equal(items[0].estado, 'ERROR');
  assert.equal(items[0].columna, 'ZONA');
  assert.match(items[0].mensaje, /ST/);
});

test('PAIS fuera del catálogo real de cartera: ERROR', async () => {
  const fila = filaAdmin({ correo: 'paisinvalido@ejemplo.com', pais: 'PAIS QUE NO EXISTE' });
  const { items } = await validarImportacionUsuarios({ filas: [fila], hojasPresentes: new Set(['Administrativo']) });
  assert.equal(items[0].estado, 'ERROR');
  assert.equal(items[0].columna, 'PAIS');
});

test('NIVEL que no coincide con el ROL: ERROR', async () => {
  const fila = filaAdmin({ correo: 'nivelmal@ejemplo.com', rol: 'gestor', nivel: '3' });
  const { items } = await validarImportacionUsuarios({ filas: [fila], hojasPresentes: new Set(['Administrativo']) });
  assert.equal(items[0].estado, 'ERROR');
  assert.equal(items[0].columna, 'NIVEL');
});

test('ROL inválido: ERROR', async () => {
  const fila = filaAdmin({ correo: 'rolmalo@ejemplo.com', rol: 'director' });
  const { items } = await validarImportacionUsuarios({ filas: [fila], hojasPresentes: new Set(['Administrativo']) });
  assert.equal(items[0].estado, 'ERROR');
  assert.equal(items[0].columna, 'ROL');
});

test('Conflicto de identidad (mismo correo, NOMBRE/ROL distintos entre filas): TODAS las filas de ese correo quedan en ERROR y no se aplica nada', async () => {
  const filas = [
    filaAdmin({ correo: 'conflicto@ejemplo.com', nombre: 'Juan', rol: 'gestor', nivel: '4', fila: 2 }),
    filaAdmin({ correo: 'conflicto@ejemplo.com', nombre: 'Juan Carlos', rol: 'supervisor', nivel: '3', fila: 3 })
  ];
  const parsed = { filas, hojasPresentes: new Set(['Administrativo']) };
  const { items, resumen } = await validarImportacionUsuarios(parsed);
  assert.ok(items.every((it) => it.estado === 'ERROR'));
  assert.match(items[0].mensaje, /Conflicto/);
  assert.equal(resumen.errores, 2);

  const antes = db.profiles.length;
  await aplicarImportacionUsuarios(parsed, true, null);
  assert.equal(db.profiles.length, antes, 'ninguna fila de un correo en conflicto debe aplicarse');
});

/* ===== 8. ACTUALIZAR: correo ya existente se actualiza, nunca se duplica ===== */

test('ACTUALIZAR: un correo ya existente actualiza el perfil (rol/nombre) en vez de crear uno nuevo', async () => {
  const filaCrear = filaAdmin({ correo: 'actualizable@ejemplo.com', nombre: 'Original', rol: 'gestor', nivel: '4', fila: 2 });
  await aplicarImportacionUsuarios({ filas: [filaCrear], hojasPresentes: new Set(['Administrativo']) }, true, null);
  const antes = db.profiles.length;

  const filaActualizar = filaAdmin({ correo: 'actualizable@ejemplo.com', nombre: 'Actualizado', rol: 'supervisor', nivel: '3', fila: 2 });
  const { items, resumen } = await validarImportacionUsuarios({ filas: [filaActualizar], hojasPresentes: new Set(['Administrativo']) });
  assert.equal(items[0].accion, 'ACTUALIZAR');
  assert.equal(resumen.actualizaciones, 1);

  await aplicarImportacionUsuarios({ filas: [filaActualizar], hojasPresentes: new Set(['Administrativo']) }, true, null);
  assert.equal(db.profiles.length, antes, 'ACTUALIZAR nunca crea un segundo perfil');
  const perfil = db.profiles.find((p) => p.email === 'actualizable@ejemplo.com');
  assert.equal(perfil.nombre, 'Actualizado');
  assert.equal(perfil.role_id, 'role-sup');
});

/* ========== 9. Asignar varios Supervisores a Liderazgo / varios Gestores a Supervisor ========== */

test('Asignar VARIOS Supervisores a un Liderazgo (actualizarUsuario, igual que la edición manual)', async () => {
  const lider = { id: genId('profile'), email: 'lider.multi@ejemplo.com', role_id: 'role-lid', activo: true };
  const sup1 = { id: genId('profile'), email: 'sup1.multi@ejemplo.com', role_id: 'role-sup', activo: true };
  const sup2 = { id: genId('profile'), email: 'sup2.multi@ejemplo.com', role_id: 'role-sup', activo: true };
  db.profiles.push(lider, sup1, sup2);

  await actualizarUsuario(lider.id, { roleId: 'role-lid', supervisorIds: [sup1.id, sup2.id] });
  const activas = db.liderazgo_supervisor.filter((r) => r.liderazgo_id === lider.id && r.activo);
  assert.equal(activas.length, 2);
  assert.deepEqual(new Set(activas.map((r) => r.supervisor_id)), new Set([sup1.id, sup2.id]));
});

test('Asignar VARIOS Gestores a un Supervisor (actualizarUsuario, igual que la edición manual)', async () => {
  const sup = { id: genId('profile'), email: 'sup.multi.gestores@ejemplo.com', role_id: 'role-sup', activo: true };
  db.profiles.push(sup);
  const g1 = { id: genId('gestores'), usuario_id: genId('profile'), nombre_cartera: 'GESTOR MULTI 1', activo: true };
  const g2 = { id: genId('gestores'), usuario_id: genId('profile'), nombre_cartera: 'GESTOR MULTI 2', activo: true };
  db.gestores.push(g1, g2);

  await actualizarUsuario(sup.id, { roleId: 'role-sup', gestorIds: [g1.id, g2.id] });
  const activas = db.supervisor_gestor.filter((r) => r.supervisor_id === sup.id && r.activo);
  assert.equal(activas.length, 2);
  assert.deepEqual(new Set(activas.map((r) => r.gestor_id)), new Set([g1.id, g2.id]));
});
