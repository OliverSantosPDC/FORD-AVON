'use strict';

/**
 * Prueba de `UsuariosService.obtenerResumenAlcance` (resumen visual de
 * Grupos y Niveles): el País/Zona alcanzado por un Gestor (propio o el de su
 * Supervisor/Liderazgo) sale EXCLUSIVAMENTE de `gestor_pais_zona` — nunca de
 * coincidencia de nombre contra `cartera.gestor`.
 *
 * El puente de texto (`carteraDe`/`nombrePorGestorId`, que antes UNÍA
 * gestor_pais_zona con las filas de cartera cuyo nombre coincidía) se
 * eliminó por completo: auditoría real (project vuazzailuqgbjnnbdtrg)
 * confirmó que coincidía con 0 de las 18,107 filas reales de cartera —
 * consistente con `ScopeFilter.applyScope`, cuya única fuente de
 * autorización real es `paisZonaGrant` (`gestor_pais_zona`). Un Gestor sin
 * `gestor_pais_zona` configurado ahora muestra 0 País/Zona en el resumen
 * (reflejando fielmente su alcance real), aunque su nombre coincida con
 * filas de cartera.
 *
 * Ejercita el código YA COMPILADO en dist/ con un cliente Supabase falso en
 * memoria (datos 100% ficticios).
 *
 * Ejecutar (tras `npm run build`): node --test test/resumen-alcance.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const db = {
  profiles: [
    { id: 'user-lider1', activo: true, role_id: 'r-lid', roles: { clave: 'liderazgo', nivel: 2 } },
    { id: 'user-sup1', activo: true, role_id: 'r-sup', roles: { clave: 'supervisor', nivel: 3 } },
    { id: 'user-gestorA', activo: true, role_id: 'r-ges', roles: { clave: 'gestor', nivel: 4 } },
    { id: 'user-gestorB', activo: true, role_id: 'r-ges', roles: { clave: 'gestor', nivel: 4 } },
    { id: 'user-gestorC', activo: true, role_id: 'r-ges', roles: { clave: 'gestor', nivel: 4 } }
  ],
  gestores: [
    // gestorA: SU nombre TAMBIÉN coincide (por casualidad) con una fila de
    // cartera — pero su alcance real viene ÚNICAMENTE de gestor_pais_zona.
    { id: 'g-A', usuario_id: 'user-gestorA', nombre_cartera: 'GESTOR REAL EN CARTERA', activo: true },
    // gestorB: SIN ninguna fila en cartera.gestor — su único alcance real es gestor_pais_zona.
    { id: 'g-B', usuario_id: 'user-gestorB', nombre_cartera: 'GESTOR FANTASMA SIN CARTERA', activo: true },
    // gestorC: nombre coincide con una fila de cartera, pero SIN gestor_pais_zona configurado:
    // debe mostrar 0 País/Zona (nunca recuperarlo vía el puente de texto eliminado).
    { id: 'g-C', usuario_id: 'user-gestorC', nombre_cartera: 'GESTOR SOLO EN CARTERA SIN RELACION', activo: true }
  ],
  supervisor_gestor: [
    { supervisor_id: 'user-sup1', gestor_id: 'g-A', activo: true },
    { supervisor_id: 'user-sup1', gestor_id: 'g-B', activo: true }
  ],
  liderazgo_supervisor: [
    { liderazgo_id: 'user-lider1', supervisor_id: 'user-sup1', activo: true }
  ],
  gerente_zona_zona: [],
  gestor_pais_zona: [
    { gestor_id: 'g-A', pais: 'EL SALVADOR', activo: true, zonas: { nombre: '201' } },
    { gestor_id: 'g-B', pais: 'GUATEMALA', activo: true, zonas: { nombre: '107' } }
  ],
  supervisor_gerente_zona: [],
  cartera: [
    { gestor: 'GESTOR REAL EN CARTERA', pais: 'EL SALVADOR', zona: '201', sector: 'S1' },
    { gestor: 'GESTOR SOLO EN CARTERA SIN RELACION', pais: 'HONDURAS', zona: '301', sector: 'S2' }
    // Ninguna fila con gestor = "GESTOR FANTASMA SIN CARTERA": a propósito.
  ]
};

class Builder {
  constructor(table) { this.table = table; this.filters = []; this.rangeArgs = null; }
  select() { return this; }
  order() { return this; }
  eq(col, val) { this.filters.push((row) => String(row[col]) === String(val)); return this; }
  in(col, vals) { this.filters.push((row) => (vals || []).map(String).includes(String(row[col]))); return this; }
  range(from, to) { this.rangeArgs = [from, to]; return this; }
  _rows() {
    let rows = (db[this.table] || []).filter((row) => this.filters.every((f) => f(row)));
    if (this.rangeArgs) { const [from, to] = this.rangeArgs; rows = rows.slice(from, to + 1); }
    return rows.map((r) => ({ ...r }));
  }
  then(resolve, reject) { return Promise.resolve({ data: this._rows(), error: null }).then(resolve, reject); }
}

const fakeClient = { from: (t) => new Builder(t) };
const supabaseJsPath = require.resolve('@supabase/supabase-js');
const fakeModule = new Module(supabaseJsPath);
fakeModule.exports = { createClient: () => fakeClient };
fakeModule.loaded = true;
require.cache[supabaseJsPath] = fakeModule;

const distDir = path.join(__dirname, '..', 'dist');
const { obtenerResumenAlcance } = require(path.join(distDir, 'services', 'UsuariosService.js'));

test('obtenerResumenAlcance: el Gestor con solo gestor_pais_zona (sin match en cartera.gestor) muestra SU País/Zona real', async () => {
  const { items } = await obtenerResumenAlcance();
  const gestorB = items.find((i) => i.userId === 'user-gestorB');
  assert.deepEqual(gestorB.paises, ['GUATEMALA']);
  assert.deepEqual(gestorB.zonas, ['107']);
});

test('obtenerResumenAlcance: el Gestor muestra SU País/Zona real vía gestor_pais_zona (aunque su nombre también coincida con cartera)', async () => {
  const { items } = await obtenerResumenAlcance();
  const gestorA = items.find((i) => i.userId === 'user-gestorA');
  assert.deepEqual(gestorA.paises, ['EL SALVADOR']);
  assert.deepEqual(gestorA.zonas, ['201']);
});

test('obtenerResumenAlcance: un Gestor cuyo nombre coincide con cartera PERO sin gestor_pais_zona configurado muestra 0 País/Zona (nunca recupera el puente de texto eliminado)', async () => {
  const { items } = await obtenerResumenAlcance();
  const gestorC = items.find((i) => i.userId === 'user-gestorC');
  assert.deepEqual(gestorC.paises, []);
  assert.deepEqual(gestorC.zonas, []);
});

test('obtenerResumenAlcance: el Supervisor ve la UNIÓN de AMBOS Gestores (antes: solo el que coincidía por nombre)', async () => {
  const { items } = await obtenerResumenAlcance();
  const sup1 = items.find((i) => i.userId === 'user-sup1');
  assert.equal(sup1.totalGestores, 2);
  assert.deepEqual(sup1.paises.sort(), ['EL SALVADOR', 'GUATEMALA']);
  assert.deepEqual(sup1.zonas.sort(), ['107', '201']);
});

test('obtenerResumenAlcance: el Liderazgo ve la UNIÓN TRANSITIVA de los Gestores de su Supervisor', async () => {
  const { items } = await obtenerResumenAlcance();
  const lider1 = items.find((i) => i.userId === 'user-lider1');
  assert.equal(lider1.totalSupervisores, 1);
  assert.equal(lider1.totalGestores, 2);
  assert.deepEqual(lider1.paises.sort(), ['EL SALVADOR', 'GUATEMALA']);
  assert.deepEqual(lider1.zonas.sort(), ['107', '201']);
});
