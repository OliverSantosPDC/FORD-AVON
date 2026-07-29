import { randomInt } from 'crypto';

/**
 * Genera una contraseña temporal segura (>=12 chars) con mayúscula, minúscula,
 * dígito y carácter especial. No se persiste en texto plano en ningún lugar:
 * se envía directamente a Supabase `auth.admin.createUser` y se devuelve una
 * única vez para mostrarla al administrador.
 */
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGIT = '23456789';
const SPECIAL = '!@#$%&*?-_';

const pick = (chars: string): string => chars[randomInt(chars.length)];

export const generarPasswordTemporal = (length = 14): string => {
  const all = UPPER + LOWER + DIGIT + SPECIAL;
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SPECIAL)];
  for (let i = chars.length; i < length; i += 1) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
};
