'use strict';

/**
 * Pruebas de extremo a extremo de la "Gestión masiva de usuarios" (módulo
 * Repositorio): USUARIOS + GRUPOS Y NIVELES (Sección 19 de la tarea).
 *
 * Igual que test/scope-fix.test.cjs: se ejecuta el código YA COMPILADO en
 * dist/ (parsearWorkbook / validarWorkbook / aplicarWorkbook, funciones
 * REALES de UsuariosService.ts), sustituyendo @supabase/supabase-js por un
 * cliente falso en memoria con datos 100% FICTICIOS (ningún dato real de
 * producción). Esto permite ejercitar la lógica completa (parseo, 26
 * validaciones, aplicación en 2 fases, sincronización de las 5 relaciones,
 * re-subida idempotente, modificación de relación) sin tocar Supabase real y
 * sin requerir credenciales (no disponibles en este entorno).
 *
 * La validación adicional contra Supabase REAL (esquema, tablas, el caso
 * ambiguo Zona 107 Guatemala vs. República Dominicana) se hizo por separado
 * con las herramientas MCP de Supabase (ver informe final).
 *
 * Ejecutar (tras `npm run build`): node --test test/bulk-import.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const ExcelJS = require('exceljs');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

/* ===== Base de datos en memoria (100% FICTICIA, sin relación con producción) ===== */
let nextId = 1;
const genId = (prefix) => `${prefix}-${nextId++}`;
const carteraQueryLog = [];

const db = {
  roles: [
    { id: 'role-admin', clave: 'administrador', nombre: 'Administrador', nivel: 1 },
    { id: 'role-lid', clave: 'liderazgo', nombre: 'Liderazgo', nivel: 2 },
    { id: 'role-sup', clave: 'supervisor', nombre: 'Supervisor', nivel: 3 },
    { id: 'role-ges', clave: 'gestor', nombre: 'Gestor', nivel: 4 },
    { id: 'role-ger', clave: 'gerente_zona', nombre: 'Gerente de Zona', nivel: 5 }
  ],
  zonas: [
    { id: 'zona-107', nombre: '107', codigo: '107', activo: true },
    { id: 'zona-208', nombre: '208', codigo: '208', activo: true },
    { id: 'zona-201', nombre: '201', codigo: '201', activo: true }
  ],
  cartera: [
    { pais: 'GUATEMALA', zona: '107', gestor: 'GESTOR FICTICIO UNO' },
    { pais: 'REPUBLICA DOMINICANA', zona: '107', gestor: 'GESTOR FICTICIO UNO' },
    { pais: 'EL SALVADOR', zona: '208', gestor: 'GESTOR FICTICIO DOS' },
    { pais: 'EL SALVADOR', zona: '201', gestor: 'GESTOR FICTICIO DOS' },
    { pais: 'HONDURAS', zona: '201', gestor: 'GESTOR FICTICIO TRES' }
  ],
  gestores: [],
  profiles: [],
  supervisor_gestor: [],
  supervisor_gerente_zona: [],
  liderazgo_supervisor: [],
  gerente_zona_zona: [],
  gestor_pais_zona: [],
  auditoria: []
};

const EMBED_MAP = {
  profiles: { roles: { localCol: 'role_id', table: 'roles' } },
  gerente_zona_zona: { zonas: { localCol: 'zona_id', table: 'zonas' } },
  gestor_pais_zona: { zonas: { localCol: 'zona_id', table: 'zonas' } }
};

const resolveDotted = (table, row, dottedCol) => {
  const [rel, field] = dottedCol.split('.');
  const fk = EMBED_MAP[table] && EMBED_MAP[table][rel];
  if (!fk) return undefined;
  const related = db[fk.table].find((r) => r.id === row[fk.localCol]);
  return related ? related[field] : undefined;
};

const matchFilter = (table, row, f) => {
  if (f.type === 'eq') {
    if (f.col.includes('.')) return String(resolveDotted(table, row, f.col)) === String(f.val);
    return String(row[f.col]) === String(f.val);
  }
  if (f.type === 'in') return (f.vals || []).map(String).includes(String(row[f.col]));
  if (f.type === 'ilike') return String(row[f.col] ?? '').toLowerCase() === String(f.val).toLowerCase();
  if (f.type === 'or') {
    return f.expr.split(',').some((clause) => {
      const m = clause.match(/^([\w.]+)\.eq\.(.+)$/);
      if (!m) return false;
      return String(row[m[1]]) === String(m[2]);
    });
  }
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
      } else {
        out[embedName] = null;
      }
    } else {
      out[raw] = row[raw];
    }
  }
  return out;
};

