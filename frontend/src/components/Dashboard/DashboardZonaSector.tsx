import { MouseEvent as ReactMouseEvent, useMemo, useState } from 'react';
import { Box, Collapse, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Paper, Stack, Tooltip, Typography } from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import type { ZonaSectorPorPaisItem } from '../../types/cartera';
import { simboloMoneda } from '../../utils/monedaOptions';

interface Props {
  /** Ya agregado País → Zona → Sector en el backend (dashboard.zonaSectorPorPais)
   *  — Fase 2 de la optimización de tiempos de carga: antes este componente
   *  descargaba la cartera completa vía /api/cartera y la agregaba en el navegador. */
  zonaSectorPorPais: ZonaSectorPorPaisItem[];
  moneda: 'USD' | 'LOCAL';
  monedaCode: string;
  tasa: number;
}

interface SectorAgg { sector: string; usd: number; local: number; cuentas: number; }
interface ZonaAgg { paisKey: string; paisNombre: string; zona: string; usd: number; local: number; cuentas: number; sectores: SectorAgg[]; }
interface PaisGroup { paisKey: string; paisNombre: string; zonas: ZonaAgg[]; }

const fmt = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

type ZonaSortKey = 'valor' | 'nombre';

/**
 * Saldos agrupados por PAÍS → ZONA → SECTOR, expandible por sector.
 * `zonaSectorPorPais` ya llega agrupado y ordenado desde el backend
 * (dashboard.zonaSectorPorPais, calculado UNA vez junto con el resto del
 * dashboard); este componente solo añade el importe en moneda LOCAL (usd *
 * tasa vigente) — un cambio de moneda nunca vuelve a pedir datos.
 */
