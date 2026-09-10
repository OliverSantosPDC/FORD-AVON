import { useEffect, useMemo, useState } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { getTasasConversionActivas } from '../../services/configuracionService';
import { MONEDA_OPTIONS } from '../../utils/monedaOptions';

/**
 * Tasas de conversión oficiales, administradas desde Configuración > Tasas de Conversión
 * (fuente única usada por el Dashboard, en vez de un valor calculado o hardcodeado).
 */
const ConversionRates = () => {
  const [tasas, setTasas] = useState<Array<{ codigo: string; tasa: number }>>([]);

  useEffect(() => {
    let active = true;
    getTasasConversionActivas().then((data) => { if (active) setTasas(data); }).catch(() => { if (active) setTasas([]); });
    return () => { active = false; };
  }, []);

  const rates = useMemo(() => {
    const porCodigo = new Map(tasas.map((t) => [t.codigo, t.tasa]));
    return MONEDA_OPTIONS.map((option) => ({ ...option, rate: porCodigo.get(option.code) ?? null }));
  }, [tasas]);

  return (
    <Paper sx={{ px: 2, py: 1, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
      <Typography sx={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.secondary', mb: 0.5 }}>
        Tasas de Conversión Actuales
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.5 }}>
        {rates.map((r) => (
          <Box key={r.code} sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
            <Typography sx={{ fontSize: 11, fontWeight: 700 }}>{r.label}:</Typography>
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
              {r.code === 'USD' ? '1.00' : r.rate === null ? '—' : `1 USD = ${r.rate.toFixed(4)} ${r.code}`}
            </Typography>
          </Box>
        ))}
      </Box>
    </Paper>
  );
};

export default ConversionRates;