class Builder {
  constructor(table) {
    this.table = table;
    this.action = 'select';
    this.selectCols = '*';
    this.afterWriteCols = null;
    this.filters = [];
    this.patch = null;
    this.rows = null;
    this.wantSingle = false;
    this.limitN = null;
    this.rangeFrom = null;
    this.rangeTo = null;
  }
  select(cols) { if (this.action === 'select') this.selectCols = cols; else this.afterWriteCols = cols; return this; }
  eq(col, val) { this.filters.push({ type: 'eq', col, val }); return this; }
  in(col, vals) { this.filters.push({ type: 'in', col, vals }); return this; }
  ilike(col, val) { this.filters.push({ type: 'ilike', col, val }); return this; }
  or(expr) { this.filters.push({ type: 'or', expr }); return this; }
  order() { return this; }
  limit(n) { this.limitN = n; return this; }
  range(from, to) { this.rangeFrom = from; this.rangeTo = to; return this; }
  single() { this.wantSingle = true; return this; }
  update(patch) { this.action = 'update'; this.patch = patch; return this; }
  delete() { this.action = 'delete'; return this; }
  insert(rows) { this.action = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(row, opts) { this.action = 'upsert'; this.rows = [row]; this.upsertOpts = opts || {}; return this; }
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
      // Registro de consultas SELECT a `cartera` (Sección 18.5): permite probar
      // que la carga masiva de USUARIOS ya no consulta cartera.gestor para
      // validar personas.
      if (this.table === 'cartera') carteraQueryLog.push({ selectCols: this.selectCols });
      let rows = table.filter((r) => this._match(r));
      if (this.rangeFrom != null) rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
      if (this.limitN != null) rows = rows.slice(0, this.limitN);
      const projected = rows.map((r) => project(this.table, r, this.selectCols));
      if (this.wantSingle) {
        return projected.length ? { data: projected[0], error: null } : { data: null, error: { message: 'no encontrado' } };
      }
      return { data: projected, error: null };
    }
    if (this.action === 'update') {
      const matched = table.filter((r) => this._match(r));
      matched.forEach((r) => Object.assign(r, this.patch));
      return { data: matched, error: null };
    }
    if (this.action === 'delete') {
      db[this.table] = table.filter((r) => !this._match(r));
      return { data: null, error: null };
    }
    if (this.action === 'insert') {
      const inserted = this.rows.map((row) => {
        const withId = { id: row.id || genId(this.table), ...row };
        table.push(withId);
        return withId;
      });
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
  auth: {
    admin: {
      createUser: async () => ({ data: { user: { id: genId('auth') } }, error: null }),
      deleteUser: async () => ({ error: null }),
      updateUserById: async () => ({ error: null })
    }
  }
};

const supabaseJsPath = require.resolve('@supabase/supabase-js');
const fakeModule = new Module(supabaseJsPath);
fakeModule.exports = { createClient: () => fakeClient };
fakeModule.loaded = true;
require.cache[supabaseJsPath] = fakeModule;

const distDir = path.join(__dirname, '..', 'dist');
const { parsearWorkbook } = require(path.join(distDir, 'utils', 'usuariosExcel.js'));
const { validarWorkbook, aplicarWorkbook } = require(path.join(distDir, 'services', 'UsuariosService.js'));

/* ===== Constructor de workbooks de prueba (ExcelJS, mismo formato que la plantilla real) ===== */
const buildWorkbook = async (spec) => {
  const wb = new ExcelJS.Workbook();
  const usuarios = wb.addWorksheet('USUARIOS');
  usuarios.columns = [
    { header: 'ACCION', key: 'accion' }, { header: 'EMAIL', key: 'email' }, { header: 'NOMBRE', key: 'nombre' },
    { header: 'APELLIDO', key: 'apellido' }, { header: 'ROL', key: 'rol' }, { header: 'NIVEL', key: 'nivel' },
    { header: 'NOMBRE_CARTERA', key: 'nombreCartera' }, { header: 'ACTIVO', key: 'activo' }
  ];
  (spec.usuarios || []).forEach((r) => usuarios.addRow(r));

  const addRelSheet = (name, colA, colB, rows) => {
    if (!rows) return;
    const ws = wb.addWorksheet(name);
    ws.columns = [{ header: colA, key: 'a' }, { header: colB, key: 'b' }];
    rows.forEach((r) => ws.addRow(r));
  };
  addRelSheet('LIDERAZGO_SUPERVISOR', 'LIDERAZGO_EMAIL', 'SUPERVISOR_EMAIL', spec.liderazgoSupervisor);
  addRelSheet('SUPERVISOR_GESTOR', 'SUPERVISOR_EMAIL', 'GESTOR_EMAIL', spec.supervisorGestor);
  addRelSheet('SUPERVISOR_GERENTE', 'SUPERVISOR_EMAIL', 'GERENTE_ZONA_EMAIL', spec.supervisorGerente);

  const addPzSheet = (name, colEmail, rows) => {
    if (!rows) return;
    const ws = wb.addWorksheet(name);
    // ID_PAIS_ZONA al final (4to elemento opcional en cada fila) para no romper
    // las filas existentes de 3 columnas [email, PAIS, ZONA]; se busca por
    // nombre de encabezado, no por posición, así que el orden no afecta el parseo real.
    ws.columns = [{ header: colEmail, key: 'email' }, { header: 'PAIS', key: 'pais' }, { header: 'ZONA', key: 'zona' }, { header: 'ID_PAIS_ZONA', key: 'idPaisZona' }];
    rows.forEach((r) => ws.addRow(r));
  };
  addPzSheet('GESTOR_PAIS_ZONA', 'GESTOR_EMAIL', spec.gestorPaisZona);
  addPzSheet('GERENTE_PAIS_ZONA', 'GERENTE_ZONA_EMAIL', spec.gerentePaisZona);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
};

const findProfile = (email) => db.profiles.find((p) => p.email === email.toLowerCase());
const activeRows = (table, col, val) => db[table].filter((r) => r[col] === val && r.activo === true);

test('Carga masiva — alta inicial: todos los roles + las 5 relaciones (incl. Supervisor->Gerente de zona NUEVO)', async () => {
  const buf = await buildWorkbook({
    usuarios: [
      ['CREAR', 'admin1.qatest@example.com', 'Admin', 'Uno', 'administrador', 1, '', 'SI'],
      ['CREAR', 'liderazgo1.qatest@example.com', 'Liderazgo', 'Uno', 'liderazgo', 2, '', 'SI'],
      ['CREAR', 'supervisor1.qatest@example.com', 'Supervisor', 'Uno', 'supervisor', 3, '', 'SI'],
      ['CREAR', 'supervisor2.qatest@example.com', 'Supervisor', 'Dos', 'supervisor', 3, '', 'SI'],
      ['CREAR', 'gestor1.qatest@example.com', 'Gestor', 'Uno', 'gestor', 4, 'GESTOR FICTICIO UNO', 'SI'],
      ['CREAR', 'gestor2.qatest@example.com', 'Gestor', 'Dos', 'gestor', 4, 'GESTOR FICTICIO DOS', 'SI'],
      ['CREAR', 'gerente1.qatest@example.com', 'Gerente', 'Uno', 'gerente_zona', 5, '', 'SI'],
      ['CREAR', 'gerente2.qatest@example.com', 'Gerente', 'Dos', 'gerente_zona', 5, '', 'SI']
    ],
    liderazgoSupervisor: [
      ['liderazgo1.qatest@example.com', 'supervisor1.qatest@example.com'],
      ['liderazgo1.qatest@example.com', 'supervisor2.qatest@example.com']
    ],
    supervisorGestor: [
      ['supervisor1.qatest@example.com', 'gestor1.qatest@example.com'],
      ['supervisor1.qatest@example.com', 'gestor2.qatest@example.com']
    ],
    supervisorGerente: [
      ['supervisor2.qatest@example.com', 'gerente1.qatest@example.com'],
      ['supervisor2.qatest@example.com', 'gerente2.qatest@example.com']
    ],
    gestorPaisZona: [
      ['gestor2.qatest@example.com', 'EL SALVADOR', '208']
    ],
    gerentePaisZona: [
      ['gerente1.qatest@example.com', 'GUATEMALA', '107'],
      ['gerente1.qatest@example.com', 'REPUBLICA DOMINICANA', '107'],
      ['gerente2.qatest@example.com', 'EL SALVADOR', '208']
    ]
  });

  const parsed = await parsearWorkbook(buf);
  const validacion = await validarWorkbook(parsed);
  assert.equal(validacion.resumen.errores, 0, `Se esperaban 0 errores: ${JSON.stringify(validacion.items.filter((i) => i.estado === 'ERROR'))}`);

  const { resumen } = await aplicarWorkbook(parsed, false, null);
  assert.equal(resumen.errores, 0);
  assert.equal(resumen.creaciones, 8);
  assert.equal(resumen.relacionesCreadas, 10); // 2+2+2+1+3
  assert.equal(resumen.relacionesEliminadas, 0);

  // ---- Verificación directa contra la base en memoria (equivalente a Supabase) ----
  const sup2 = findProfile('supervisor2.qatest@example.com');
  const ger1 = findProfile('gerente1.qatest@example.com');
  const ger2 = findProfile('gerente2.qatest@example.com');
  const gestor1Row = db.gestores.find((g) => g.nombre_cartera === 'GESTOR FICTICIO UNO');
  const gestor2Row = db.gestores.find((g) => g.nombre_cartera === 'GESTOR FICTICIO DOS');

  // Supervisor -> Gerente de zona (tabla NUEVA de esta tarea): 2 filas activas para supervisor2.
  const supGerRows = activeRows('supervisor_gerente_zona', 'supervisor_id', sup2.id);
  assert.equal(supGerRows.length, 2);
  assert.deepEqual(new Set(supGerRows.map((r) => r.gerente_zona_id)), new Set([ger1.id, ger2.id]));

  // Gerente de zona -> País/Zona: el PAR se conserva; SIN contaminación cruzada.
  const ger1Pz = activeRows('gerente_zona_zona', 'usuario_id', ger1.id).map((r) => `${r.pais}|${r.zona_id}`).sort();
  const ger2Pz = activeRows('gerente_zona_zona', 'usuario_id', ger2.id).map((r) => `${r.pais}|${r.zona_id}`).sort();
  assert.deepEqual(ger1Pz, ['GUATEMALA|zona-107', 'REPUBLICA DOMINICANA|zona-107']);
  assert.deepEqual(ger2Pz, ['EL SALVADOR|zona-208']);

  // Gestor -> País/Zona (narrowing opcional): 1 fila para gestor2 (vía gestores.id, NO profiles.id).
  const gesPz = activeRows('gestor_pais_zona', 'gestor_id', gestor2Row.id);
  assert.equal(gesPz.length, 1);
  assert.equal(gesPz[0].pais, 'EL SALVADOR');
  assert.equal(activeRows('gestor_pais_zona', 'gestor_id', gestor1Row.id).length, 0);
});

test('Carga masiva — re-subida del MISMO archivo (con ACTUALIZAR): sin duplicar relaciones', async () => {
  const buf = await buildWorkbook({
    usuarios: [
      ['ACTUALIZAR', 'admin1.qatest@example.com', 'Admin', 'Uno', 'administrador', 1, '', 'SI'],
      ['ACTUALIZAR', 'liderazgo1.qatest@example.com', 'Liderazgo', 'Uno', 'liderazgo', 2, '', 'SI'],
      ['ACTUALIZAR', 'supervisor1.qatest@example.com', 'Supervisor', 'Uno', 'supervisor', 3, '', 'SI'],
      ['ACTUALIZAR', 'supervisor2.qatest@example.com', 'Supervisor', 'Dos', 'supervisor', 3, '', 'SI'],
      ['ACTUALIZAR', 'gestor1.qatest@example.com', 'Gestor', 'Uno', 'gestor', 4, 'GESTOR FICTICIO UNO', 'SI'],
      ['ACTUALIZAR', 'gestor2.qatest@example.com', 'Gestor', 'Dos', 'gestor', 4, 'GESTOR FICTICIO DOS', 'SI'],
      ['ACTUALIZAR', 'gerente1.qatest@example.com', 'Gerente', 'Uno', 'gerente_zona', 5, '', 'SI'],
      ['ACTUALIZAR', 'gerente2.qatest@example.com', 'Gerente', 'Dos', 'gerente_zona', 5, '', 'SI']
    ],
    liderazgoSupervisor: [
      ['liderazgo1.qatest@example.com', 'supervisor1.qatest@example.com'],
      ['liderazgo1.qatest@example.com', 'supervisor2.qatest@example.com']
    ],
    supervisorGestor: [
      ['supervisor1.qatest@example.com', 'gestor1.qatest@example.com'],
      ['supervisor1.qatest@example.com', 'gestor2.qatest@example.com']
    ],
    supervisorGerente: [
      ['supervisor2.qatest@example.com', 'gerente1.qatest@example.com'],
      ['supervisor2.qatest@example.com', 'gerente2.qatest@example.com']
    ],
    gestorPaisZona: [['gestor2.qatest@example.com', 'EL SALVADOR', '208']],
    gerentePaisZona: [
      ['gerente1.qatest@example.com', 'GUATEMALA', '107'],
      ['gerente1.qatest@example.com', 'REPUBLICA DOMINICANA', '107'],
      ['gerente2.qatest@example.com', 'EL SALVADOR', '208']
    ]
  });

  const parsed = await parsearWorkbook(buf);
  const validacion = await validarWorkbook(parsed);
  assert.equal(validacion.resumen.errores, 0);

  const { resumen } = await aplicarWorkbook(parsed, false, null);
  assert.equal(resumen.creaciones, 0);
  assert.equal(resumen.actualizaciones, 8);
  assert.equal(resumen.relacionesCreadas, 0, 'no debe duplicar relaciones ya vigentes');
  assert.equal(resumen.relacionesEliminadas, 0);
  assert.equal(resumen.relacionesVigentes, 10);

  const sup2 = findProfile('supervisor2.qatest@example.com');
  assert.equal(activeRows('supervisor_gerente_zona', 'supervisor_id', sup2.id).length, 2, 'sin filas duplicadas');
});

test('Carga masiva — modificar una relación y desactivar un usuario', async () => {
  // Quita gerente2 de supervisor2 (deja solo gerente1) y desactiva gestor2.
  const buf = await buildWorkbook({
    usuarios: [
      ['ACTUALIZAR', 'supervisor2.qatest@example.com', 'Supervisor', 'Dos', 'supervisor', 3, '', 'SI'],
      ['DESACTIVAR', 'gestor2.qatest@example.com', '', '', '', '', '', 'NO']
    ],
    supervisorGerente: [
      ['supervisor2.qatest@example.com', 'gerente1.qatest@example.com']
    ]
  });

  const parsed = await parsearWorkbook(buf);
  const validacion = await validarWorkbook(parsed);
  assert.equal(validacion.resumen.errores, 0, JSON.stringify(validacion.items.filter((i) => i.estado === 'ERROR')));

  const { resumen } = await aplicarWorkbook(parsed, false, null);
  assert.equal(resumen.desactivaciones, 1);
  assert.equal(resumen.relacionesEliminadas, 1); // se elimina supervisor2->gerente2
  assert.equal(resumen.relacionesVigentes, 1); // supervisor2->gerente1 se conserva

  const sup2 = findProfile('supervisor2.qatest@example.com');
  const ger1 = findProfile('gerente1.qatest@example.com');
  const ger2 = findProfile('gerente2.qatest@example.com');
  const restantes = activeRows('supervisor_gerente_zona', 'supervisor_id', sup2.id);
  assert.equal(restantes.length, 1);
  assert.equal(restantes[0].gerente_zona_id, ger1.id);
  assert.equal(activeRows('supervisor_gerente_zona', 'supervisor_id', sup2.id).some((r) => r.gerente_zona_id === ger2.id), false);

  const gestor2Profile = findProfile('gestor2.qatest@example.com');
  assert.equal(gestor2Profile.activo, false);
});

test('Carga masiva — validación RECHAZA relación jerárquica inválida y hoja obligatoria ausente', async () => {
  // supervisor1 (rol real: supervisor) puesto como propietario en LIDERAZGO_SUPERVISOR: inválido.
  const buf = await buildWorkbook({
    usuarios: [['ACTUALIZAR', 'supervisor1.qatest@example.com', 'Supervisor', 'Uno', 'supervisor', 3, '', 'SI']],
    liderazgoSupervisor: [['supervisor1.qatest@example.com', 'gerente1.qatest@example.com']]
  });
  const parsed = await parsearWorkbook(buf);
  const validacion = await validarWorkbook(parsed);
  const err = validacion.items.find((i) => i.hoja === 'LIDERAZGO_SUPERVISOR');
  assert.equal(err.estado, 'ERROR');
  assert.match(err.mensaje, /no tiene rol "liderazgo"/);

  // Sin hoja USUARIOS -> parsearWorkbook debe rechazar el archivo completo.
  const wbSinUsuarios = new ExcelJS.Workbook();
  wbSinUsuarios.addWorksheet('OTRA');
  const bufSinUsuarios = Buffer.from(await wbSinUsuarios.xlsx.writeBuffer());
  await assert.rejects(() => parsearWorkbook(bufSinUsuarios), /USUARIOS/);
});

test('Carga masiva — email duplicado, referencia inexistente, País-Zona inválido y "procesar solo válidas"', async () => {
  const buf = await buildWorkbook({
    usuarios: [
      // Fila 2 (válida): actualiza un usuario real.
      ['ACTUALIZAR', 'supervisor1.qatest@example.com', 'Supervisor', 'Uno', 'supervisor', 3, '', 'SI'],
      // Fila 3 (inválida): mismo email repetido en la propia hoja USUARIOS.
      ['ACTUALIZAR', 'supervisor1.qatest@example.com', 'Supervisor', 'Uno', 'supervisor', 3, '', 'SI']
    ],
    supervisorGestor: [
      // Referencia a un email que no existe en ningún lado -> ERROR.
      ['supervisor1.qatest@example.com', 'inexistente.qatest@example.com']
    ],
    gerentePaisZona: [
      // Par País-Zona que NO existe en cartera -> ERROR.
      ['gerente1.qatest@example.com', 'HONDURAS', '999']
    ]
  });

  const parsed = await parsearWorkbook(buf);
  const validacion = await validarWorkbook(parsed);
  assert.ok(validacion.resumen.errores >= 3, 'se esperaban al menos 3 errores (email duplicado, referencia inexistente, país-zona inválido)');
  assert.ok(validacion.items.some((i) => i.hoja === 'USUARIOS' && i.estado === 'ERROR' && /duplicado/.test(i.mensaje)));
  assert.ok(validacion.items.some((i) => i.hoja === 'SUPERVISOR_GESTOR' && i.estado === 'ERROR' && /inexistente/.test(i.mensaje)));
  assert.ok(validacion.items.some((i) => i.hoja === 'GERENTE_PAIS_ZONA' && i.estado === 'ERROR' && /inexistente en cartera/.test(i.mensaje)));

  // Sin "procesar solo válidas": debe rechazar TODO el archivo (ninguna escritura).
  await assert.rejects(() => aplicarWorkbook(parsed, false, null), /error/i);

  // Con "procesar solo válidas": la fila válida se aplica; las inválidas se reportan como ERROR sin tocar Supabase.
  const { resumen, resultados } = await aplicarWorkbook(parsed, true, null);
  assert.equal(resumen.actualizaciones, 1);
  assert.ok(resumen.errores >= 3);
  const filaInvalidaUsuarios = resultados.filter((r) => r.hoja === 'USUARIOS');
  assert.equal(filaInvalidaUsuarios.filter((r) => r.resultado === 'ERROR').length, 1);
});

test('Carga masiva — PAIS/ZONA: obligatorios, columna reportada, y "zona de otro país" se rechaza', async () => {
  const buf = await buildWorkbook({
    usuarios: [],
    gerentePaisZona: [
      ['gerente1.qatest@example.com', '', '107'], // PAIS vacío -> columna PAIS
      ['gerente1.qatest@example.com', 'GUATEMALA', ''], // ZONA vacía -> columna ZONA
      ['gerente1.qatest@example.com', 'GUATEMALA', '999'], // zona inexistente en cartera
      ['gerente1.qatest@example.com', 'GUATEMALA', '208'] // 208 pertenece EXCLUSIVAMENTE a EL SALVADOR en cartera
    ]
  });
  const parsed = await parsearWorkbook(buf);
  const { items } = await validarWorkbook(parsed);
  const filas = items.filter((i) => i.hoja === 'GERENTE_PAIS_ZONA').sort((a, b) => a.fila - b.fila);
  assert.equal(filas.length, 4);
  filas.forEach((f) => assert.equal(f.estado, 'ERROR'));

  assert.equal(filas[0].columna, 'PAIS');
  assert.match(filas[0].mensaje, /PAIS es obligatorio/);

  assert.equal(filas[1].columna, 'ZONA');
  assert.match(filas[1].mensaje, /ZONA es obligatorio/);

  assert.equal(filas[2].columna, 'PAIS/ZONA');
  assert.match(filas[2].mensaje, /inexistente en cartera/);
  assert.match(filas[2].mensaje, /GUATEMALA \/ 999/);

  // GUATEMALA + 208 no existe como PAR en cartera (208 es exclusivo de EL SALVADOR):
  // debe rechazarse exactamente igual que una zona inexistente, nunca aceptarse
  // por existir "208" en algún país.
  assert.equal(filas[3].columna, 'PAIS/ZONA');
  assert.match(filas[3].mensaje, /inexistente en cartera/);
  assert.match(filas[3].mensaje, /GUATEMALA \/ 208/);
});

test('Carga masiva — Zona 107 en Guatemala y República Dominicana asignada a USUARIOS DIFERENTES: se aceptan, se guardan, no se mezclan, y ScopeService respeta el País', async () => {
  const buf = await buildWorkbook({
    usuarios: [
      ['CREAR', 'gerenteGuatemala.qatest@example.com', 'Gerente', 'Guatemala', 'gerente_zona', 5, '', 'SI'],
      ['CREAR', 'gerenteRD.qatest@example.com', 'Gerente', 'RD', 'gerente_zona', 5, '', 'SI']
    ],
    gerentePaisZona: [
      ['gerenteGuatemala.qatest@example.com', 'GUATEMALA', '107'],
      ['gerenteRD.qatest@example.com', 'REPUBLICA DOMINICANA', '107']
    ]
  });
  const parsed = await parsearWorkbook(buf);
  const validacion = await validarWorkbook(parsed);
  assert.equal(validacion.resumen.errores, 0, JSON.stringify(validacion.items.filter((i) => i.estado === 'ERROR')));

  const { resumen } = await aplicarWorkbook(parsed, false, null);
  assert.equal(resumen.errores, 0);
  assert.equal(resumen.creaciones, 2);
  assert.equal(resumen.relacionesCreadas, 2);

  // ---- Se guardaron correctamente y NO se mezclan (verificación directa en la "BD") ----
  const gGuatemala = findProfile('gerenteguatemala.qatest@example.com');
  const gRD = findProfile('gerenterd.qatest@example.com');
  const pzGuatemala = activeRows('gerente_zona_zona', 'usuario_id', gGuatemala.id);
  const pzRD = activeRows('gerente_zona_zona', 'usuario_id', gRD.id);
  assert.equal(pzGuatemala.length, 1);
  assert.equal(pzGuatemala[0].pais, 'GUATEMALA');
  assert.equal(pzRD.length, 1);
  assert.equal(pzRD[0].pais, 'REPUBLICA DOMINICANA');
  // Mismo zona_id (ambos son "zona 107"), pero el país que se guardó es distinto.
  assert.equal(pzGuatemala[0].zona_id, pzRD[0].zona_id);
  assert.notEqual(pzGuatemala[0].pais, pzRD[0].pais);

  // ---- ScopeService (applyScope) respeta el País: un Gerente de Guatemala NUNCA
  // obtiene cartera de República Dominicana por compartir el mismo número de zona ----
  const { applyScope } = require(path.join(distDir, 'services', 'ScopeFilter.js'));
  const carteraCompartida = [
    { pais: 'GUATEMALA', zona: '107', gestor: 'GESTOR GT' },
    { pais: 'REPUBLICA DOMINICANA', zona: '107', gestor: 'GESTOR RD' }
  ];
  const ctxGuatemala = { isGlobal: false, scope: { paises: [], zonas: [], gestores: [], paisZonaGrant: [{ pais: 'GUATEMALA', zona: '107' }] } };
  const ctxRD = { isGlobal: false, scope: { paises: [], zonas: [], gestores: [], paisZonaGrant: [{ pais: 'REPUBLICA DOMINICANA', zona: '107' }] } };
  const visiblesGuatemala = applyScope(carteraCompartida, ctxGuatemala, { gestorField: 'gestor', zonaField: 'zona', paisField: 'pais' });
  const visiblesRD = applyScope(carteraCompartida, ctxRD, { gestorField: 'gestor', zonaField: 'zona', paisField: 'pais' });
  assert.equal(visiblesGuatemala.length, 1);
  assert.equal(visiblesGuatemala[0].pais, 'GUATEMALA');
  assert.equal(visiblesRD.length, 1);
  assert.equal(visiblesRD[0].pais, 'REPUBLICA DOMINICANA');
});

test('Carga masiva — ID_PAIS_ZONA: "107GUATEMALA" y "107REPUBLICA DOMINICANA" resuelven a GUATEMALA y REPUBLICA DOMINICANA sin mezclarse (SIN código ISO/abreviatura); ID inválido da error claro; PAIS/ZONA directo sigue funcionando (compatibilidad)', async () => {
  const buf = await buildWorkbook({
    usuarios: [
      ['CREAR', 'gestorIdPz.qatest@example.com', 'Gestor', 'IdPz', 'gestor', 4, 'GESTOR FICTICIO UNO', 'SI'],
      ['CREAR', 'gerenteIdPzGt.qatest@example.com', 'Gerente', 'IdPzGt', 'gerente_zona', 5, '', 'SI'],
      ['CREAR', 'gerenteIdPzRd.qatest@example.com', 'Gerente', 'IdPzRd', 'gerente_zona', 5, '', 'SI'],
      ['CREAR', 'gerenteIdPzMal.qatest@example.com', 'Gerente', 'IdPzMal', 'gerente_zona', 5, '', 'SI']
    ],
    gestorPaisZona: [
      // ID_PAIS_ZONA (4to elemento) sin PAIS/ZONA manuales: se resuelven solos.
      ['gestorIdPz.qatest@example.com', '', '', '107GUATEMALA']
    ],
    gerentePaisZona: [
      ['gerenteIdPzGt.qatest@example.com', '', '', '107GUATEMALA'],
      ['gerenteIdPzRd.qatest@example.com', '', '', '107REPUBLICA DOMINICANA'],
      // ID_PAIS_ZONA inexistente en el catálogo real -> error claro, nunca infiere País desde Zona.
      ['gerenteIdPzMal.qatest@example.com', '', '', '999GUATEMALA']
    ]
  });
  const parsed = await parsearWorkbook(buf);
  const { items } = await validarWorkbook(parsed);

  const filaGt = items.find((i) => i.hoja === 'GESTOR_PAIS_ZONA' && i.email === 'gestorIdPz.qatest@example.com');
  assert.equal(filaGt.estado, 'VALIDO', JSON.stringify(filaGt));
  assert.equal(filaGt.valor, 'GUATEMALA / 107');

  const filaGerGt = items.find((i) => i.hoja === 'GERENTE_PAIS_ZONA' && i.email === 'gerenteIdPzGt.qatest@example.com');
  assert.equal(filaGerGt.estado, 'VALIDO', JSON.stringify(filaGerGt));
  assert.equal(filaGerGt.valor, 'GUATEMALA / 107');

  const filaGerRd = items.find((i) => i.hoja === 'GERENTE_PAIS_ZONA' && i.email === 'gerenteIdPzRd.qatest@example.com');
  assert.equal(filaGerRd.estado, 'VALIDO', JSON.stringify(filaGerRd));
  assert.equal(filaGerRd.valor, 'REPUBLICA DOMINICANA / 107');
  assert.notEqual(filaGerGt.valor, filaGerRd.valor, '107GUATEMALA y 107REPUBLICA DOMINICANA nunca deben resolver al mismo País');

  const filaMal = items.find((i) => i.hoja === 'GERENTE_PAIS_ZONA' && i.email === 'gerenteIdPzMal.qatest@example.com');
  assert.equal(filaMal.estado, 'ERROR');
  assert.equal(filaMal.columna, 'ID_PAIS_ZONA');
  assert.match(filaMal.mensaje, /ID_PAIS_ZONA no válido/);
  assert.match(filaMal.mensaje, /999GUATEMALA/);

  // Aplicar y confirmar que se guardó el País correcto para cada uno (nunca mezclado).
  const { resumen } = await aplicarWorkbook(parsed, true, null);
  assert.equal(resumen.creaciones, 4);
  const gGt = findProfile('gerenteidpzgt.qatest@example.com');
  const gRd = findProfile('gerenteidpzrd.qatest@example.com');
  const pzGt = activeRows('gerente_zona_zona', 'usuario_id', gGt.id);
  const pzRd = activeRows('gerente_zona_zona', 'usuario_id', gRd.id);
  assert.equal(pzGt[0].pais, 'GUATEMALA');
  assert.equal(pzRd[0].pais, 'REPUBLICA DOMINICANA');

  // Compatibilidad (Sección 6): un archivo que SOLO usa PAIS/ZONA (sin ID_PAIS_ZONA) sigue funcionando igual que antes.
  const bufCompat = await buildWorkbook({
    usuarios: [['CREAR', 'gerenteCompatPz.qatest@example.com', 'Gerente', 'CompatPz', 'gerente_zona', 5, '', 'SI']],
    gerentePaisZona: [['gerenteCompatPz.qatest@example.com', 'GUATEMALA', '107']]
  });
  const parsedCompat = await parsearWorkbook(bufCompat);
  const { items: itemsCompat } = await validarWorkbook(parsedCompat);
  const filaCompat = itemsCompat.find((i) => i.hoja === 'GERENTE_PAIS_ZONA');
  assert.equal(filaCompat.estado, 'VALIDO', JSON.stringify(filaCompat));
  assert.equal(filaCompat.valor, 'GUATEMALA / 107');
});

test('Carga masiva — ID_PAIS_ZONA: segundo par de países con la MISMA Zona ("201EL SALVADOR" vs "201HONDURAS") también se resuelven sin mezclarse', async () => {
  const buf = await buildWorkbook({
    usuarios: [
      ['CREAR', 'gerenteZona201Sv.qatest@example.com', 'Gerente', 'Zona201Sv', 'gerente_zona', 5, '', 'SI'],
      ['CREAR', 'gerenteZona201Hn.qatest@example.com', 'Gerente', 'Zona201Hn', 'gerente_zona', 5, '', 'SI']
    ],
    gerentePaisZona: [
      ['gerenteZona201Sv.qatest@example.com', '', '', '201EL SALVADOR'],
      ['gerenteZona201Hn.qatest@example.com', '', '', '201HONDURAS']
    ]
  });
  const parsed = await parsearWorkbook(buf);
  const { items } = await validarWorkbook(parsed);

  const filaSv = items.find((i) => i.hoja === 'GERENTE_PAIS_ZONA' && i.email === 'gerenteZona201Sv.qatest@example.com');
  const filaHn = items.find((i) => i.hoja === 'GERENTE_PAIS_ZONA' && i.email === 'gerenteZona201Hn.qatest@example.com');
  assert.equal(filaSv.estado, 'VALIDO', JSON.stringify(filaSv));
  assert.equal(filaSv.valor, 'EL SALVADOR / 201');
  assert.equal(filaHn.estado, 'VALIDO', JSON.stringify(filaHn));
  assert.equal(filaHn.valor, 'HONDURAS / 201');
  assert.notEqual(filaSv.valor, filaHn.valor, '201EL SALVADOR y 201HONDURAS nunca deben resolver al mismo País');

  const { resumen } = await aplicarWorkbook(parsed, false, null);
  assert.equal(resumen.errores, 0);
  const gSv = findProfile('gerentezona201sv.qatest@example.com');
  const gHn = findProfile('gerentezona201hn.qatest@example.com');
  const pzSv = activeRows('gerente_zona_zona', 'usuario_id', gSv.id);
  const pzHn = activeRows('gerente_zona_zona', 'usuario_id', gHn.id);
  assert.equal(pzSv[0].pais, 'EL SALVADOR');
  assert.equal(pzHn[0].pais, 'HONDURAS');
  assert.equal(pzSv[0].zona_id, pzHn[0].zona_id, 'comparten el mismo número de Zona (201)');
  assert.notEqual(pzSv[0].pais, pzHn[0].pais);
});

test('Carga masiva — Sección 3: una relación que depende de un CREAR con error en USUARIOS nunca se cuenta como válida, aunque el rol declarado sea correcto', async () => {
  const buf = await buildWorkbook({
    usuarios: [
      ['CREAR', 'supervisorSec3.qatest@example.com', 'Supervisor', 'Sec3', 'supervisor', 3, '', 'SI'],
      // NIVEL (99) no corresponde al ROL declarado (gestor = Nivel 4) -> esta fila CREAR fallará: el usuario nunca existirá.
      ['CREAR', 'gestorSec3.qatest@example.com', 'Gestor', 'Sec3', 'gestor', 99, 'GESTOR FICTICIO UNO', 'SI']
    ],
    supervisorGestor: [
      ['supervisorSec3.qatest@example.com', 'gestorSec3.qatest@example.com']
    ]
  });
  const parsed = await parsearWorkbook(buf);
  const { items, resumen } = await validarWorkbook(parsed);

  const filaUsuarioGestor = items.find((i) => i.hoja === 'USUARIOS' && i.email === 'gestorSec3.qatest@example.com');
  assert.equal(filaUsuarioGestor.estado, 'ERROR');

  // La relación SUPERVISOR_GESTOR NO debe marcarse VALIDO solo porque el ROL
  // declarado ('gestor') coincide: el gestor nunca se creará realmente.
  const filaRelacion = items.find((i) => i.hoja === 'SUPERVISOR_GESTOR');
  assert.equal(filaRelacion.estado, 'ERROR', JSON.stringify(filaRelacion));
  assert.match(filaRelacion.mensaje, /tiene errores en la hoja USUARIOS/);
  assert.ok(resumen.errores >= 2);

  // Aplicando "solo válidas": el supervisor se crea, el gestor NO, y NO se crea
  // ninguna relación supervisor_gestor para él (nunca una sincronización parcial silenciosa).
  const { resumen: resumenApply } = await aplicarWorkbook(parsed, true, null);
  assert.equal(resumenApply.creaciones, 1);
  const sup = findProfile('supervisorsec3.qatest@example.com');
  assert.ok(sup);
  assert.equal(findProfile('gestorsec3.qatest@example.com'), undefined);
  const rel = activeRows('supervisor_gestor', 'supervisor_id', sup.id);
  assert.equal(rel.length, 0, 'no debe existir relación supervisor_gestor hacia un gestor que nunca se creó');
});

test('Carga masiva — NUEVA FUENTE DE VERDAD: un Gestor y un Gerente de zona que NO existen en cartera.gestor se crean igual, sus relaciones y su ID_PAIS_ZONA funcionan, y nunca se consulta cartera.gestor para validarlos', async () => {
  carteraQueryLog.length = 0;

  const buf = await buildWorkbook({
    usuarios: [
      ['CREAR', 'supervisorFuenteVerdad.qatest@example.com', 'Supervisor', 'FuenteVerdad', 'supervisor', 3, '', 'SI'],
      // "Bryan Rodriguez" NO existe en db.cartera (fixture): antes daba
      // "NOMBRE_CARTERA no existe en cartera.gestor". Ahora debe crearse igual.
      ['CREAR', 'bryan.rodriguez.fv@qatest.example.com', 'Bryan', 'Rodriguez', 'gestor', 4, 'Bryan Rodriguez', 'SI'],
      ['CREAR', 'angie.buch.fv@qatest.example.com', 'Angie', 'Buch', 'gestor', 4, 'Angie Buch', 'SI'],
      // Un Gerente de zona tampoco depende de cartera.gestor para existir.
      ['CREAR', 'gerenteFuenteVerdad.qatest@example.com', 'Gerente', 'FuenteVerdad', 'gerente_zona', 5, '', 'SI']
    ],
    supervisorGestor: [
      ['supervisorFuenteVerdad.qatest@example.com', 'bryan.rodriguez.fv@qatest.example.com'],
      ['supervisorFuenteVerdad.qatest@example.com', 'angie.buch.fv@qatest.example.com']
    ],
    supervisorGerente: [
      ['supervisorFuenteVerdad.qatest@example.com', 'gerenteFuenteVerdad.qatest@example.com']
    ],
    gestorPaisZona: [
      ['bryan.rodriguez.fv@qatest.example.com', '', '', '107GUATEMALA']
    ],
    gerentePaisZona: [
      ['gerenteFuenteVerdad.qatest@example.com', '', '', '107REPUBLICA DOMINICANA']
    ]
  });

  const parsed = await parsearWorkbook(buf);
  const { items, resumen } = await validarWorkbook(parsed);
  const errores = items.filter((i) => i.estado === 'ERROR');
  assert.equal(errores.length, 0, `no debía haber errores: ${JSON.stringify(errores)}`);
  assert.equal(resumen.creaciones, 4);

  // 1-2) Gestor y Gerente de zona AUSENTES de cartera.gestor se crean sin problema.
  const { resumen: resumenApply } = await aplicarWorkbook(parsed, false, null);
  assert.equal(resumenApply.errores, 0);
  const bryan = findProfile('bryan.rodriguez.fv@qatest.example.com');
  const angie = findProfile('angie.buch.fv@qatest.example.com');
  const gerente = findProfile('gerentefuenteverdad.qatest@example.com');
  const sup = findProfile('supervisorfuenteverdad.qatest@example.com');
  assert.ok(bryan && angie && gerente && sup);

  // 3) Sus relaciones (Supervisor -> Gestor, Supervisor -> Gerente de zona) se crearon.
  const relGestores = activeRows('supervisor_gestor', 'supervisor_id', sup.id).map((r) => r.gestor_id);
  const gBryan = db.gestores.find((g) => g.usuario_id === bryan.id);
  const gAngie = db.gestores.find((g) => g.usuario_id === angie.id);
  assert.ok(gBryan && relGestores.includes(gBryan.id));
  assert.ok(gAngie && relGestores.includes(gAngie.id));
  const relGerentes = activeRows('supervisor_gerente_zona', 'supervisor_id', sup.id).map((r) => r.gerente_zona_id);
  assert.ok(relGerentes.includes(gerente.id));

  // 4) ID_PAIS_ZONA se resolvió correctamente para ambos (107GUATEMALA / 107REPUBLICA DOMINICANA).
  const pzBryan = activeRows('gestor_pais_zona', 'gestor_id', gBryan.id);
  const pzGerente = activeRows('gerente_zona_zona', 'usuario_id', gerente.id);
  assert.equal(pzBryan[0].pais, 'GUATEMALA');
  assert.equal(pzGerente[0].pais, 'REPUBLICA DOMINICANA');

  // 5) NUNCA se consultó la columna `gestor` de cartera durante validar+aplicar
  //    (la única consulta legítima a cartera es pais/zona, dato geográfico operativo).
  const consultasAGestorDeCartera = carteraQueryLog.filter((q) => /gestor/i.test(q.selectCols));
  assert.equal(consultasAGestorDeCartera.length, 0, `no debe consultarse cartera.gestor: ${JSON.stringify(carteraQueryLog)}`);
  assert.ok(carteraQueryLog.length > 0, 'sí debe seguir consultando cartera para País/Zona (dato operativo)');
});
