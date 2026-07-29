import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, Grid, IconButton, Menu, MenuItem, Paper, Snackbar, Stack, Tab, Table, TableBody, TableCell, TableContainer,
  TableHead, TablePagination, TableRow, Tabs, TextField, Typography
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import DashboardFilters from '../../components/Dashboard/DashboardFilters';
import KpiCards from '../../components/Dashboard/KpiCards';
import { exportRowsToCsv, exportRowsToExcel } from '../../utils/tableExport';
import { useAuth } from '../../context/AuthContext';
import type { DashboardResponse, DashboardFilterOptions, DashboardMultiFilterParams } from '../../types/cartera';
import {
  getGestionDashboard, getGestionCuentas, getDetalleCuenta, getInfoCuenta, tipificarCuenta, crearPromesa,
  subirAdjunto, crearCarta, getCartas, aprobarCarta, rechazarCarta, getZonasPd, getPdCampanas, getEstadoCuentas,
  MONEDA_POR_PAIS, siglaPais, TIPIFICACIONES, TIPO_CONTACTO, CANALES,
  type CartaGestion, type DetalleCuenta, type AggNode, type EstadoCuenta
} from '../../services/gestionService';

const EMPTY_OPTS: DashboardFilterOptions = { pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] };
const EMPTY_FILTERS: DashboardMultiFilterParams = { pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] };
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const money = (n: number) => n.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type Metric = 'saldoLocal' | 'saldoUsd' | 'cuentas';

const edad = (fecha: string): string => {
  const d = new Date(fecha);
  if (isNaN(d.getTime())) return 'No disponible';
  const diff = Date.now() - d.getTime();
  const a = Math.floor(diff / (365.25 * 24 * 3600 * 1000));
  return a > 0 && a < 130 ? String(a) : 'No disponible';
};
const pick = (row: Record<string, unknown>, keys: string[]): string => {
  for (const k of keys) { const v = row[k]; if (v !== null && v !== undefined && String(v).trim() !== '') return String(v); }
  return 'No disponible';
};

/** PNG por canvas (sin dependencias): barras horizontales. */
const exportBarsPng = (title: string, items: Array<{ label: string; value: number }>) => {
  const rows = items.slice(0, 25);
  const W = 900, rowH = 26, top = 50, H = top + rows.length * rowH + 20;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0F172A'; ctx.font = 'bold 18px sans-serif'; ctx.fillText(title, 16, 30);
  const max = Math.max(1, ...rows.map((r) => r.value));
  const labelW = 220, barX = labelW + 16, barMax = W - barX - 130;
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    ctx.fillStyle = '#334155'; ctx.font = '12px sans-serif';
    ctx.fillText(r.label.slice(0, 32), 16, y + 17);
    ctx.fillStyle = '#1E3A8A'; ctx.fillRect(barX, y + 6, (r.value / max) * barMax, 14);
    ctx.fillStyle = '#0F172A'; ctx.fillText(money(r.value), barX + barMax + 8, y + 17);
  });
  const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = `${title}.png`; a.click();
};

const HEAD_H = ['Nivel', 'Zona', 'PD', 'Campaña', 'Cuentas', 'Saldo Local', 'Saldo USD', 'Recuperado', '% Rec'];

