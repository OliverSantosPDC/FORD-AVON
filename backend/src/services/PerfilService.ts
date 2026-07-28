import { getSupabaseClient } from '../config/supabaseClient';

/**
 * Alcance de datos del usuario. En FASE 2 queda VACÍO (preparado). El filtrado
 * real por país/zona/gestor se implementará en la fase siguiente.
 */
export interface AuthScope {
  paises: string[];
  zonas: string[];
  gestores: string[];
}

export interface AuthProfile {
  id: string;
  email: string;
  nombre: string;
  apellido: string | null;
}

export interface AuthRole {
  clave: string;
  nombre: string;
}

export interface AuthContext {
  userId: string;
  profile: AuthProfile;
  role: AuthRole | null;
  permissions: string[];
  scope: AuthScope;
}

/**
 * Carga el contexto autenticado (perfil + rol + permisos) desde Supabase usando
 * la SERVICE ROLE (bypassa RLS). Devuelve null si el perfil no existe o está
 * inactivo. El `scope` se entrega vacío en esta fase (se llenará en la siguiente).
 */
export const loadAuthContext = async (userId: string): Promise<AuthContext | null> => {
  const client = getSupabaseClient();

  const { data: profile, error } = await client
    .from('profiles')
    .select('id, nombre, apellido, email, activo, role_id, roles ( clave, nombre )')
    .eq('id', userId)
    .single();

  if (error || !profile) return null;
  const p = profile as unknown as {
    id: string;
    nombre: string;
    apellido: string | null;
    email: string;
    activo: boolean;
    role_id: string;
    roles: { clave: string; nombre: string } | { clave: string; nombre: string }[] | null;
  };

  if (!p.activo) return null;

  const roleRaw = Array.isArray(p.roles) ? p.roles[0] : p.roles;
  const role: AuthRole | null = roleRaw ? { clave: roleRaw.clave, nombre: roleRaw.nombre } : null;

  const { data: permRows } = await client
    .from('role_permissions')
    .select('permissions ( clave )')
    .eq('role_id', p.role_id);

  const permissions = ((permRows ?? []) as unknown as Array<{ permissions: { clave: string } | { clave: string }[] | null }>)
    .map((row) => {
      const perm = Array.isArray(row.permissions) ? row.permissions[0] : row.permissions;
      return perm?.clave;
    })
    .filter((clave): clave is string => Boolean(clave));

  return {
    userId,
    profile: { id: p.id, email: p.email, nombre: p.nombre, apellido: p.apellido },
    role,
    permissions,
    scope: { paises: [], zonas: [], gestores: [] }
  };
};
