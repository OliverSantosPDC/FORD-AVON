import { useEffect, useState } from 'react';
import { DashboardResponse, DashboardFilterParams } from '../types/cartera';
import { fetchDashboard } from '../services/carteraService';

export const useDashboard = (filters?: DashboardFilterParams) => {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const dashboard = await fetchDashboard(filters);
        setData(dashboard);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error desconocido');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [filters]);

  return { data, loading, error };
};
