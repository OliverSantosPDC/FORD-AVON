import { useMemo, useState } from 'react';
import { Box, Chip, Collapse, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import type { ZonaSectorSummary } from '../../types/cartera';

interface Props {
  data: ZonaSectorSummary[];
  moneda: 'USD' | 'LOCAL';
  monedaCode: string;
}

const fmt = (value: number, moneda: 'USD' | 'LOCAL', code: string) =>
  moneda === 'USD'
    ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${code}`;

/** Saldos agrupados por Zona y, expandible, por Sector. Reactivo a filtros (datos ya vienen filtrados del backend). */
const DashboardZonaSector = ({ data, moneda, monedaCode }: Props) => {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const val = (z: { saldoActualUsd: number; saldoActualLocal: number }) => (moneda === 'USD' ? z.saldoActualUsd : z.saldoActualLocal);
  const valS = (s: { saldoActualUsd: number; saldoActualLocal: number }) => (moneda === 'USD' ? s.saldoActualUsd : s.saldoActualLocal);
  const max = useMemo(() => Math.max(1, ...data.map((z) => val(z))), [data, moneda]);

  const toggle = (k: string) => { const n = new Set(open); n.has(k) ? n.delete(k) : n.add(k); setOpen(n); };

  return (
    <Paper sx={{ p: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
        <Typography sx={{ fontWeight: 700 }}>Saldos por Zona y Sector</Typography>
        <Chip size="small" variant="outlined" label={moneda === 'USD' ? 'USD' : monedaCode} />
      </Box>
      {data.length === 0 ? (
        <Typography sx={{ fontSize: 13, color: 'text.secondary', py: 3, textAlign: 'center' }}>
          No hay saldos para los filtros seleccionados.
        </Typography>
      ) : (
        <Stack spacing={0.75} sx={{ maxHeight: 360, overflowY: 'auto' }}>
          {data.map((z) => {
            const sMax = Math.max(1, ...z.sectores.map((s) => valS(s)));
            const isOpen = open.has(z.zona);
            return (
              <Box key={z.zona}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }} onClick={() => toggle(z.zona)}>
                  <IconButton size="small">{isOpen ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}</IconButton>
                  <Box sx={{ width: { xs: 90, sm: 140 }, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{z.zona}</Box>
                  <Tooltip title={`${z.zona} · ${z.cuentas.toLocaleString()} cuentas · ${fmt(val(z), moneda, monedaCode)}`} arrow>
                    <Box sx={{ flex: 1, bgcolor: 'action.hover', borderRadius: 1, height: 16, minWidth: 60 }}>
                      <Box sx={{ width: `${Math.max(2, (val(z) / max) * 100)}%`, bgcolor: '#1E3A8A', height: '100%', borderRadius: 1 }} />
                    </Box>
                  </Tooltip>
                  <Box sx={{ width: { xs: 96, sm: 150 }, textAlign: 'right', fontSize: 11, whiteSpace: 'nowrap' }}>{fmt(val(z), moneda, monedaCode)} · {z.cuentas}</Box>
                </Box>
                <Collapse in={isOpen} unmountOnExit>
                  <Stack spacing={0.5} sx={{ pl: { xs: 5, sm: 6 }, py: 0.5 }}>
                    {z.sectores.map((s) => (
                      <Box key={s.sector} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: { xs: 90, sm: 140 }, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.sector}</Box>
                        <Tooltip title={`${s.sector} · ${s.cuentas.toLocaleString()} cuentas · ${fmt(valS(s), moneda, monedaCode)}`} arrow>
                          <Box sx={{ flex: 1, bgcolor: 'action.hover', borderRadius: 1, height: 12, minWidth: 50 }}>
                            <Box sx={{ width: `${Math.max(2, (valS(s) / sMax) * 100)}%`, bgcolor: '#0EA5E9', height: '100%', borderRadius: 1 }} />
                          </Box>
                        </Tooltip>
                        <Box sx={{ width: { xs: 96, sm: 150 }, textAlign: 'right', fontSize: 11, whiteSpace: 'nowrap' }}>{fmt(valS(s), moneda, monedaCode)} · {s.cuentas}</Box>
                      </Box>
                    ))}
                  </Stack>
                </Collapse>
              </Box>
            );
          })}
        </Stack>
      )}
    </Paper>
  );
};

export default DashboardZonaSector;