const DashboardZonaSector = ({ zonaSectorPorPais, moneda, monedaCode, tasa }: Props) => {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<ZonaSortKey>('valor');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [sortAnchor, setSortAnchor] = useState<null | HTMLElement>(null);

  const val = (z: { usd: number; local: number }) => (moneda === 'USD' ? z.usd : z.local);

  const paises = useMemo<PaisGroup[]>(() => zonaSectorPorPais.map((grupo) => ({
    paisKey: grupo.paisKey,
    paisNombre: grupo.paisNombre,
    zonas: grupo.zonas.map((z) => ({
      paisKey: grupo.paisKey,
      paisNombre: grupo.paisNombre,
      zona: z.zona,
      usd: z.saldoActualUsd,
      local: z.saldoActualUsd * tasa,
      cuentas: z.cuentas,
      sectores: z.sectores.map((s) => ({ sector: s.sector, usd: s.saldoActualUsd, local: s.saldoActualUsd * tasa, cuentas: s.cuentas }))
    }))
  })), [zonaSectorPorPais, tasa]);

  const paisesOrdenados = useMemo(() => {
    return paises.map((grupo) => ({
      ...grupo,
      zonas: [...grupo.zonas].sort((a, b) => {
        const result = sortKey === 'nombre' ? a.zona.localeCompare(b.zona, 'es', { sensitivity: 'base' }) : val(a) - val(b);
        return sortDir === 'asc' ? result : -result;
      })
    }));
  }, [paises, sortKey, sortDir, moneda]);

  const maxZona = useMemo(() => Math.max(1, ...paises.flatMap((grupo) => grupo.zonas.map((z) => val(z)))), [paises, moneda]);

  const sortOptions: Array<{ id: string; label: string; ascending: boolean; active: boolean; onClick: () => void }> = [
    { id: 'menor-mayor', label: 'Menor a mayor', ascending: true, active: sortKey === 'valor' && sortDir === 'asc', onClick: () => { setSortKey('valor'); setSortDir('asc'); } },
    { id: 'mayor-menor', label: 'Mayor a menor', ascending: false, active: sortKey === 'valor' && sortDir === 'desc', onClick: () => { setSortKey('valor'); setSortDir('desc'); } },
    { id: 'az', label: 'A-Z', ascending: true, active: sortKey === 'nombre' && sortDir === 'asc', onClick: () => { setSortKey('nombre'); setSortDir('asc'); } },
    { id: 'za', label: 'Z-A', ascending: false, active: sortKey === 'nombre' && sortDir === 'desc', onClick: () => { setSortKey('nombre'); setSortDir('desc'); } }
  ];

  const toggle = (k: string) => { const n = new Set(open); n.has(k) ? n.delete(k) : n.add(k); setOpen(n); };

  const simbolo = simboloMoneda(monedaCode);

  return (
    <Paper sx={{ p: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.25 }}>SALDOS ACTUAL POR ZONA Y SECTOR</Typography>
          <Typography sx={{ fontSize: 10.5, color: 'text.secondary', lineHeight: 1.2 }}>Moneda: {simbolo}</Typography>
        </Box>
        <Tooltip title="Ordenar">
          <IconButton
            size="small"
            onClick={(event: ReactMouseEvent<HTMLElement>) => setSortAnchor(event.currentTarget)}
            sx={{ width: 26, height: 26, border: '1px solid', borderColor: 'divider' }}
          >
            <SwapVertIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={sortAnchor} open={Boolean(sortAnchor)} onClose={() => setSortAnchor(null)} PaperProps={{ sx: { minWidth: 180, borderRadius: 2.5 } }}>
          {sortOptions.map((option) => (
            <MenuItem
              key={option.id}
              dense
              selected={option.active}
              onClick={() => {
                option.onClick();
                setSortAnchor(null);
              }}
            >
              <ListItemIcon>
                {option.ascending ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />}
              </ListItemIcon>
              <ListItemText primaryTypographyProps={{ fontSize: 13 }}>{option.label}</ListItemText>
            </MenuItem>
          ))}
        </Menu>
      </Box>
      {paisesOrdenados.length === 0 ? (
        <Typography sx={{ fontSize: 13, color: 'text.secondary', py: 3, textAlign: 'center' }}>
          No hay saldos para los filtros seleccionados.
        </Typography>
      ) : (
        <Stack spacing={1.25} sx={{ maxHeight: 240, overflowY: 'auto' }}>
          {paisesOrdenados.map((grupo) => (
            <Box key={grupo.paisKey}>
              <Typography sx={{ fontSize: 11, fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5, mb: 0.5 }}>
                {grupo.paisNombre}
              </Typography>
              <Stack spacing={0.75}>
                {grupo.zonas.map((z) => {
                  const zonaKey = `${z.paisKey}|||${z.zona}`;
                  const sMax = Math.max(1, ...z.sectores.map((s) => (moneda === 'USD' ? s.usd : s.local)));
                  const isOpen = open.has(zonaKey);
                  return (
                    <Box key={zonaKey}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }} onClick={() => toggle(zonaKey)}>
                        <IconButton size="small">{isOpen ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}</IconButton>
                        <Box sx={{ width: { xs: 90, sm: 140 }, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{z.zona}</Box>
                        <Tooltip title={`${grupo.paisNombre} · ${z.zona} · ${z.cuentas.toLocaleString()} cuentas · ${fmt(val(z))}`} arrow>
                          <Box sx={{ flex: 1, bgcolor: 'action.hover', borderRadius: 1, height: 16, minWidth: 60 }}>
                            <Box sx={{ width: `${Math.max(2, (val(z) / maxZona) * 100)}%`, bgcolor: '#1E3A8A', height: '100%', borderRadius: 1 }} />
                          </Box>
                        </Tooltip>
                        <Box sx={{ width: { xs: 96, sm: 150 }, textAlign: 'right', fontSize: 11, whiteSpace: 'nowrap' }}>{fmt(val(z))} · {z.cuentas}</Box>
                      </Box>
                      <Collapse in={isOpen} unmountOnExit>
                        <Stack spacing={0.5} sx={{ pl: { xs: 5, sm: 6 }, py: 0.5 }}>
                          {z.sectores.map((s) => {
                            const sVal = moneda === 'USD' ? s.usd : s.local;
                            return (
                              <Box key={s.sector} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Box sx={{ width: { xs: 90, sm: 140 }, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.sector}</Box>
                                <Tooltip title={`${s.sector} · ${s.cuentas.toLocaleString()} cuentas · ${fmt(sVal)}`} arrow>
                                  <Box sx={{ flex: 1, bgcolor: 'action.hover', borderRadius: 1, height: 12, minWidth: 50 }}>
                                    <Box sx={{ width: `${Math.max(2, (sVal / sMax) * 100)}%`, bgcolor: '#0EA5E9', height: '100%', borderRadius: 1 }} />
                                  </Box>
                                </Tooltip>
                                <Box sx={{ width: { xs: 96, sm: 150 }, textAlign: 'right', fontSize: 11, whiteSpace: 'nowrap' }}>{fmt(sVal)} · {s.cuentas}</Box>
                              </Box>
                            );
                          })}
                        </Stack>
                      </Collapse>
                    </Box>
                  );
                })}
              </Stack>
            </Box>
          ))}
        </Stack>
      )}
    </Paper>
  );
};

export default DashboardZonaSector;
