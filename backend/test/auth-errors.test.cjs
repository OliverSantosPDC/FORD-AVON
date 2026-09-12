'use strict';

/**
 * Pruebas unitarias del manejo seguro de errores de Supabase Auth Admin
 * (Sección 1 de la tarea: corrige "No se pudo eliminar el usuario de Auth: {}").
 * Ejecuta el código YA COMPILADO en dist/utils/authErrors.js directamente
 * (sin necesidad de red ni de un cliente Supabase).
 *
 * Ejecutar (tras `npm run build`): node --test test/auth-errors.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { describirErrorAuth, esUsuarioAuthInexistente } = require(path.join(__dirname, '..', 'dist', 'utils', 'authErrors.js'));

test('describirErrorAuth nunca produce el mensaje crudo "{}"', () => {
  // Caso real reportado: AuthError cuyo .message terminó siendo la cadena "{}"
  // (auth-js hace JSON.stringify del cuerpo de respuesta cuando no trae un
  // campo de texto reconocible).
  const err = { name: 'AuthApiError', message: '{}', status: 500, code: undefined };
  const msg = describirErrorAuth(err, 'No se pudo eliminar el usuario de Auth.');
  assert.equal(msg.includes('{}'), false, `no debe contener "{}" crudo: ${msg}`);
  assert.match(msg, /No se pudo eliminar el usuario de Auth\./);
  assert.match(msg, /estado HTTP: 500/);
});

test('describirErrorAuth usa el mensaje real cuando existe', () => {
  const err = { message: 'User not allowed', status: 403, code: 'not_admin' };
  const msg = describirErrorAuth(err, 'Fallback.');
  assert.match(msg, /User not allowed/);
  assert.match(msg, /código: not_admin/);
  assert.match(msg, /estado HTTP: 403/);
});

test('describirErrorAuth cae al fallback ante un error vacío o no-objeto', () => {
  assert.equal(describirErrorAuth(null, 'Fallback.'), 'Fallback.');
  assert.equal(describirErrorAuth(undefined, 'Fallback.'), 'Fallback.');
  assert.equal(describirErrorAuth({}, 'Fallback.'), 'Fallback.');
  assert.equal(describirErrorAuth('texto plano', 'Fallback.'), 'Fallback.');
});

test('describirErrorAuth nunca incluye stack traces', () => {
  const err = new Error('algo falló');
  err.status = 500;
  const msg = describirErrorAuth(err, 'Fallback.');
  assert.equal(msg.includes('at '), false); // heurística simple: sin líneas de stack trace
  assert.equal(typeof msg, 'string');
});

test('describirErrorAuth — caso real de producción: GoTrue "error finding user" (bug de tokens NULL) da un mensaje claro sin "{}"', () => {
  // Reproduce EXACTAMENTE el error real observado en los logs de Supabase Auth
  // para este proyecto: auth.users con confirmation_token/recovery_token/
  // email_change_token_new NULL rompía el escaneo interno de GoTrue
  // ("sql: Scan error on column index 3 ... converting NULL to string"),
  // devolviendo un cuerpo de error vacío/sin campos reconocibles. La causa
  // real era un problema de DATOS (corregido con una migración que normaliza
  // esas columnas a '' en Supabase), no de este código — pero el manejo de
  // errores debe seguir mostrando algo claro y nunca "{}" crudo.
  const err = { name: 'AuthApiError', message: '{}', status: 500, code: undefined };
  const msg = describirErrorAuth(err, 'No se pudo eliminar el usuario de Auth.');
  assert.equal(msg, 'No se pudo eliminar el usuario de Auth. (estado HTTP: 500)');
  assert.equal(esUsuarioAuthInexistente(err), false, 'un 500 genérico NO debe tratarse como "usuario ya inexistente"');
});

test('esUsuarioAuthInexistente detecta code/status/mensaje de "no encontrado"', () => {
  assert.equal(esUsuarioAuthInexistente({ code: 'user_not_found' }), true);
  assert.equal(esUsuarioAuthInexistente({ status: 404 }), true);
  assert.equal(esUsuarioAuthInexistente({ message: 'User not found' }), true);
  assert.equal(esUsuarioAuthInexistente({ message: '{}', status: 500 }), false);
  assert.equal(esUsuarioAuthInexistente(null), false);
});
