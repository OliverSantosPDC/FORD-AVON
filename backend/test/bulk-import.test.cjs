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
    { id: 'zona-208', nombre: '208', codigo: '208', activo: true }
  ],
  cartera: [
    { pais: 'GUATEMALA', zona: '107', gestor: 'GESTOR FICTICIO UNO' },
    { pais: 'REPUBLICA DOMINICANA', zona: '107', gestor: 'GESTOR FICTICIO UNO' },
    { pais: 'EL SALVADOR', zona: '208', gestor: 'GESTOR FICTICIO DOS' }
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
    ws.columns = [{ header: colEmail, key: 'email' }, { header: 'PAIS', key: 'pais' }, { header: 'ZONA', key: 'zona' }];
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
