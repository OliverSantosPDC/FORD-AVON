import { useEffect, useState } from 'react';
import { CarteraRecord } from '../types/cartera';
import { fetchCartera } from '../services/carteraService';

export const useCartera = () => {
  const [data, setData] = useState<CarteraRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const cartera = await fetchCartera();
        setData(cartera);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error desconocido');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  return { data, loading, error };
};
