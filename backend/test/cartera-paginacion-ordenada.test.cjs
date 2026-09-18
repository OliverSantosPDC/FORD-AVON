'use strict';

/**
 * INVESTIGACIÓN "RD sin zonas en el filtro" / "Gerente aparece pero da 0" —
 * causa raíz encontrada trazando el flujo COMPLETO (no solo las funciones
 * puras de agregación, que ya se habían probado y funcionaban correctamente
 * con datos representativos de RD).
 *
 * `SupabaseCarteraAdapter.getCartera()` (la fuente de TODAS las filas que
 * alimentan Dashboard/Centro de Inteligencia/Control Operativo) lee la tabla
 * `cartera` en páginas de 1000 filas lanzadas en PARALELO (`Promise.all`)
 * usando `.range(from, to)` — SIN `.order()`. `UsuariosService.ts` tenía el
 * mismo patrón (secuencial, pero también sin `.order()`) en dos funciones más
 * (`distinctCarteraPaisZona`, `cargarCarteraResumen`).
 *
 * Esto es un problema DOCUMENTADO de PostgREST/Postgres: sin un `ORDER BY`
 * explícito, `range()`/`LIMIT+OFFSET` NO garantiza qué filas caen en cada
 * página — el plan de ejecución puede variar entre queries (más aún al
 * lanzarlas en paralelo), causando que algunas filas queden OMITIDAS de
 * TODAS las páginas o DUPLICADAS, de forma no determinística entre cargas.
 * `cartera` además se trunca y reinserta completa cada mes (import de
 * Excel), por lo que no existe ningún orden físico estable garantizado.
 *
 * Esto explica ambos síntomas reportados sin necesidad de ningún cambio de
 * identidad/scope: si las filas de una Zona de RD (o las de un Gerente
 * específico) caen en una página que la paginación sin orden pierde, esas
 * filas simplemente NUNCA llegan a `buildFilterOptions`/`filterCarteraRows`
 * — el catálogo de personas (ya 100% correcto, ver commits previos) puede
 * mostrar la opción perfectamente, mientras la CARTERA que debería
 * respaldarla llega incompleta desde el repositorio.
 *
 * CORRECCIÓN: agregar `.order('id', { ascending: true })` (cartera.id es la
 * PK identity, estable) antes de cada `.range()` en los tres puntos
 * afectados — hace que cada página sea un slice determinista del MISMO
 * orden total, sin importar cuántas páginas se lancen en paralelo.
 *
 * Esta prueba es un TEST DE CONTRATO: no puede reproducir la no-determinismo
 * real de Postgres (imposible de simular fielmente en un mock síncrono de un
 * solo hilo), pero verifica que el código SIEMPRE solicita `.order()` antes
 * de `.range()` en la lectura paginada de cartera — si una futura edición
 * elimina esa llamada, esta prueba falla de inmediato.
 *
 * Ejecutar (tras `npm run build`): node --test test/cartera-paginacion-ordenada.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

// 2500 filas ficticias (3 páginas de 1000) — un subconjunto marcado como RD,
// deliberadamente NO contiguo con la Zona bajo prueba al final del rango,
// para que una paginación incompleta/mal ordenada pierda filas reales.
const TOTAL_FILAS = 2500;
const cartera = [];
for (let i = 0; i < TOTAL_FILAS; i += 1) {
  const esRD = i % 7 === 0; // disperso a lo largo de toda la tabla, no agrupado
  cartera.push({
    id: i + 1,
    codigo: `CTA-${i}`,
    pais: esRD ? 'REPUBLICA DOMINICANA' : 'GUATEMALA',
    zona: esRD ? '107' : '201',
    gestor: 'X',
    saldo_actual_usd: 1
  });
}
const totalRD = cartera.filter((r) => r.pais === 'REPUBLICA DOMINICANA').length;

class Builder {
  constructor(table) { this.table = table; this.filters = []; this._ordered = false; this._orderCol = null; this._count = false; }
  select(_cols, opts) { if (opts && opts.count === 'exact' && opts.head) this._count = true; return this; }
  eq() { return this; }
  order(col, opts) { this._ordered = true; this._orderCol = col; this._asc = !(opts && opts.ascending === false); return this; }
  range(from, to) {
    if (this._count) return Promise.resolve({ count: cartera.length, error: null });
    if (!this._ordered) {
      // Simula la CAUSA RAÍZ real: sin `.order()`, la paginación no es
      // determinista/completa. Aquí lo hacemos explícito y ruidoso (en vez de
      // simular aleatoriedad, que sería un test inestable): cualquier lectura
      // paginada de `cartera` SIN order() se considera un defecto y la prueba
      // debe fallar con un mensaje claro, no silenciosamente perder filas.
      throw new Error(`BUG: paginación de "${this.table}" con range(${from},${to}) sin .order() previo — riesgo real de filas omitidas/duplicadas (PostgREST/Postgres).`);
    }
    const ordenadas = [...cartera].sort((a, b) => (this._asc ? a.id - b.id : b.id - a.id));
    const slice = ordenadas.slice(from, to + 1);
    return Promise.resolve({ data: slice, error: null });
  }
  then(resolve, reject) { return this.range(0, cartera.length - 1).then(resolve, reject); }
}

const fakeClient = { from: (t) => new Builder(t) };
const supabaseJsPath = require.resolve('@supabase/supabase-js');
const fakeModule = new Module(supabaseJsPath);
fakeModule.exports = { createClient: () => fakeClient };
fakeModule.loaded = true;
require.cache[supabaseJsPath] = fakeModule;

const distDir = path.join(__dirname, '..', 'dist');
const { SupabaseCarteraAdapter } = require(path.join(distDir, 'adapters', 'supabase', 'SupabaseCarteraAdapter.js'));

test('SupabaseCarteraAdapter.getCartera(): pagina SIEMPRE con .order() antes de .range() — lee las 2500 filas completas, sin omitir ninguna fila de RD dispersa entre páginas', async () => {
  const adapter = new SupabaseCarteraAdapter('cartera');
  const rows = await adapter.getCartera();
  assert.equal(rows.length, TOTAL_FILAS, 'Debe leer la tabla completa (3 páginas), sin filas perdidas');
  const rd = rows.filter((r) => r.pais === 'REPUBLICA DOMINICANA');
  assert.equal(rd.length, totalRD, 'Ninguna fila de RD debe perderse, sin importar en qué página física caiga');
  // También confirma que no hay duplicados (mismo riesgo del bug: filas repetidas en páginas distintas).
  const idsUnicos = new Set(rows.map((r) => r.id));
  assert.equal(idsUnicos.size, TOTAL_FILAS, 'Ninguna fila debe duplicarse entre páginas');
});
