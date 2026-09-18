'use strict';

/**
 * CORRECCIÓN ARQUITECTÓNICA DEFINITIVA — pruebas de arquitectura que cierran
 * los escenarios de la matriz de 20 casos que aún no tenían cobertura
 * explícita tras los commits `0241114` (identidad vs. alcance geográfico) y
 * `55550b6` (relación cruzada Gestor↔Gerente vía Supervisor compartido).
 *
 * DECISIÓN DE ARQUITECTURA (sesión actual): se auditó con SQL real sobre
 * Supabase (project vuazzailuqgbjnnbdtrg) si convenía agregar
 * `cartera.gestor_id`/`cartera.gerente_zona_id` resueltos por nombre. El
 * resultado: `cartera.gestor` (texto ERP) NO coincide con NINGÚN
 * `gestores.nombre_cartera` vigente (0/18,107 filas) — los nombres curados
 * son deliberadamente distintos del texto operativo; un backfill por nombre
 * habría resuelto 0 filas. La resolución real de acceso hoy es 100%
 * geográfica (`gestor_pais_zona`/`gerente_zona_zona`, ya verificada por
 * ScopeService en cada request). Se decidió (opción elegida por el usuario)
 * NO crear columnas de ID en `cartera`, NO tocar el importador ni
 * ScopeFilter: la fuente de identidad/scope ya es exclusivamente
 * usuarios/roles/relaciones, y `gestor_pais_zona`/`gerente_zona_zona` ya
 * cumplen el rol de "identificador estable" sin necesidad de una columna
 * cacheada en `cartera` (que además quedaría desactualizada hasta el
 * próximo reimport, dado que `cartera` se trunca y reinserta completa en
 * cada carga de Excel — ver `CarteraImportService.ts`).
 *
 * Ejecutar (tras `npm run build`): node --test test/arquitectura-fuente-unica.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const AYER = '2026-09-12';

const db = {
  acceso_global_temporal: [],
  roles: [
    { id: 'role-gerente-zona', clave: 'gerente_zona' },
    { id: 'role-gestor', clave: 'gestor' }
  ],
  zonas: [{ id: 'zona-133', nombre: '133', activo: true }],
  profiles: [
    { id: 'user-daniel', activo: true, nombre: 'Daniel', apellido: 'Monge', role_id: null },
    { id: 'user-gestor-x', activo: true, nombre: 'Gestor', apellido: 'ConNombreCambiante', role_id: 'role-gestor' },
    { id: 'user-gestor-0zonas', activo: true, nombre: 'Gestor', apellido: 'CeroZonas', role_id: 'role-gestor' },
    { id: 'user-gerente-activo', activo: true, nombre: 'Gerente', apellido: 'Activo', role_id: 'role-gerente-zona' },
    // Perfil con rol gerente_zona pero DESACTIVADO — conserva relaciones antiguas
    // (supervisor_gerente_zona + gerente_zona_zona), como un ex-empleado.
    { id: 'user-gerente-inactivo', activo: false, nombre: 'Gerente', apellido: 'Inactivo', role_id: 'role-gerente-zona' }
  ],
  gestores: [
    { id: 'gestor-x', usuario_id: 'user-gestor-x', nombre_cartera: 'Nombre Original', activo: true },
    { id: 'gestor-0zonas', usuario_id: 'user-gestor-0zonas', nombre_cartera: 'Gestor Cero Zonas', activo: true }
  ],
  gestor_pais_zona: [
    { id: 'gpz-x', gestor_id: 'gestor-x', zona_id: 'zona-133', pais: 'REPUBLICA DOMINICANA', activo: true, fecha_inicio: AYER, fecha_fin: null }
    // gestor-0zonas: intencionalmente 0 filas.
  ],
  gerente_zona_zona: [
    { id: 'gzz-activo', usuario_id: 'user-gerente-activo', zona_id: 'zona-133', pais: 'REPUBLICA DOMINICANA', activo: true, fecha_inicio: AYER, fecha_fin: null },
    // El inactivo conserva una relación vigente en la tabla — pero su PERFIL está desactivado.
    { id: 'gzz-inactivo', usuario_id: 'user-gerente-inactivo', zona_id: 'zona-133', pais: 'REPUBLICA DOMINICANA', activo: true, fecha_inicio: AYER, fecha_fin: null }
  ],
  supervisor_gestor: [
    { id: 'sg-x', supervisor_id: 'user-daniel', gestor_id: 'gestor-x', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sg-0zonas', supervisor_id: 'user-daniel', gestor_id: 'gestor-0zonas', activo: true, fecha_inicio: AYER, fecha_fin: null }
  ],
  supervisor_gerente_zona: [
    { id: 'sgz-activo', supervisor_id: 'user-daniel', gerente_zona_id: 'user-gerente-activo', activo: true, fecha_inicio: AYER, fecha_fin: null },
    { id: 'sgz-inactivo', supervisor_id: 'user-daniel', gerente_zona_id: 'user-gerente-inactivo', activo: true, fecha_inicio: AYER, fecha_fin: null }
  ],
  liderazgo_supervisor: [],
  // Tabla de auditoría de reasignaciones — a propósito con un nombre que NO
  // corresponde a ningún usuario/gestor real. Ninguna función bajo prueba
  // consulta esta tabla (ver ScopeService/carteraAggregations): se incluye
  // aquí solo para demostrar que su sola presencia no filtra a los catálogos.
  asignaciones: [
    { id: 'asig-1', codigo: 'CTA-999', gestor_anterior: null, gestor_nuevo: 'Persona Solo En Asignacion', tipo: 'MANUAL', pais: 'REPUBLICA DOMINICANA', asignado_por: 'user-daniel' }
  ]
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

class Builder {
  constructor(table) { this.table = table; this.filters = []; this.limitN = null; }
  select() { return this; }
  order() { return this; }
  eq(col, val) { this.filters.push((row) => String(row[col]) === String(val)); return this; }
  in(col, vals) { this.filters.push((row) => (vals || []).map(String).includes(String(row[col]))); return this; }
  lte(col, val) { this.filters.push((row) => row[col] !== null && row[col] !== undefined && String(row[col]) <= String(val)); return this; }
  gte(col, val) { this.filters.push((row) => row[col] !== null && row[col] !== undefined && String(row[col]) >= String(val)); return this; }
  or(expr) { const preds = parseOrClause(expr); this.filters.push((row) => preds.some((p) => p(row))); return this; }
  limit(n) { this.limitN = n; return this; }
  _rows() {
    let rows = (db[this.table] || []).filter((row) => this.filters.every((f) => f(row)));
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    return rows.map((r) => ({ ...r }));
  }
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
const { resolveScopeContext, gestoresEnAlcance, gerentesZonaEnAlcance } = require(path.join(distDir, 'services', 'ScopeService.js'));
const { buildFilterOptions } = require(path.join(distDir, 'utils', 'carteraAggregations.js'));

const EMPTY_FILTERS = { pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] };

const obtenerPersonasAdmin = async () => {
  const ctx = await resolveScopeContext({ userId: 'user-admin', roleClave: 'administrador', permissions: [] });
  return { gestores: await gestoresEnAlcance(ctx), gerentes: await gerentesZonaEnAlcance(ctx) };
};

test('#4 Un Gerente con rol y relaciones vigentes pero PERFIL desactivado (activo=false) nunca aparece como persona', async () => {
  const personas = await obtenerPersonasAdmin();
  assert.ok(!personas.gerentes.some((g) => g.nombre === 'Gerente Inactivo'));
  const opts = buildFilterOptions([], EMPTY_FILTERS, personas);
  assert.ok(!opts.gerente.includes('Gerente Inactivo'));
});

test('#5/#6 Cambiar el nombre (profiles.nombre/apellido o gestores.nombre_cartera) de una persona NUNCA rompe su identidad: sus relaciones (gestor_pais_zona) siguen intactas bajo el nuevo nombre, indexadas por ID', async () => {
  const antes = await obtenerPersonasAdmin();
  const gestorAntes = antes.gestores.find((g) => g.nombre === 'Nombre Original');
  assert.ok(gestorAntes);
  assert.deepEqual(gestorAntes.paisZona.map((pz) => pz.zona), ['133']);

  // Simula un rename administrativo: mismo `gestores.id`, mismo `usuario_id`, nuevo nombre_cartera.
  db.gestores = db.gestores.map((g) => (g.id === 'gestor-x' ? { ...g, nombre_cartera: 'Nombre Renombrado' } : g));

  const despues = await obtenerPersonasAdmin();
  assert.ok(!despues.gestores.some((g) => g.nombre === 'Nombre Original'), 'El nombre viejo ya no debe existir como persona');
  const gestorDespues = despues.gestores.find((g) => g.nombre === 'Nombre Renombrado');
  assert.ok(gestorDespues, 'El nombre nuevo debe existir');
  assert.deepEqual(gestorDespues.paisZona.map((pz) => pz.zona), ['133'], 'La relación gestor_pais_zona (indexada por gestor_id, no por nombre) sigue intacta tras el rename');

  db.gestores = db.gestores.map((g) => (g.id === 'gestor-x' ? { ...g, nombre_cartera: 'Nombre Original' } : g));
});

test('#9 Un Gestor con 0 zonas (gestor_pais_zona) sigue siendo una persona válida en el catálogo, sin filtro geográfico activo', async () => {
  const personas = await obtenerPersonasAdmin();
  const gestor = personas.gestores.find((g) => g.nombre === 'Gestor Cero Zonas');
  assert.ok(gestor, 'Debe existir como persona pese a 0 relaciones geográficas');
  assert.deepEqual(gestor.paisZona, []);
  const opts = buildFilterOptions([], EMPTY_FILTERS, personas);
  assert.ok(opts.gestor.includes('Gestor Cero Zonas'));
});

test('#15 La tabla `asignaciones` (reasignaciones históricas) nunca crea una persona ni aparece en ningún catálogo, aunque contenga un nombre que no corresponde a ningún usuario', async () => {
  assert.ok(db.asignaciones.some((a) => a.gestor_nuevo === 'Persona Solo En Asignacion'), 'Fixture de control: el nombre existe en asignaciones');
  const personas = await obtenerPersonasAdmin();
  assert.ok(!personas.gestores.some((g) => g.nombre === 'Persona Solo En Asignacion'));
  assert.ok(!personas.gerentes.some((g) => g.nombre === 'Persona Solo En Asignacion'));
  const opts = buildFilterOptions([], EMPTY_FILTERS, personas);
  assert.ok(!opts.gestor.includes('Persona Solo En Asignacion'));
  assert.ok(!opts.gerente.includes('Persona Solo En Asignacion'));
});

test('#20 Cambiar el contenido de CARTERA nunca modifica el catálogo de personas (Gestor/Gerente): mismo `personas`, cartera vacía vs. cartera con nombres arbitrarios → mismas opciones de Gestor/Gerente', async () => {
  const personas = await obtenerPersonasAdmin();
  const optsCarteraVacia = buildFilterOptions([], EMPTY_FILTERS, personas);
  const carteraConNombresArbitrarios = [
    { codigo: 'X-1', gestor: 'NOMBRE QUE NO EXISTE EN USUARIOS', gerente_zona: 'OTRO NOMBRE INVENTADO', pais: 'HONDURAS', zona: '999' },
    { codigo: 'X-2', gestor: 'Nombre Original', gerente_zona: 'Gerente Activo', pais: 'REPUBLICA DOMINICANA', zona: '133' }
  ];
  const optsCarteraConDatos = buildFilterOptions(carteraConNombresArbitrarios, EMPTY_FILTERS, personas);
  assert.deepEqual(optsCarteraVacia.gestor, optsCarteraConDatos.gestor, 'El catálogo de Gestor es invariante al contenido de cartera');
  assert.deepEqual(optsCarteraVacia.gerente, optsCarteraConDatos.gerente, 'El catálogo de Gerente es invariante al contenido de cartera');
  // Las dimensiones operativas (país/zona/pd/campania) SÍ dependen de cartera — eso es correcto y distinto de identidad.
  assert.deepEqual(optsCarteraVacia.pais, []);
  assert.ok(optsCarteraConDatos.pais.length > 0);
});
