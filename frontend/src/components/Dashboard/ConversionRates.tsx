import { useEffect, useMemo, useState } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import type { CarteraRecord } from '../../types/cartera';
import { fetchCartera } from '../../services/carteraService';
import { getCarteraField, carteraFieldKeys, resolveCountry } from '../../utils/carteraAggregations';
import { MONEDA_OPTIONS } from '../../utils/monedaOptions';

interface PaisTotals { usd: number; local: number; }

/**
 * Tasas de conversión implícitas en la cartera actual: no son un valor configurado
 * aparte (no existe tal configuración en el proyecto), sino la misma relación
 * Usd/Local ya presente en cada cuenta (los mismos campos que usan KPIs, gráficos
 * y tablas para convertir). Se calculan sobre el universo completo (sin filtros de
 * país/gestor/etc.) para reflejar la tasa vigente del sistema.
 */
const ConversionRates = () => {
  const [cuentas, setCuentas] = useState<CarteraRecord[]>([]);

  useEffect(() => {
    let active = true;
    fetchCartera().then((data) => { if (active) setCuentas(data); }).catch(() => { if (active) setCuentas([]); });
    return () => { active = false; };
  }, []);

  const rates = useMemo(() => {
    const totals = new Map<string, PaisTotals>();
    cuentas.forEach((row) => {
      const country = resolveCountry(getCarteraField(row, carteraFieldKeys.pais));
      if (!country) return;
      const usd = Number(getCarteraField(row, carteraFieldKeys.saldoActualUsd) ?? 0);
      const local = Number(getCarteraField(row, carteraFieldKeys.saldoActualLocal) ?? 0);
      const existing = totals.get(country.name) ?? { usd: 0, local: 0 };
      existing.usd += Number.isFinite(usd) ? usd : 0;
      existing.local += Number.isFinite(local) ? local : 0;
      totals.set(country.name, existing);
    });

    return MONEDA_OPTIONS.map((option) => {
      if (option.code === 'USD') return { ...option, rate: 1 };
      const t = option.pais ? totals.get(option.pais) : undefined;
      const rate = t && t.usd > 0 ? t.local / t.usd : null;
      return { ...option, rate };
    });
  }, [cuentas]);

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
