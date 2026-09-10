import { MouseEvent as ReactMouseEvent, useEffect, useMemo, useState } from 'react';
import { Box, Collapse, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Paper, Stack, Tooltip, Typography } from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import type { CarteraRecord, DashboardFilterParams } from '../../types/cartera';
import { fetchCartera } from '../../services/carteraService';
import { getCarteraField, resolveCountry } from '../../utils/carteraAggregations';
import { simboloMoneda } from '../../utils/monedaOptions';

interface Props {
  filters: DashboardFilterParams;
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
 * Se calcula en el cliente a partir de la cartera completa (misma fuente que
 * `PDMigrationChart`, vía `/api/cartera` con los filtros activos) para respetar
 * el alcance/scope y los filtros del dashboard sin depender del resumen
 * pre-agregado del backend (que agrupa solo por zona, sin país, y lo limita a 20).
 */
const DashboardZonaSector = ({ filters, moneda, monedaCode, tasa }: Props) => {
  const [cuentas, setCuentas] = useState<CarteraRecord[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<ZonaSortKey>('valor');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [sortAnchor, setSortAnchor] = useState<null | HTMLElement>(null);

  useEffect(() => {
    let active = true;
    fetchCartera(filters).then((data) => { if (active) setCuentas(data); }).catch(() => { if (active) setCuentas([]); });
    return () => { active = false; };
  }, [filters]);

  const val = (z: { usd: number; local: number }) => (moneda === 'USD' ? z.usd : z.local);

  const paises = useMemo(() => {
    const zonas = new Map<string, ZonaAgg>();
    cuentas.forEach((row) => {
      const paisRaw = getCarteraField(row, ['pais']);
      const country = resolveCountry(paisRaw);
      const paisKey = country?.abbr ?? String(paisRaw ?? 'Sin país').trim().toUpperCase();
      const paisNombre = country?.name ?? String(paisRaw ?? 'Sin país');
      const zonaRaw = getCarteraField(row, ['zona']);
      const zona = zonaRaw ? String(zonaRaw) : 'Sin zona';
      const sectorRaw = getCarteraField(row, ['sector']);
      const sector = sectorRaw ? String(sectorRaw) : 'Sin sector';
      const usd = Number(getCarteraField(row, ['saldo_actual_usd']) ?? 0);
      const local = (Number.isFinite(usd) ? usd : 0) * tasa;

      const zonaKey = `${paisKey}|||${zona}`;
      const z = zonas.get(zonaKey) ?? { paisKey, paisNombre, zona, usd: 0, local: 0, cuentas: 0, sectores: [] as SectorAgg[] };
      z.usd += Number.isFinite(usd) ? usd : 0;
      z.local += Number.isFinite(local) ? local : 0;
      z.cuentas += 1;

      let s = z.sectores.find((item) => item.sector === sector);
      if (!s) { s = { sector, usd: 0, local: 0, cuentas: 0 }; z.sectores.push(s); }
      s.usd += Number.isFinite(usd) ? usd : 0;
      s.local += Number.isFinite(local) ? local : 0;
      s.cuentas += 1;

      zonas.set(zonaKey, z);
    });

    const porPais = new Map<string, PaisGroup>();
    zonas.forEach((z) => {
      const grupo = porPais.get(z.paisKey) ?? { paisKey: z.paisKey, paisNombre: z.paisNombre, zonas: [] as ZonaAgg[] };
      z.sectores.sort((a, b) => b.usd - a.usd);
      grupo.zonas.push(z);
      porPais.set(z.paisKey, grupo);
    });

    return Array.from(porPais.values()).sort((a, b) => a.paisNombre.localeCompare(b.paisNombre, 'es', { sensitivity: 'base' }));
  }, [cuentas, tasa]);

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