/** Tarjeta de visual con menú ⋮ (orden/pantalla completa/PNG/CSV/Excel). */
const VisualCard = ({ title, onDir, onMetric, csv, excel, png, children }: {
  title: string; onDir: (d: 'asc' | 'desc') => void; onMetric: (m: Metric) => void;
  csv: () => void; excel: () => void; png: () => void; children: ReactNode;
}) => {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [full, setFull] = useState(false);
  const close = () => setAnchor(null);
  const header = (
    <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Typography sx={{ fontWeight: 700 }}>{title}</Typography>
      <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)}><MoreVertIcon fontSize="small" /></IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={close}>
        <MenuItem onClick={() => { onDir('desc'); close(); }}>Ordenar descendente</MenuItem>
        <MenuItem onClick={() => { onDir('asc'); close(); }}>Ordenar ascendente</MenuItem>
        <Divider />
        <MenuItem onClick={() => { onMetric('saldoLocal'); close(); }}>Por saldo local</MenuItem>
        <MenuItem onClick={() => { onMetric('saldoUsd'); close(); }}>Por saldo USD</MenuItem>
        <MenuItem onClick={() => { onMetric('cuentas'); close(); }}>Por cuentas</MenuItem>
        <Divider />
        <MenuItem onClick={() => { setFull(true); close(); }}>Pantalla completa</MenuItem>
        <MenuItem onClick={() => { png(); close(); }}>Exportar PNG</MenuItem>
        <MenuItem onClick={() => { csv(); close(); }}>Exportar CSV</MenuItem>
        <MenuItem onClick={() => { excel(); close(); }}>Descargar Excel</MenuItem>
      </Menu>
    </Box>
  );
  return (
    <Paper sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
      {header}
      <Box sx={{ px: 1.5, pb: 1.5, maxHeight: 340, overflowY: 'auto' }}>{children}</Box>
      <Dialog fullScreen open={full} onClose={() => setFull(false)}>
        <DialogTitle sx={{ fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>{title}<Button onClick={() => setFull(false)} sx={{ textTransform: 'none' }}>Cerrar</Button></DialogTitle>
        <DialogContent dividers>{children}</DialogContent>
      </Dialog>
    </Paper>
  );
};

/** Barra horizontal proporcional. */
const Bar = ({ value, max, color = '#1E3A8A' }: { value: number; max: number; color?: string }) => (
  <Box sx={{ flex: 1, bgcolor: 'action.hover', borderRadius: 1, height: 14, position: 'relative', minWidth: 80 }}>
    <Box sx={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%`, bgcolor: color, height: '100%', borderRadius: 1 }} />
  </Box>
);

const GestionPage = () => {
  const { hasPermission } = useAuth();
  const canGestionar = hasPermission('gestion.gestionar');
  const canPromesa = hasPermission('gestion.promesa.crear');
  const canCarta = hasPermission('gestion.carta.crear');
  const canAdjunto = hasPermission('gestion.adjunto.subir');
  const canAprobar = hasPermission('gestion.carta.aprobar');

  const [tab, setTab] = useState(0);
  const [filters, setFilters] = useState<DashboardMultiFilterParams>(EMPTY_FILTERS);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [cuentas, setCuentas] = useState<Array<Record<string, unknown>>>([]);
  const [zonas, setZonas] = useState<AggNode[]>([]);
  const [pdCamp, setPdCamp] = useState<AggNode[]>([]);
  const [estado, setEstado] = useState<Record<string, EstadoCuenta>>({});
  const [expZ, setExpZ] = useState<Set<string>>(new Set());
  const [expPd, setExpPd] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [rpp, setRpp] = useState(25);
  const [toast, setToast] = useState<string | null>(null);

  const [zMetric, setZMetric] = useState<Metric>('saldoLocal'); const [zDir, setZDir] = useState<'asc' | 'desc'>('desc');
  const [pMetric, setPMetric] = useState<Metric>('saldoUsd'); const [pDir, setPDir] = useState<'asc' | 'desc'>('desc');
  const [fPd, setFPd] = useState(''); const [fZona, setFZona] = useState(''); const [fCamp, setFCamp] = useState('');

  // Panel único por cuenta
  const [panel, setPanel] = useState<Record<string, unknown> | null>(null);
  const [ptab, setPtab] = useState(0);
  const [detalle, setDetalle] = useState<DetalleCuenta | null>(null);
  const [info, setInfo] = useState<Record<string, unknown> | null>(null);
  const [gForm, setGForm] = useState({ tipoContacto: '', canal: '', tip: '', tipCom: '', fechaProm: '', montoProm: '', promCom: '', cartaTipo: 'Carta de cobro', cartaCom: '', adjTipo: 'Boleta de pago' });
  const [adjFile, setAdjFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const [cartas, setCartas] = useState<CartaGestion[]>([]);
  const [cartaSel, setCartaSel] = useState<CartaGestion | null>(null);
  const [cartaComent, setCartaComent] = useState('');

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [d, c, z, pc] = await Promise.all([getGestionDashboard(filters), getGestionCuentas(filters), getZonasPd(filters), getPdCampanas(filters)]);
      setDashboard(d); setCuentas(c); setZonas(z); setPdCamp(pc); setPage(0);
    } catch (err) { setError(err instanceof Error ? err.message : 'No fue posible cargar la gestión.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [filters]);
  useEffect(() => { if (tab === 2) getCartas().then(setCartas).catch(() => undefined); }, [tab]);

  const opts = dashboard?.filterOptions ?? EMPTY_OPTS;
  const monedaLocal = useMemo(() => {
    if (filters.pais.length !== 1) return null;
    return { pais: filters.pais[0], moneda: MONEDA_POR_PAIS[filters.pais[0].toUpperCase()] ?? '—' };
  }, [filters.pais]);

  const sortNodes = (arr: AggNode[], m: Metric, dir: 'asc' | 'desc') =>
    [...arr].sort((a, b) => (dir === 'desc' ? (b[m] as number) - (a[m] as number) : (a[m] as number) - (b[m] as number)));
  const zonasSorted = useMemo(() => sortNodes(zonas, zMetric, zDir), [zonas, zMetric, zDir]);
  const pdSorted = useMemo(() => sortNodes(pdCamp, pMetric, pDir), [pdCamp, pMetric, pDir]);
  const zMax = Math.max(1, ...zonasSorted.map((z) => z[zMetric] as number));
  const pMax = Math.max(1, ...pdSorted.map((p) => p[pMetric] as number));

  const optsTabla = useMemo(() => {
    const uniq = (k: string) => [...new Set(cuentas.map((r) => str(r[k])).filter(Boolean))].sort();
    return { pd: uniq('pd_actual'), zona: uniq('zona'), campania: uniq('campania_adeuda') };
  }, [cuentas]);
  const cuentasFiltradas = useMemo(() => cuentas.filter((r) =>
    (!fPd || str(r.pd_actual) === fPd) && (!fZona || str(r.zona) === fZona) && (!fCamp || str(r.campania_adeuda) === fCamp)
  ), [cuentas, fPd, fZona, fCamp]);
  const paged = cuentasFiltradas.slice(page * rpp, page * rpp + rpp);
  useEffect(() => {
    const codigos = paged.map((r) => str(r.codigo)).filter(Boolean);
    if (codigos.length) getEstadoCuentas(codigos).then((m) => setEstado((prev) => ({ ...prev, ...m }))).catch(() => undefined);
    // eslint-disable-next-line
  }, [page, rpp, cuentasFiltradas]);
  const limpiarFiltrosTabla = () => { setFPd(''); setFZona(''); setFCamp(''); setPage(0); };

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => { const n = new Set(set); n.has(key) ? n.delete(key) : n.add(key); setter(n); };

  const rowsZonas = (): Array<Array<string | number>> => {
    const out: Array<Array<string | number>> = [];
    zonasSorted.forEach((z) => {
      out.push(['Zona', z.zona ?? '', '', '', z.cuentas, z.saldoLocal, z.saldoUsd, z.recuperadoUsd, z.pctRecuperacion]);
      (z.pds ?? []).forEach((p) => out.push(['PD', z.zona ?? '', p.pd ?? '', '', p.cuentas, p.saldoLocal, p.saldoUsd, p.recuperadoUsd, p.pctRecuperacion]));
    });
    return out;
  };
  const rowsPd = (): Array<Array<string | number>> => {
    const out: Array<Array<string | number>> = [];
    pdSorted.forEach((p) => {
      out.push(['PD', '', p.pd ?? '', '', p.cuentas, p.saldoLocal, p.saldoUsd, p.recuperadoUsd, p.pctRecuperacion]);
      (p.campanas ?? []).forEach((c) => out.push(['Campaña', '', p.pd ?? '', c.campania ?? '', c.cuentas, c.saldoLocal, c.saldoUsd, c.recuperadoUsd, c.pctRecuperacion]));
    });
    return out;
  };
  const CUENTAS_COLS = ['codigo', 'nombre', 'pais', 'zona', 'gestor', 'pd_actual', 'campania_adeuda', 'saldo_inicial_usd', 'saldo_actual_usd', 'saldo_actual'];
  const CUENTAS_HEAD = ['Cuenta', 'Representante', 'País', 'Zona', 'Gestor', 'PD', 'Campaña', 'Saldo Inicial USD', 'Saldo Actual USD', 'Saldo Local'];
  const rowsCuentas = () => cuentasFiltradas.map((r) => CUENTAS_COLS.map((c) => str(r[c])));

  const abrirPanel = async (row: Record<string, unknown>) => {
    setPanel(row); setPtab(0); setDetalle(null); setInfo(null);
    setGForm({ tipoContacto: '', canal: '', tip: '', tipCom: '', fechaProm: '', montoProm: '', promCom: '', cartaTipo: 'Carta de cobro', cartaCom: '', adjTipo: 'Boleta de pago' });
    setAdjFile(null);
    const cod = str(row.codigo);
    getDetalleCuenta(cod).then(setDetalle).catch(() => undefined);
    getInfoCuenta(cod).then(setInfo).catch(() => undefined);
  };
  const cod = str(panel?.codigo);
  const accion = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try { await fn(); setToast(ok); setDetalle(await getDetalleCuenta(cod)); }
    catch (err) { setToast(err instanceof Error ? err.message : 'Error.'); }
    finally { setBusy(false); }
  };

  if (loading && !dashboard) return <Box sx={{ display: 'flex', gap: 1.5, p: 3, alignItems: 'center' }}><CircularProgress size={22} /><Typography sx={{ fontSize: 14 }}>Cargando gestión...</Typography></Box>;
  if (error) return <Box sx={{ p: 2 }}><Alert severity="error">{error}</Alert></Box>;

  const promVigente = (detalle?.promesas ?? []).find((p) => str(p.estado) === 'PENDIENTE') ?? (detalle?.promesas ?? [])[0];

  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Operación" sx={{ textTransform: 'none' }} />
        <Tab label="Cuentas" sx={{ textTransform: 'none' }} />
        <Tab label="Cartas" sx={{ textTransform: 'none' }} />
      </Tabs>

      {(tab === 0 || tab === 1) && dashboard && (
        <Stack spacing={2}>
          <DashboardFilters filters={filters} onChange={setFilters} onClear={() => setFilters(EMPTY_FILTERS)} options={opts} />
          {monedaLocal && <Alert severity="info" sx={{ py: 0.5 }}>Moneda local: <strong>{monedaLocal.pais.toUpperCase()} · {monedaLocal.moneda}</strong></Alert>}
          {tab === 0 && <KpiCards kpis={dashboard.kpis} />}
        </Stack>
      )}

      {tab === 0 && dashboard && (
        <Stack spacing={2} sx={{ mt: 2 }}>
          {/* Zonas — visual de barras */}
          <VisualCard title="Zonas" onDir={setZDir} onMetric={setZMetric}
            csv={() => exportRowsToCsv('gestion_zonas.csv', HEAD_H, rowsZonas())}
            excel={() => exportRowsToExcel('gestion_zonas.xlsx', 'Zonas', HEAD_H, rowsZonas())}
            png={() => exportBarsPng('Zonas', zonasSorted.map((z) => ({ label: z.zona ?? z.key, value: z[zMetric] as number })))}>
            <Stack spacing={0.75}>
              {zonasSorted.map((z) => (
                <Box key={z.key}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }} onClick={() => toggle(expZ, z.key, setExpZ)}>
                    <IconButton size="small">{expZ.has(z.key) ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}</IconButton>
                    <Box sx={{ width: 150, fontSize: 13, fontWeight: 600 }}>{z.zona} <Typography component="span" sx={{ fontSize: 11, color: 'text.secondary' }}>({siglaPais(z.pais ?? '')})</Typography></Box>
                    <Bar value={z[zMetric] as number} max={zMax} />
                    <Box sx={{ width: 190, textAlign: 'right', fontSize: 12 }}>{z.cuentas} cta · {money(z.saldoLocal)} L · {z.pctRecuperacion}%</Box>
                  </Box>
                  <Collapse in={expZ.has(z.key)} unmountOnExit>
                    <Stack spacing={0.5} sx={{ pl: 7, py: 0.5 }}>
                      {(z.pds ?? []).map((p) => (
                        <Box key={p.key} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ width: 110, fontSize: 12 }}>{p.pd}</Box>
                          <Bar value={p.saldoUsd} max={Math.max(1, ...(z.pds ?? []).map((x) => x.saldoUsd))} color="#0EA5E9" />
                          <Box sx={{ width: 190, textAlign: 'right', fontSize: 11 }}>{p.cuentas} cta · {money(p.saldoLocal)} L · {p.pctRecuperacion}%</Box>
                        </Box>
                      ))}
                    </Stack>
                  </Collapse>
                </Box>
              ))}
            </Stack>
          </VisualCard>

          {/* PD por campañas — visual de barras */}
          <VisualCard title="PD por campañas" onDir={setPDir} onMetric={setPMetric}
            csv={() => exportRowsToCsv('gestion_pd_campanas.csv', HEAD_H, rowsPd())}
            excel={() => exportRowsToExcel('gestion_pd_campanas.xlsx', 'PD_Campanas', HEAD_H, rowsPd())}
            png={() => exportBarsPng('PD por campañas', pdSorted.map((p) => ({ label: p.pd ?? p.key, value: p[pMetric] as number })))}>
            <Stack spacing={0.75}>
              {pdSorted.map((p) => (
                <Box key={p.key}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }} onClick={() => toggle(expPd, p.key, setExpPd)}>
                    <IconButton size="small">{expPd.has(p.key) ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}</IconButton>
                    <Box sx={{ width: 110, fontSize: 13, fontWeight: 700 }}>{p.pd}</Box>
                    <Bar value={p[pMetric] as number} max={pMax} color="#7C3AED" />
                    <Box sx={{ width: 190, textAlign: 'right', fontSize: 12 }}>{p.cuentas} cta · {money(p.saldoUsd)} USD · {p.pctRecuperacion}%</Box>
                  </Box>
                  <Collapse in={expPd.has(p.key)} unmountOnExit>
                    <Stack spacing={0.5} sx={{ pl: 7, py: 0.5 }}>
                      {(p.campanas ?? []).map((c) => (
                        <Box key={c.key} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ width: 150, fontSize: 12 }}>{c.campania}</Box>
                          <Bar value={c.saldoUsd} max={Math.max(1, ...(p.campanas ?? []).map((x) => x.saldoUsd))} color="#22C55E" />
                          <Box sx={{ width: 190, textAlign: 'right', fontSize: 11 }}>{c.cuentas} cta · {money(c.saldoUsd)} USD · {c.pctRecuperacion}%</Box>
                        </Box>
                      ))}
                    </Stack>
                  </Collapse>
                </Box>
              ))}
            </Stack>
          </VisualCard>
        </Stack>
      )}

      {tab === 1 && (
        <Paper sx={{ mt: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
          <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography sx={{ fontWeight: 700, mr: 1 }}>Cuentas ({cuentasFiltradas.length.toLocaleString('es')})</Typography>
              <TextField select size="small" label="PD" value={fPd} onChange={(e) => { setFPd(e.target.value); setPage(0); }} sx={{ minWidth: 100 }}><MenuItem value="">Todos</MenuItem>{optsTabla.pd.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField>
              <TextField select size="small" label="Zona" value={fZona} onChange={(e) => { setFZona(e.target.value); setPage(0); }} sx={{ minWidth: 120 }}><MenuItem value="">Todas</MenuItem>{optsTabla.zona.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField>
              <TextField select size="small" label="Campaña" value={fCamp} onChange={(e) => { setFCamp(e.target.value); setPage(0); }} sx={{ minWidth: 120 }}><MenuItem value="">Todas</MenuItem>{optsTabla.campania.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField>
              <Button size="small" onClick={limpiarFiltrosTabla} sx={{ textTransform: 'none' }}>Limpiar filtros</Button>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Button size="small" startIcon={<FileDownloadOutlinedIcon />} onClick={() => exportRowsToCsv('gestion_cuentas.csv', CUENTAS_HEAD, rowsCuentas())} sx={{ textTransform: 'none' }}>CSV</Button>
              <Button size="small" startIcon={<FileDownloadOutlinedIcon />} onClick={() => exportRowsToExcel('gestion_cuentas.xlsx', 'Cuentas', CUENTAS_HEAD, rowsCuentas())} sx={{ textTransform: 'none' }}>Excel</Button>
            </Box>
          </Box>
          <TableContainer sx={{ maxHeight: '62vh' }}>
            <Table stickyHeader size="small">
              <TableHead><TableRow>{['Acciones', 'Código', 'Representante', 'País', 'Zona', 'PD', 'Saldo Local', 'Saldo USD'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>
                {paged.map((r, i) => (
                  <TableRow key={str(r.codigo) || i} hover>
                    <TableCell><Button size="small" variant="outlined" onClick={() => abrirPanel(r)} sx={{ textTransform: 'none', minWidth: 0 }}>Acciones</Button></TableCell>
                    <TableCell>{str(r.codigo)}</TableCell><TableCell sx={{ whiteSpace: 'nowrap' }}>{str(r.nombre)}</TableCell>
                    <TableCell><Chip size="small" label={siglaPais(str(r.pais))} /></TableCell><TableCell>{str(r.zona)}</TableCell>
                    <TableCell><Chip size="small" label={str(r.pd_actual)} /></TableCell>
                    <TableCell align="right">{money(Number(str(r.saldo_actual)))}</TableCell>
                    <TableCell align="right">{money(Number(str(r.saldo_actual_usd)))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination component="div" count={cuentasFiltradas.length} page={page} onPageChange={(_e, p) => setPage(p)} rowsPerPage={rpp} onRowsPerPageChange={(e) => { setRpp(parseInt(e.target.value, 10)); setPage(0); }} rowsPerPageOptions={[25, 50, 100]} labelRowsPerPage="Filas" />
        </Paper>
      )}

      {tab === 2 && (
        <Paper sx={{ mt: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
          <TableContainer sx={{ maxHeight: '65vh' }}>
            <Table stickyHeader size="small">
              <TableHead><TableRow>{['Código', 'Tipo', 'Estado', 'Comentario', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>
                {cartas.map((c) => (
                  <TableRow key={c.id} hover>
                    <TableCell>{c.codigo}</TableCell><TableCell>{c.tipo}</TableCell>
                    <TableCell><Chip size="small" label={c.estado} color={c.estado === 'APROBADA' ? 'success' : c.estado === 'RECHAZADA' ? 'error' : 'warning'} variant="outlined" /></TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{c.comentario}</TableCell>
                    <TableCell>{canAprobar && c.estado === 'PENDIENTE_APROBACION' && <Button size="small" onClick={() => { setCartaSel(c); setCartaComent(''); }} sx={{ textTransform: 'none' }}>Revisar</Button>}</TableCell>
                  </TableRow>
                ))}
                {cartas.length === 0 && <TableRow><TableCell colSpan={5} align="center" sx={{ py: 3, color: 'text.secondary' }}>Sin cartas.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Panel único: Información | Detalle | Gestionar */}
      <Dialog open={Boolean(panel)} onClose={() => setPanel(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Cuenta {cod} · {str(panel?.nombre)}</DialogTitle>
        <DialogContent dividers>
          <Tabs value={ptab} onChange={(_e, v) => setPtab(v)} sx={{ mb: 2 }}>
            <Tab label="Información" sx={{ textTransform: 'none' }} />
            <Tab label="Detalle" sx={{ textTransform: 'none' }} />
            <Tab label="Gestionar" sx={{ textTransform: 'none' }} />
          </Tabs>

          {ptab === 0 && (!info ? <CircularProgress size={22} /> : (
            <Stack spacing={2}>
              <Typography sx={{ fontWeight: 700 }}>Datos generales</Typography>
              <Grid container spacing={1.5}>
                <Grid item xs={4}><Field l="Sector" v={pick(info, ['sector'])} /><Field l="LOA" v={pick(info, ['loa', 'l_o_a'])} /><Field l="LOS" v={pick(info, ['los', 'l_o_s'])} /></Grid>
                <Grid item xs={4}><Field l="Departamento" v={pick(info, ['departamento'])} /><Field l="Municipio" v={pick(info, ['municipio'])} /></Grid>
                <Grid item xs={4}>
                  <Field l="Fecha de nacimiento" v={pick(info, ['fecha_de_nacimiento', 'fecha_nacimiento'])} />
                  <Field l="Edad" v={pick(info, ['fecha_de_nacimiento', 'fecha_nacimiento']) === 'No disponible' ? 'No disponible' : edad(pick(info, ['fecha_de_nacimiento', 'fecha_nacimiento']))} />
                </Grid>
              </Grid>
              <Divider />
              <Typography sx={{ fontWeight: 700 }}>Contactos</Typography>
              <Grid container spacing={1.5}>
                <Grid item xs={6}><Field l="Teléfono celular" v={pick(info, ['telefono_celular', 'celular', 'telefono'])} /></Grid>
                <Grid item xs={6}><Field l="Teléfono casa" v={pick(info, ['telefono_casa', 'casa'])} /></Grid>
                <Grid item xs={6}><Field l="Teléfono trabajo" v={pick(info, ['telefono_trabajo', 'trabajo'])} /></Grid>
                <Grid item xs={6}><Field l="Extensión" v={pick(info, ['extension_telefono_trabajo', 'extension'])} /></Grid>
              </Grid>
              <Divider />
              <Typography sx={{ fontWeight: 700 }}>Referencias</Typography>
              <Grid container spacing={1.5}>
                <Grid item xs={6}><Field l="Nombre" v={pick(info, ['nombre_referencia', 'referencia', 'referencia_nombre'])} /></Grid>
                <Grid item xs={6}><Field l="Teléfono 1" v={pick(info, ['telefono_referencia_1', 'referencia_telefono_1'])} /></Grid>
                <Grid item xs={6}><Field l="Teléfono 2" v={pick(info, ['telefono_referencia_2', 'referencia_telefono_2'])} /></Grid>
              </Grid>
              <Divider />
              <Typography sx={{ fontWeight: 700 }}>Gestión asignada</Typography>
              <Grid container spacing={1.5}>
                <Grid item xs={6}><Field l="Gerente de zona" v={pick(info, ['gerente_zona'])} /><Field l="Contacto gerente" v={pick(info, ['contacto_gerente', 'telefono_gerente'])} /></Grid>
                <Grid item xs={6}><Field l="Gestor" v={pick(info, ['gestor'])} /></Grid>
              </Grid>
            </Stack>
          ))}

          {ptab === 1 && (!detalle ? <CircularProgress size={22} /> : (
            <Stack spacing={1.5}>
              {promVigente && (
                <Alert severity="info" sx={{ py: 0.5 }}>
                  Promesa: <strong>{str(promVigente.fecha_promesa)}</strong> · Monto {str(promVigente.monto) || '—'} · Estado {str(promVigente.estado)}
                </Alert>
              )}
              <Typography sx={{ fontWeight: 700 }}>Historial de gestión</Typography>
              <TableContainer sx={{ maxHeight: 360 }}>
                <Table stickyHeader size="small">
                  <TableHead><TableRow>{['Tipificación', 'Fecha', 'Gestor', 'Tipo contacto', 'Canal', 'Observación'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
                  <TableBody>
                    {detalle.historial.length === 0 && <TableRow><TableCell colSpan={6} align="center" sx={{ py: 2, color: 'text.secondary' }}>Sin gestiones.</TableCell></TableRow>}
                    {detalle.historial.map((h, i) => (
                      <TableRow key={i}>
                        <TableCell>{str(h.tipificacion)}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{str(h.created_at).slice(0, 16).replace('T', ' ')}</TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{str(h.gestor_id) || 'No disponible'}</TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{str(h.tipo_contacto) || 'No disponible'}</TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{str(h.canal) || 'No disponible'}</TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{str(h.comentario) || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          ))}

          {ptab === 2 && (
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField select label="Tipo de contacto" value={gForm.tipoContacto} onChange={(e) => setGForm({ ...gForm, tipoContacto: e.target.value })} size="small" fullWidth>
                  {TIPO_CONTACTO.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </TextField>
                <TextField select label="Canal" value={gForm.canal} onChange={(e) => setGForm({ ...gForm, canal: e.target.value })} size="small" fullWidth>
                  {CANALES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </TextField>
              </Stack>
              <Divider />
              <Typography sx={{ fontWeight: 700, fontSize: 13 }}>Tipificación</Typography>
              <TextField select label="Tipificación" value={gForm.tip} onChange={(e) => setGForm({ ...gForm, tip: e.target.value })} size="small" fullWidth>
                {TIPIFICACIONES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </TextField>
              <TextField label="Comentario" value={gForm.tipCom} onChange={(e) => setGForm({ ...gForm, tipCom: e.target.value })} size="small" fullWidth multiline minRows={2} />
              <Button variant="contained" disabled={!canGestionar || busy || !gForm.tip} onClick={() => accion(() => tipificarCuenta(cod, { tipificacion: gForm.tip, comentario: gForm.tipCom, tipoContacto: gForm.tipoContacto, canal: gForm.canal }), 'Gestión registrada.')} sx={{ textTransform: 'none' }}>Registrar gestión</Button>

              <Divider />
              <Typography sx={{ fontWeight: 700, fontSize: 13 }}>Promesa</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Fecha" type="date" value={gForm.fechaProm} onChange={(e) => setGForm({ ...gForm, fechaProm: e.target.value })} size="small" fullWidth InputLabelProps={{ shrink: true }} />
                <TextField label="Monto" type="number" value={gForm.montoProm} onChange={(e) => setGForm({ ...gForm, montoProm: e.target.value })} size="small" fullWidth />
              </Stack>
              <Button variant="outlined" disabled={!canPromesa || busy || !gForm.fechaProm} onClick={() => accion(() => crearPromesa(cod, { fechaPromesa: gForm.fechaProm, monto: Number(gForm.montoProm) || undefined, comentario: gForm.promCom }), 'Promesa registrada.')} sx={{ textTransform: 'none' }}>Registrar promesa</Button>

              <Divider />
              <Typography sx={{ fontWeight: 700, fontSize: 13 }}>Carta</Typography>
              <TextField select label="Tipo de carta" value={gForm.cartaTipo} onChange={(e) => setGForm({ ...gForm, cartaTipo: e.target.value })} size="small" fullWidth>
                {['Carta de cobro', 'Carta de acuerdo de pago'].map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </TextField>
              <Button variant="outlined" disabled={!canCarta || busy} onClick={() => accion(() => crearCarta(cod, gForm.cartaTipo, gForm.cartaCom), 'Carta enviada a aprobación.')} sx={{ textTransform: 'none' }}>Generar carta (a aprobación)</Button>

              <Divider />
              <Typography sx={{ fontWeight: 700, fontSize: 13 }}>Adjunto</Typography>
              <TextField select label="Tipo de documento" value={gForm.adjTipo} onChange={(e) => setGForm({ ...gForm, adjTipo: e.target.value })} size="small" fullWidth>
                {['Carta recibida por la representante', 'Boleta de pago', 'Acuerdo de pago', 'Otro documento'].map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </TextField>
              <Button variant="outlined" component="label" sx={{ textTransform: 'none' }}>{adjFile ? adjFile.name : 'Seleccionar archivo'}<input hidden type="file" onChange={(e) => setAdjFile(e.target.files?.[0] ?? null)} /></Button>
              <Button variant="outlined" disabled={!canAdjunto || busy || !adjFile} onClick={() => adjFile && accion(() => subirAdjunto(cod, gForm.adjTipo, adjFile), 'Adjunto subido.')} sx={{ textTransform: 'none' }}>Subir adjunto</Button>
            </Stack>
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setPanel(null)} sx={{ textTransform: 'none' }}>Cerrar</Button></DialogActions>
      </Dialog>

      {/* Revisar carta */}
      <Dialog open={Boolean(cartaSel)} onClose={() => setCartaSel(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Revisar carta</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography sx={{ fontSize: 13 }}>Cuenta {cartaSel?.codigo} · {cartaSel?.tipo}</Typography>
            <TextField label="Comentario" value={cartaComent} onChange={(e) => setCartaComent(e.target.value)} size="small" fullWidth multiline minRows={2} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button color="error" onClick={async () => { if (cartaSel) { await rechazarCarta(cartaSel.id, cartaComent); setCartaSel(null); setToast('Carta rechazada.'); getCartas().then(setCartas); } }} sx={{ textTransform: 'none' }}>Rechazar</Button>
          <Button variant="contained" onClick={async () => { if (cartaSel) { await aprobarCarta(cartaSel.id, cartaComent); setCartaSel(null); setToast('Carta aprobada.'); getCartas().then(setCartas); } }} sx={{ textTransform: 'none' }}>Aprobar</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(toast)} autoHideDuration={3500} onClose={() => setToast(null)} message={toast ?? ''} />
    </Box>
  );
};

const Field = ({ l, v }: { l: string; v: string }) => (
  <Box sx={{ mb: 1 }}>
    <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase' }}>{l}</Typography>
    <Typography sx={{ fontSize: 13 }}>{v}</Typography>
  </Box>
);

export default GestionPage;
