import { useEffect, useState } from 'react';
import { DashboardResponse, DashboardFilterParams } from '../types/cartera';
import { fetchDashboard } from '../services/carteraService';

/**
 * Si el usuario cambia de filtro varias veces seguidas (ej. Gestor A -> B -> C)
 * antes de que responda la primera petición, se cancela con AbortController en
 * vez de dejarla terminar e ignorar su resultado: evita que el backend siga
 * procesando (scope + filtrado + agregaciones) peticiones que ya no importan,
 * y garantiza que solo la ÚLTIMA selección pueda actualizar la UI (nunca una
 * respuesta más lenta y obsoleta "ganándole" a una más reciente).
 */
export const useDashboard = (filters?: DashboardFilterParams) => {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const dashboard = await fetchDashboard(filters, controller.signal);
        setData(dashboard);
        setError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Error desconocido');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    load();
    return () => controller.abort();
  }, [filters]);

  return { data, loading, error };
};
