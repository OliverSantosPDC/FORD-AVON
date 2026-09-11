import { useMemo } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { useTasasConversion } from '../../hooks/useTasasConversion';
import { MONEDA_OPTIONS } from '../../utils/monedaOptions';

/**
 * Tasas de conversión oficiales, administradas desde Configuración > Tasas de Conversión
 * (fuente única usada por el Dashboard, en vez de un valor calculado o hardcodeado).
 * Usa el mismo hook (`useTasasConversion`) que el resto del Dashboard, para no duplicar
 * la lógica de lectura de tasas.
 */
const ConversionRates = () => {
  const { tasas } = useTasasConversion();

  const rates = useMemo(
    () => MONEDA_OPTIONS.map((option) => ({ ...option, rate: tasas[option.code] ?? null })),
    [tasas]
  );

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
              {r.rate === null ? '—' : `1 USD = ${r.rate.toFixed(4)} ${r.code}`}
            </Typography>
          </Box>
        ))}
      </Box>
    </Paper>
  );
};

export default ConversionRates;
