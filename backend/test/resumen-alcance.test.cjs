'use strict';

/**
 * Prueba de `UsuariosService.obtenerResumenAlcance` (resumen visual de
 * Grupos y Niveles) tras eliminar el fallback condicional a `cartera` para
 * calcular el País/Zona alcanzado por un Gestor.
 *
 * ANTES: para Liderazgo/Supervisor, el País/Zona mostrado de cada uno de sus
 * Gestores salía EXCLUSIVAMENTE de `carteraDe(nombres)` (coincidencia de
 * nombre en cartera.gestor) — nunca se consultaba `gestor_pais_zona` para
 * ellos (sí se consultaba, pero solo para el propio renglón del Gestor, con
 * un if/else exclusivo: si tenía explícito, NUNCA sumaba lo de cartera). Un
 * Gestor con alcance SOLO vía gestor_pais_zona (sin match de nombre, el caso
 * Bryan Rodriguez/Angie Buch) aportaba CERO País/Zona al resumen de su
 * Supervisor/Liderazgo, aunque su scope real (ScopeFilter.applyScope) sí lo
 * incluyera correctamente.
 *
 * AHORA: `paisZonaDeGestorId` es una UNIÓN (nunca condicional) de ambas
 * fuentes, reutilizada tanto por el renglón propio del Gestor como por el de
 * su Supervisor/Liderazgo — consistente con ScopeFilter.applyScope.
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
    { id: 'user-gestorB', activo: true, role_id: 'r-ges', roles: { clave: 'gestor', nivel: 4 } }
  ],
  gestores: [
    // gestorA: coincide por NOMBRE con una fila real de cartera.
    { id: 'g-A', usuario_id: 'user-gestorA', nombre_cartera: 'GESTOR REAL EN CARTERA', activo: true },
    // gestorB: SIN ninguna fila en cartera.gestor — su único alcance real es gestor_pais_zona.
    { id: 'g-B', usuario_id: 'user-gestorB', nombre_cartera: 'GESTOR FANTASMA SIN CARTERA', activo: true }
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
    { gestor_id: 'g-B', pais: 'GUATEMALA', activo: true, zonas: { nombre: '107' } }
  ],
  supervisor_gerente_zona: [],
  cartera: [
    { gestor: 'GESTOR REAL EN CARTERA', pais: 'EL SALVADOR', zona: '201', sector: 'S1' }
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

test('obtenerResumenAlcance: el Gestor con match de nombre en cartera muestra SU País/Zona real (vía el puente de texto)', async () => {
  const { items } = await obtenerResumenAlcance();
  const gestorA = items.find((i) => i.userId === 'user-gestorA');
  assert.deepEqual(gestorA.paises, ['EL SALVADOR']);
  assert.deepEqual(gestorA.zonas, ['201']);
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
