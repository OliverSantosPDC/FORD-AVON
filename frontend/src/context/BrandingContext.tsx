import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiFetch } from '../services/apiClient';
import { obtenerUrlAsset } from '../services/configuracionService';
import { useAuth } from './AuthContext';

/**
 * Fuente única de verdad para los assets visuales configurables (Configuración
 * General > Logos): Logo principal (Sidebar/Header), Logo Login y Favicon.
 * `config_general` guarda solo el PATH de Storage — este provider es lo único
 * que lo resuelve a una URL firmada usable, y lo mantiene actualizado.
 *
 * Dos fuentes distintas porque el Login se renderiza SIN sesión:
 *  - logoLoginUrl/faviconUrl: GET /api/branding (público, sin requireAuth) —
 *    disponibles incluso antes de iniciar sesión.
 *  - logoPrincipalUrl: GET /api/configuracion/assets/logo_principal/url
 *    (requiere sesión, pero NINGÚN permiso de Configuración) — solo tiene
 *    sentido una vez autenticado, que es cuando existe Sidebar/Header.
 *
 * Las URLs firmadas expiran (1 h, ver ConfigService.urlAsset en el backend):
 * nunca se persisten, se vuelven a pedir periódicamente mientras la app sigue
 * abierta para que una sesión larga no termine con una imagen rota.
 */
interface BrandingState {
  logoPrincipalUrl: string | null;
  logoLoginUrl: string | null;
  faviconUrl: string | null;
  loading: boolean;
  /** Vuelve a resolver las 3 URLs ya mismo (llamar tras subir un logo nuevo en Configuración). */
  refresh: () => void;
}

export const BrandingContext = createContext<BrandingState>({
  logoPrincipalUrl: null,
  logoLoginUrl: null,
  faviconUrl: null,
  loading: true,
  refresh: () => undefined
});

export const useBranding = () => useContext(BrandingContext);

// Bien por debajo de la expiración de 1 h de la URL firmada (backend:
// ConfigService.urlAsset), para refrescarla antes de que deje de servir.
const REFRESH_MS = 40 * 60_000;

export const BrandingProvider = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated } = useAuth();
  const [logoLoginUrl, setLogoLoginUrl] = useState<string | null>(null);
  const [faviconUrl, setFaviconUrl] = useState<string | null>(null);
  const [logoPrincipalUrl, setLogoPrincipalUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  // Público (Login + favicon del navegador): disponible con o sin sesión.
  useEffect(() => {
    let active = true;
    apiFetch('/api/branding', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { logoLogin: null, favicon: null }))
      .then((b: { logoLogin: string | null; favicon: string | null }) => {
        if (!active) return;
        setLogoLoginUrl(b.logoLogin ?? null);
        setFaviconUrl(b.favicon ?? null);
      })
      .catch(() => { if (active) { setLogoLoginUrl(null); setFaviconUrl(null); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [version]);

  // Autenticado (Sidebar/Header): solo tiene sentido pedirlo con sesión iniciada.
  useEffect(() => {
    let active = true;
    if (!isAuthenticated) { setLogoPrincipalUrl(null); return undefined; }
    obtenerUrlAsset('logo_principal').then((url) => { if (active) setLogoPrincipalUrl(url); });
    return () => { active = false; };
  }, [isAuthenticated, version]);

  // Refresco periódico: las URLs firmadas expiran, nunca se guardan como si fueran el valor real.
  const versionRef = useRef(version);
  versionRef.current = version;
  useEffect(() => {
    const id = window.setInterval(() => setVersion(versionRef.current + 1), REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  // Favicon real del navegador: efecto centralizado aquí — ningún otro
  // componente necesita tocar el <head>. Si no hay favicon configurado, se
  // conserva el comportamiento actual (sin <link rel="icon">, tal como estaba).
  useEffect(() => {
    if (!faviconUrl) return;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = faviconUrl;
  }, [faviconUrl]);

  const value = useMemo<BrandingState>(
    () => ({ logoPrincipalUrl, logoLoginUrl, faviconUrl, loading, refresh }),
    [logoPrincipalUrl, logoLoginUrl, faviconUrl, loading, refresh]
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
};
