import { useEffect, useState } from 'react';
import { InteligenciaResponse } from '../types/cartera';
import { fetchInteligencia } from '../services/carteraService';

const useInteligencia = () => {
  const [data, setData] = useState<InteligenciaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetchInteligencia();
        setData(response);
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

export default useInteligencia;
