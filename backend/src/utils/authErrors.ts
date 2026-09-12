/**
 * Manejo seguro de errores de Supabase Auth Admin (`auth.admin.*`).
 *
 * `@supabase/auth-js` construye el `.message` de sus errores como
 * `JSON.stringify(cuerpoDeLaRespuesta)` cuando esa respuesta no trae un campo
 * de texto reconocible (`msg`/`message`/`error_description`/`error`). Para
 * una respuesta de error sin cuerpo útil eso produce literalmente la cadena
 * "{}", que sin tratamiento llegaba tal cual al usuario ("No se pudo
 * eliminar el usuario de Auth: {}"). Estas utilidades extraen explícitamente
 * `message`/`code`/`status`/`statusCode` y arman un mensaje claro y seguro
 * (nunca incluyen stack traces ni credenciales).
 */

/** Construye un mensaje claro a partir de un error de Auth Admin. */
export const describirErrorAuth = (error: unknown, fallback: string): string => {
  if (!error || typeof error !== 'object') return fallback;
  const e = error as Record<string, unknown>;
  const partes: string[] = [];
  const msg = typeof e.message === 'string' ? e.message.trim() : '';
  if (msg && msg !== '{}' && msg !== '[object Object]') partes.push(msg);
  const code = typeof e.code === 'string' ? e.code : undefined;
  const status = typeof e.status === 'number' ? e.status : (typeof e.statusCode === 'number' ? e.statusCode : undefined);
  if (code) partes.push(`código: ${code}`);
  if (status !== undefined) partes.push(`estado HTTP: ${status}`);
  if (partes.length === 0) return fallback;
  return `${fallback} (${partes.join(', ')})`;
};

/** ¿El error de Auth Admin indica que el usuario ya no existe (tolerable, no bloquea la operación)? */
export const esUsuarioAuthInexistente = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const e = error as Record<string, unknown>;
  const code = typeof e.code === 'string' ? e.code : '';
  const status = typeof e.status === 'number' ? e.status : (typeof e.statusCode === 'number' ? e.statusCode : undefined);
  const msg = typeof e.message === 'string' ? e.message : '';
  return code === 'user_not_found' || status === 404 || /not.*found/i.test(msg);
};
