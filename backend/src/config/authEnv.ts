import 'dotenv/config';

/**
 * Secreto JWT del proyecto Supabase (Project Settings → API → JWT Secret).
 * Se usa SOLO en el backend para verificar localmente los JWT de Supabase Auth.
 * NUNCA se expone al frontend ni se usa como variable VITE_.
 */
export const SUPABASE_JWT_SECRET = (process.env.SUPABASE_JWT_SECRET ?? '').trim();

export const assertJwtSecret = (): void => {
  if (!SUPABASE_JWT_SECRET) {
    throw new Error('Falta la variable de entorno SUPABASE_JWT_SECRET (JWT Secret de Supabase).');
  }
};
