import { useEffect, useState } from 'react';
import { getTasasConversionActivas } from '../services/configuracionService';

const POLL_MS = 15000;

export interface TasasConversionState {
  /** Tasa oficial (config_tasas_conversion, Supabase) por código de moneda. */
  tasas: Record<string, number>;
  loading: boolean;
  /** true si la consulta falló o no devolvió ninguna moneda: nunca se debe asumir 1 en silencio. */
  error: boolean;
}

/**
 * Fuente única de tasas de conversión oficiales para todo el frontend (Dashboard,
 * ConversionRates, cualquier otro consumidor). Lee siempre de
 * GET /api/catalogos/tasas-conversion (que a su vez lee únicamente de la tabla
 * Supabase `config_tasas_conversion`; no existe otra fuente).
 *
 * Se vuelve a consultar: al montar, al recuperar el foco de la pestaña, y en un
 * intervalo corto mientras el componente esté activo, para que un cambio guardado
 * en Configuración se refleje sin requerir recarga manual del navegador.
 */
export const useTasasConversion = (): TasasConversionState => {
  const [tasas, setTasas] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    const cargar = () => {
      getTasasConversionActivas()
        .then((data) => {
          if (!active) return;
          if (data.length === 0) {
            setError(true);
            setLoading(false);
            return;
          }
          const map: Record<string, number> = {};
          data.forEach((t) => { map[t.codigo] = Number(t.tasa); });
          setTasas(map);
          setError(false);
          setLoading(false);
        })
        .catch(() => {
          if (!active) return;
          setError(true);
          setLoading(false);
        });
    };
    cargar();
    window.addEventListener('focus', cargar);
    const interval = window.setInterval(cargar, POLL_MS);
    return () => {
      active = false;
      window.removeEventListener('focus', cargar);
      window.clearInterval(interval);
    };
  }, []);

  return { tasas, loading, error };
};
