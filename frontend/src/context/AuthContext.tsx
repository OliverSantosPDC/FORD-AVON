import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { authService } from '../services/authService';
import { apiFetch } from '../services/apiClient';

/**
 * Estado de contraseña temporal administrativa (política Avon2026, 15 días).
 * Calculado por el backend (PerfilService.calcularPasswordPolicy) en CADA
 * respuesta de /api/auth/me — nunca se recalculan fechas en el cliente, para
 * que "expired"/"diasRestantes" respeten siempre la misma zona horaria (UTC,
 * la del servidor) sin depender del reloj/huso del navegador del usuario.
 */
export interface PasswordPolicy {
  mustChangePassword: boolean;
  isTemporaryPassword: boolean;
  temporaryPasswordCreatedAt: string | null;
  temporaryPasswordExpiresAt: string | null;
  expired: boolean;
  diasRestantes: number | null;
}

const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  mustChangePassword: false,
  isTemporaryPassword: false,
  temporaryPasswordCreatedAt: null,
  temporaryPasswordExpiresAt: null,
  expired: false,
  diasRestantes: null
};

export interface MeResponse {
  user: { id: string; email: string; nombre: string; apellido: string | null };
  role: { clave: string; nombre: string } | null;
  permissions: string[];
  scope: { paises: string[]; zonas: string[]; gestores: string[] };
  passwordPolicy: PasswordPolicy;
}

interface AuthContextValue {
  user: MeResponse['user'] | null;
  profile: MeResponse['user'] | null;
  role: MeResponse['role'];
  permissions: string[];
  scope: MeResponse['scope'];
  passwordPolicy: PasswordPolicy;
  loading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<{ error: string | null; passwordPolicy?: PasswordPolicy; permissions?: string[] }>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasRole: (roleClave: string) => boolean;
  /** Vuelve a pedir /api/auth/me (llamar tras cambiar la propia contraseña, para que
   *  desaparezca la advertencia/estado temporal sin necesidad de recargar la página). */
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const loadingMe = useRef(false);
  // Lee el último `me` sin volver inestable la identidad de loadMe/useEffect
  // (evita resuscribir onAuthStateChange en cada actualización de perfil).
  const meRef = useRef<MeResponse | null>(null);
  useEffect(() => { meRef.current = me; }, [me]);

  const loadMe = useCallback(async (): Promise<MeResponse | null> => {
    if (loadingMe.current) return meRef.current;
    loadingMe.current = true;
    try {
      const token = await authService.getAccessToken();
      if (!token) {
        setMe(null);
        return null;
      }
      const res = await apiFetch('/api/auth/me');
      if (!res.ok) {
        setMe(null);
        return null;
      }
      const data = (await res.json()) as MeResponse;
      setMe(data);
      return data;
    } catch {
      setMe(null);
      return null;
    } finally {
      loadingMe.current = false;
    }
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      await loadMe();
      if (active) setLoading(false);
    })();

    // Reacciona a cambios de sesión (login/logout/refresh) de Supabase.
    const subscription = authService.onAuthStateChange(async (session) => {
      if (!session) {
        setMe(null);
        return;
      }
      await loadMe();
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadMe]);

  const login = useCallback(async (email: string, password: string) => {
    const { error } = await authService.login(email, password);
    if (error) return { error: error.message };
    const data = await loadMe();
    // Auditoría best-effort (no bloquea el login).
    apiFetch('/api/auth/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'login' })
    }).catch(() => undefined);
    return { error: null, passwordPolicy: data?.passwordPolicy, permissions: data?.permissions };
  }, [loadMe]);

  const logout = useCallback(async () => {
    // Registrar logout ANTES de cerrar sesión (token aún válido).
    await apiFetch('/api/auth/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'logout' })
    }).catch(() => undefined);
    await authService.logout();
    setMe(null);
  }, []);

  const refreshProfile = useCallback(async () => { await loadMe(); }, [loadMe]);

  const value = useMemo<AuthContextValue>(() => ({
    user: me?.user ?? null,
    profile: me?.user ?? null,
    role: me?.role ?? null,
    permissions: me?.permissions ?? [],
    scope: me?.scope ?? { paises: [], zonas: [], gestores: [] },
    passwordPolicy: me?.passwordPolicy ?? DEFAULT_PASSWORD_POLICY,
    loading,
    isAuthenticated: Boolean(me),
    login,
    logout,
    hasPermission: (permission: string) => (me?.permissions ?? []).includes(permission),
    hasRole: (roleClave: string) => me?.role?.clave === roleClave,
    refreshProfile
  }), [me, loading, login, logout, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  return ctx;
};
