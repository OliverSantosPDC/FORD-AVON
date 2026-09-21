import { getSupabaseClient } from '../config/supabaseClient';

/**
 * Alcance de datos del usuario. En FASE 2 queda VACÍO (preparado). El filtrado
 * real por país/zona/gestor se implementará en la fase siguiente.
 */
export interface AuthScope {
  paises: string[];
  zonas: string[];
  gestores: string[];
  /** Concesión adicional EXACTA (país+zona), tipo OR: una fila queda autorizada
   *  si coincide con CUALQUIER dimensión base (gestor/zona/país) O con uno de
   *  estos pares — es una fuente de acceso independiente, no una restricción.
   *  Uso: Gestor (gestor_pais_zona: fuente de alcance que NUNCA depende de que
   *  su nombre exista en cartera.gestor), Gerente de zona (gerente_zona_zona:
   *  fuente única de su alcance) y, transitivamente, Supervisor/Liderazgo
   *  heredando el alcance de sus Gestores/Gerentes de zona. */
  paisZonaGrant?: Array<{ pais: string; zona: string }>;
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

/**
 * Estado de contraseña temporal administrativa (política Avon2026, 15 días).
 * Calculado en cada request a partir de columnas persistidas en `profiles`
 * (nunca cacheado): `expired`/`diasRestantes` dependen de "ahora", así que se
 * recalculan siempre contra el `temporary_password_expires_at` guardado —
 * nunca se persiste un booleano "vencido" que pudiera quedar desactualizado.
 */
export interface PasswordPolicy {
  mustChangePassword: boolean;
  isTemporaryPassword: boolean;
  temporaryPasswordCreatedAt: string | null;
  temporaryPasswordExpiresAt: string | null;
  /** true solo si mustChangePassword=true Y ya pasó temporary_password_expires_at. */
  expired: boolean;
  /** Días restantes (techo, nunca negativo) hasta el vencimiento; null si no aplica. */
  diasRestantes: number | null;
}

export interface AuthContext {
  userId: string;
  profile: AuthProfile;
  role: AuthRole | null;
  permissions: string[];
  scope: AuthScope;
  passwordPolicy: PasswordPolicy;
}

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Calcula el estado de contraseña temporal a partir de las columnas crudas de `profiles`. */
const calcularPasswordPolicy = (row: {
  must_change_password?: boolean | null;
  is_temporary_password?: boolean | null;
  temporary_password_created_at?: string | null;
  temporary_password_expires_at?: string | null;
}): PasswordPolicy => {
  const mustChangePassword = Boolean(row.must_change_password);
  const isTemporaryPassword = Boolean(row.is_temporary_password);
  const createdAt = row.temporary_password_created_at ?? null;
  const expiresAt = row.temporary_password_expires_at ?? null;
  const expiresAtMs = expiresAt ? new Date(expiresAt).getTime() : null;
  const nowMs = Date.now();

  const expired = mustChangePassword && expiresAtMs !== null && nowMs > expiresAtMs;
  const diasRestantes = expiresAtMs !== null ? Math.max(0, Math.ceil((expiresAtMs - nowMs) / MS_POR_DIA)) : null;

  return {
    mustChangePassword,
    isTemporaryPassword,
    temporaryPasswordCreatedAt: createdAt,
    temporaryPasswordExpiresAt: expiresAt,
    expired,
    diasRestantes
  };
};

/**
 * Carga el contexto autenticado (perfil + rol + permisos) desde Supabase usando
 * la SERVICE ROLE (bypassa RLS). Devuelve null si el perfil no existe o está
 * inactivo. El `scope` se entrega vacío en esta fase (se llenará en la siguiente).
 */
export const loadAuthContext = async (userId: string): Promise<AuthContext | null> => {
  const client = getSupabaseClient();

  const { data: profile, error } = await client
    .from('profiles')
    .select('id, nombre, apellido, email, activo, role_id, roles ( clave, nombre ), is_temporary_password, must_change_password, temporary_password_created_at, temporary_password_expires_at')
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
    is_temporary_password: boolean | null;
    must_change_password: boolean | null;
    temporary_password_created_at: string | null;
    temporary_password_expires_at: string | null;
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
    scope: { paises: [], zonas: [], gestores: [] },
    passwordPolicy: calcularPasswordPolicy(p)
  };
};
