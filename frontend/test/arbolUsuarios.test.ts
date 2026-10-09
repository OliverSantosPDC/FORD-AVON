/**
 * FORD-AVON — Vista jerárquica de Usuarios (Configuración > Usuarios):
 * sustituye la tabla plana por un árbol Administrador / Liderazgo ->
 * Supervisor -> Gestor + Gerente de zona -> País -> División -> Zona.
 *
 * Prueba la lógica PURA de armado del árbol (construirArbolUsuarios), sin
 * backend ni DOM: dado un `ArbolUsuarios` (el mismo contrato normalizado que
 * devuelve GET /api/usuarios/arbol), verifica que las relaciones reales se
 * respeten exactamente — nunca se inventa una relación ni se asigna por
 * coincidencia de nombre — que un usuario con varias zonas/divisiones
 * aparezca con TODAS sus combinaciones sin duplicar su identidad, que la
 * ausencia de relación se muestre como "Sin asignación" explícito, y que
 * los filtros (búsqueda, rol, país) narrowen el árbol sin romper nada.
 *
 * Ejecutar: node --experimental-strip-types --test test/arbolUsuarios.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { construirArbolUsuarios, type ArbolNodo } from '../src/pages/Usuarios/arbolUsuarios.ts';
import type { ArbolUsuarioInfo, ArbolUsuarios } from '../src/services/usuariosService.ts';

const usuario = (over: Partial<ArbolUsuarioInfo> & { id: string }): ArbolUsuarioInfo => ({
  nombre: over.id, apellido: null, nombreCompleto: null, email: `${over.id}@example.com`,
  contacto: null, pais: null, activo: true, roleClave: null, roleNombre: null, nivel: null,
  ...over
});

const DATA: ArbolUsuarios = {
  usuarios: [
    usuario({ id: 'admin1', nombre: 'Ana', apellido: 'Admin', roleClave: 'administrador', roleNombre: 'Administrador', nivel: 1 }),
    usuario({ id: 'lid1', nombre: 'Luis', apellido: 'Lider', roleClave: 'liderazgo', roleNombre: 'Liderazgo', nivel: 2 }),
    usuario({ id: 'sup1', nombre: 'Sara', apellido: 'Supervisa', roleClave: 'supervisor', roleNombre: 'Supervisor', nivel: 3 }),
    usuario({ id: 'sup2', nombre: 'Saul', apellido: 'Solo', roleClave: 'supervisor', roleNombre: 'Supervisor', nivel: 3 }),
    usuario({ id: 'ges1', nombre: 'Gaby', apellido: 'Gestora', roleClave: 'gestor', roleNombre: 'Gestor', nivel: 4 }),
    usuario({ id: 'ges2', nombre: 'Gus', apellido: 'Gestor', roleClave: 'gestor', roleNombre: 'Gestor', nivel: 4 }),
    usuario({ id: 'ger1', nombre: 'Gerardo', apellido: 'Zona', roleClave: 'gerente_zona', roleNombre: 'Gerente de Zona', nivel: 5 }),
    usuario({ id: 'otro1', nombre: 'Otro', apellido: 'Rol', roleClave: 'invitado', roleNombre: 'Invitado', nivel: null })
  ],
  liderazgoSupervisor: [{ liderazgoId: 'lid1', supervisorId: 'sup1' }],
  supervisorGestor: [{ supervisorId: 'sup1', gestorUsuarioId: 'ges1' }],
  supervisorGerenteZona: [{ supervisorId: 'sup1', gerenteZonaId: 'ger1' }],
  gestorPaisZona: [
    { gestorUsuarioId: 'ges1', zonaId: 'z101', zona: '101', pais: 'GUATEMALA' },
    { gestorUsuarioId: 'ges1', zonaId: 'z104', zona: '104', pais: 'GUATEMALA' }
  ],
  gerenteZonaZona: [
    { usuarioId: 'ger1', zonaId: 'z101', zona: '101', pais: 'GUATEMALA', division: 'CONACASTE' },
    { usuarioId: 'ger1', zonaId: 'z201', zona: '201', pais: 'GUATEMALA', division: 'OCCIDENTE' }
  ]
};

const sinFiltros = { search: '', rol: '', pais: '' };

const findChild = (nodo: ArbolNodo, label: string): ArbolNodo => {
  const hijo = nodo.children.find((c) => c.label === label);
  assert.ok(hijo, `se esperaba un hijo con label "${label}" dentro de "${nodo.label}" (hijos: ${nodo.children.map((c) => c.label).join(', ')})`);
  return hijo!;
};
const findRaiz = (raices: ArbolNodo[], label: string): ArbolNodo => {
  const r = raices.find((n) => n.label === label);
  assert.ok(r, `se esperaba el grupo raíz "${label}"`);
  return r!;
};

test('Liderazgo -> Supervisor -> Gestor + Gerente de zona -> País -> División -> Zona: respeta exactamente las relaciones reales', () => {
  const { raices } = construirArbolUsuarios(DATA, sinFiltros);
  const liderazgoRaiz = findRaiz(raices, 'Liderazgo');
  const lid1 = findChild(liderazgoRaiz, 'Luis Lider');
  const sup1 = findChild(lid1, 'Sara Supervisa');

  const gestoresGrupo = findChild(sup1, 'Gestores asignados');
  const ges1Nested = findChild(gestoresGrupo, 'Gaby Gestora');
  const paisGes1 = findChild(ges1Nested, 'GUATEMALA');
  assert.deepEqual(paisGes1.children.map((z) => z.label).sort(), ['Zona 101', 'Zona 104']);

  const gerentesGrupo = findChild(sup1, 'Gerentes de Zona asignados');
  const ger1Nested = findChild(gerentesGrupo, 'Gerardo Zona');
  const paisGer1 = findChild(ger1Nested, 'GUATEMALA');
  assert.deepEqual(paisGer1.children.map((d) => d.label).sort(), ['CONACASTE', 'OCCIDENTE']);
});

test('Gerente de zona con varias divisiones/zonas aparece con TODAS sus combinaciones, sin inventar ninguna', () => {
  const { raices } = construirArbolUsuarios(DATA, sinFiltros);
  const gerRaiz = findRaiz(raices, 'Gerente de zona');
  const ger1 = findChild(gerRaiz, 'Gerardo Zona');
  const pais = findChild(ger1, 'GUATEMALA');
  assert.equal(pais.children.length, 2);
  const conacaste = findChild(pais, 'CONACASTE');
  assert.deepEqual(conacaste.children.map((z) => z.label), ['Zona 101']);
  const occidente = findChild(pais, 'OCCIDENTE');
  assert.deepEqual(occidente.children.map((z) => z.label), ['Zona 201']);
});

test('Supervisor sin Liderazgo y sin Gestores/Gerentes muestra "Sin asignación" explícito, nunca inventa una jerarquía', () => {
  const { raices } = construirArbolUsuarios(DATA, sinFiltros);
  const supRaiz = findRaiz(raices, 'Supervisor');
  const sup2 = findChild(supRaiz, 'Saul Solo');
  assert.equal(sup2.subtitle, 'Sin líder asignado');
  const gestoresGrupo = findChild(sup2, 'Gestores asignados');
  assert.deepEqual(gestoresGrupo.children.map((c) => c.label), ['Sin gestores asignados']);
  assert.equal(gestoresGrupo.children[0].tipo, 'mensaje');
  const gerentesGrupo = findChild(sup2, 'Gerentes de Zona asignados');
  assert.deepEqual(gerentesGrupo.children.map((c) => c.label), ['Sin gerentes de zona asignados']);
});

test('Gestor sin supervisor y sin País/Zona asignado muestra "Sin asignación", y el subtítulo indica "Sin supervisor asignado"', () => {
  const { raices } = construirArbolUsuarios(DATA, sinFiltros);
  const gesRaiz = findRaiz(raices, 'Gestor');
  const ges2 = findChild(gesRaiz, 'Gus Gestor');
  assert.equal(ges2.subtitle, 'Sin supervisor asignado');
  assert.deepEqual(ges2.children.map((c) => c.label), ['Sin asignación']);
});

test('Un mismo Gestor/Gerente visible bajo su Supervisor Y en su grupo raíz no duplica su identidad: totalVisible cuenta usuarios DISTINTOS', () => {
  const { totalVisible } = construirArbolUsuarios(DATA, sinFiltros);
  // admin1, lid1, sup1, sup2, ges1, ges2, ger1, otro1 = 8 usuarios reales distintos,
  // aunque ges1/ger1 aparezcan en dos ramas del árbol (anidados y en su grupo raíz).
  assert.equal(totalVisible, 8);
});

test('Grupo raíz "Otros" agrupa roles fuera del catálogo conocido (nunca se descarta un usuario por tener un rol inesperado)', () => {
  const { raices } = construirArbolUsuarios(DATA, sinFiltros);
  const otros = findRaiz(raices, 'Otros');
  assert.deepEqual(otros.children.map((c) => c.label), ['Otro Rol']);
});

test('Filtro de búsqueda por nombre narrowea a la rama que contiene esa coincidencia (y descarta el resto)', () => {
  const { raices } = construirArbolUsuarios(DATA, { ...sinFiltros, search: 'Gaby' });
  const liderazgoRaiz = findRaiz(raices, 'Liderazgo');
  const lid1 = findChild(liderazgoRaiz, 'Luis Lider');
  const sup1 = findChild(lid1, 'Sara Supervisa');
  const gestoresGrupo = findChild(sup1, 'Gestores asignados');
  assert.deepEqual(gestoresGrupo.children.map((c) => c.label), ['Gaby Gestora']);
  // Gerentes de zona no calificó la búsqueda: su subgrupo queda vacío y se omite (no "Sin gerentes...").
  assert.equal(sup1.children.some((c) => c.label === 'Gerentes de Zona asignados'), false);
  // Grupos raíz sin ninguna coincidencia (Gestor con ges2, Gerente de zona) no aparecen.
  assert.equal(raices.some((r) => r.label === 'Gerente de zona'), false);
});

test('Filtro de búsqueda por código de zona (ej. "201") encuentra al Gerente de zona dueño de esa zona', () => {
  const { raices } = construirArbolUsuarios(DATA, { ...sinFiltros, search: '201' });
  const gerRaiz = findRaiz(raices, 'Gerente de zona');
  assert.deepEqual(gerRaiz.children.map((c) => c.label), ['Gerardo Zona']);
});

test('Filtro de país (GUATEMALA) conserva las ramas con territorio en ese país y deja intactos Administrador/Otros (sin concepto de país)', () => {
  const { raices } = construirArbolUsuarios(DATA, { ...sinFiltros, pais: 'GUATEMALA' });
  assert.ok(raices.some((r) => r.label === 'Liderazgo'));
  assert.ok(raices.some((r) => r.label === 'Administrador'), 'Administrador (acceso global) nunca se excluye por país');
  assert.ok(raices.some((r) => r.label === 'Otros'), 'Otros (sin territorio) nunca se excluye por país');
});

test('Filtro de país sin ninguna coincidencia real elimina los grupos territoriales pero conserva Administrador/Otros', () => {
  const { raices } = construirArbolUsuarios(DATA, { ...sinFiltros, pais: 'HONDURAS' });
  assert.equal(raices.some((r) => r.label === 'Liderazgo'), false);
  assert.equal(raices.some((r) => r.label === 'Supervisor'), false);
  assert.equal(raices.some((r) => r.label === 'Gestor'), false);
  assert.equal(raices.some((r) => r.label === 'Gerente de zona'), false);
  assert.ok(raices.some((r) => r.label === 'Administrador'));
  assert.ok(raices.some((r) => r.label === 'Otros'));
});

test('Filtro de rol selecciona ÚNICAMENTE ese grupo raíz (nunca mezcla roles)', () => {
  const { raices } = construirArbolUsuarios(DATA, { ...sinFiltros, rol: 'gestor' });
  assert.equal(raices.length, 1);
  assert.equal(raices[0].label, 'Gestor');
  assert.deepEqual(raices[0].children.map((c) => c.label).sort(), ['Gaby Gestora', 'Gus Gestor']);
});

test('Sin ningún filtro, los grupos raíz sin usuarios (ej. ningún "otros" en el catálogo) simplemente no se muestran', () => {
  const sinOtros: ArbolUsuarios = { ...DATA, usuarios: DATA.usuarios.filter((u) => u.id !== 'otro1') };
  const { raices } = construirArbolUsuarios(sinOtros, sinFiltros);
  assert.equal(raices.some((r) => r.label === 'Otros'), false);
});
