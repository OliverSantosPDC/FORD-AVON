import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { authService } from '../services/authService';
import { apiFetch } from '../services/apiClient';

export interface MeResponse {
  user: { id: string; email: string; nombre: string; apellido: string | null };
  role: { clave: string; nombre: string } | null;
  permissions: string[];
  scope: { paises: string[]; zonas: string[]; gestores: string[] };
}

interface AuthContextValue {
  user: MeResponse['user'] | null;
  profile: MeResponse['user'] | null;
  role: MeResponse['role'];
  permissions: string[];
  scope: MeResponse['scope'];
  loading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<{ error: string | null }>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasRole: (roleClave: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const loadingMe = useRef(false);

  const loadMe = useCallback(async () => {
    if (loadingMe.current) return;
    loadingMe.current = true;
    try {
      const token = await authService.getAccessToken();
      if (!token) {
        setMe(null);
        return;
      }
      const res = await apiFetch('/api/auth/me');
      if (!res.ok) {
        setMe(null);
        return;
      }
      setMe((await res.json()) as MeResponse);
    } catch {
      setMe(null);
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
    await loadMe();
    // Auditoría best-effort (no bloquea el login).
    apiFetch('/api/auth/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'login' })
    }).catch(() => undefined);
    return { error: null };
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

  const value = useMemo<AuthContextValue>(() => ({
    user: me?.user ?? null,
    profile: me?.user ?? null,
    role: me?.role ?? null,
    permissions: me?.permissions ?? [],
    scope: me?.scope ?? { paises: [], zonas: [], gestores: [] },
    loading,
    isAuthenticated: Boolean(me),
    login,
    logout,
    hasPermission: (permission: string) => (me?.permissions ?? []).includes(permission),
    hasRole: (roleClave: string) => me?.role?.clave === roleClave
  }), [me, loading, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  return ctx;
};
