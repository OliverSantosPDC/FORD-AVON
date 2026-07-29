import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton, MenuItem, Paper, Snackbar, Stack, Tab, Table, TableBody, TableCell, TableContainer,
  TableHead, TablePagination, TableRow, Tabs, TextField, Typography
} from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import DashboardFilters from '../../components/Dashboard/DashboardFilters';
import KpiCards from '../../components/Dashboard/KpiCards';
import { exportRowsToCsv } from '../../utils/tableExport';
import { useAuth } from '../../context/AuthContext';
import type { DashboardResponse, DashboardFilterOptions, DashboardMultiFilterParams } from '../../types/cartera';
import {
  getGestionDashboard, getGestionCuentas, getDetalleCuenta, tipificarCuenta, crearPromesa,
  subirAdjunto, crearCarta, getCartas, aprobarCarta, rechazarCarta,
  getZonasPd, getPdCampanas, getEstadoCuentas,
  MONEDA_POR_PAIS, TIPIFICACIONES, type CartaGestion, type DetalleCuenta, type AggNode, type EstadoCuenta
} from '../../services/gestionService';

const money = (n: number) => n.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const EMPTY_OPTS: DashboardFilterOptions = { pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] };
const EMPTY_FILTERS: DashboardMultiFilterParams = { pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] };
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

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

  // Gestionar cuenta
  const [sel, setSel] = useState<Record<string, unknown> | null>(null);
  const [subtab, setSubtab] = useState(0);
  const [detalle, setDetalle] = useState<DetalleCuenta | null>(null);
  const [tip, setTip] = useState(''); const [tipCom, setTipCom] = useState('');
  const [prom, setProm] = useState({ fechaPromesa: '', monto: '', comentario: '' });
  const [carta, setCarta] = useState({ tipo: 'Carta de cobro', comentario: '' });
  const [adjTipo, setAdjTipo] = useState('Boleta de pago'); const [adjFile, setAdjFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  // Cartas
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
  useEffect(() => { if (tab === 1) getCartas().then(setCartas).catch(() => undefined); }, [tab]);

  const opts = dashboard?.filterOptions ?? EMPTY_OPTS;
  const monedaLocal = useMemo(() => {
    if (filters.pais.length !== 1) return null;
    const p = filters.pais[0].toUpperCase();
    return { pais: filters.pais[0], moneda: MONEDA_POR_PAIS[p] ?? '—' };
  }, [filters.pais]);

  const abrirGestionar = async (row: Record<string, unknown>) => {
    setSel(row); setSubtab(0); setDetalle(null);
    setTip(''); setTipCom(''); setProm({ fechaPromesa: '', monto: '', comentario: '' });
    setCarta({ tipo: 'Carta de cobro', comentario: '' }); setAdjFile(null);
    try { setDetalle(await getDetalleCuenta(str(row.codigo))); } catch { /* noop */ }
  };
  const codigoSel = str(sel?.codigo);

  const accion = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try { await fn(); setToast(ok); setDetalle(await getDetalleCuenta(codigoSel)); }
    catch (err) { setToast(err instanceof Error ? err.message : 'Error.'); }
    finally { setBusy(false); }
  };

  const paged = cuentas.slice(page * rpp, page * rpp + rpp);

  useEffect(() => {
    const codigos = paged.map((r) => str(r.codigo)).filter(Boolean);
    if (codigos.length) getEstadoCuentas(codigos).then((m) => setEstado((prev) => ({ ...prev, ...m }))).catch(() => undefined);
    // eslint-disable-next-line
  }, [page, rpp, cuentas]);

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const n = new Set(set); n.has(key) ? n.delete(key) : n.add(key); setter(n);
  };
  const exportarZonas = () => {
    const headers = ['Zona', 'País', 'Cuentas', 'Saldo Local', 'Saldo USD', 'Recuperado USD', '% Rec'];
    const rows = zonas.map((z) => [z.zona ?? z.key, z.pais ?? '', z.cuentas, z.saldoLocal, z.saldoUsd, z.recuperadoUsd, z.pctRecuperacion]);
    exportRowsToCsv('gestion_zonas.csv', headers, rows);
  };
  const exportarCuentas = () => {
    const cols = ['codigo', 'nombre', 'pais', 'zona', 'gestor', 'pd_actual', 'campania_adeuda', 'saldo_inicial_usd', 'saldo_actual_usd', 'saldo_actual'];
    const headers = ['Cuenta', 'Representante', 'País', 'Zona', 'Gestor', 'PD', 'Campaña', 'Saldo Inicial USD', 'Saldo Actual USD', 'Saldo Local'];
    const rows = cuentas.map((r) => cols.map((c) => str(r[c])));
    exportRowsToCsv('gestion_cuentas.csv', headers, rows);
  };

  if (loading && !dashboard) return <Box sx={{ display: 'flex', gap: 1.5, p: 3, alignItems: 'center' }}><CircularProgress size={22} /><Typography sx={{ fontSize: 14 }}>Cargando gestión...</Typography></Box>;
  if (error) return <Box sx={{ p: 2 }}><Alert severity="error">{error}</Alert></Box>;

  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Operación" sx={{ textTransform: 'none' }} />
        <Tab label="Cartas" sx={{ textTransform: 'none' }} />
      </Tabs>

      {tab === 0 && dashboard && (
        <Stack spacing={2}>
          <DashboardFilters filters={filters} onChange={setFilters} onClear={() => setFilters(EMPTY_FILTERS)} options={opts} />
          {monedaLocal && (
            <Alert severity="info" sx={{ py: 0.5 }}>Moneda local: <strong>{monedaLocal.pais.toUpperCase()} · {monedaLocal.moneda}</strong></Alert>
          )}
          <KpiCards kpis={dashboard.kpis} />

          {/* Zonas expandibles (zona → PD) */}
          <Paper sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
            <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography sx={{ fontWeight: 700 }}>Zonas</Typography>
              <Button size="small" startIcon={<FileDownloadOutlinedIcon />} onClick={exportarZonas} sx={{ textTransform: 'none' }}>Exportar</Button>
            </Box>
            <TableContainer sx={{ maxHeight: 360 }}>
              <Table stickyHeader size="small">
                <TableHead><TableRow>{['', 'Zona', 'País', 'Cuentas', 'Saldo Local', 'Saldo USD', 'Recuperado', '% Rec'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
                <TableBody>
                  {zonas.map((z) => (
                    <>
                      <TableRow key={z.key} hover>
                        <TableCell><IconButton size="small" onClick={() => toggle(expZ, z.key, setExpZ)}>{expZ.has(z.key) ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}</IconButton></TableCell>
                        <TableCell>{z.zona}</TableCell><TableCell>{z.pais}</TableCell><TableCell>{z.cuentas}</TableCell>
                        <TableCell align="right">{money(z.saldoLocal)}</TableCell><TableCell align="right">{money(z.saldoUsd)}</TableCell>
                        <TableCell align="right">{money(z.recuperadoUsd)}</TableCell><TableCell align="right">{z.pctRecuperacion}%</TableCell>
                      </TableRow>
                      <TableRow key={`${z.key}-c`}>
                        <TableCell colSpan={8} sx={{ p: 0, border: 0 }}>
                          <Collapse in={expZ.has(z.key)} unmountOnExit>
                            <Table size="small">
                              <TableBody>
                                {(z.pds ?? []).map((p) => (
                                  <TableRow key={p.key} sx={{ bgcolor: 'action.hover' }}>
                                    <TableCell sx={{ pl: 6 }}>{p.pd}</TableCell><TableCell /><TableCell>{p.cuentas}</TableCell>
                                    <TableCell align="right">{money(p.saldoLocal)}</TableCell><TableCell align="right">{money(p.saldoUsd)}</TableCell>
                                    <TableCell align="right">{money(p.recuperadoUsd)}</TableCell><TableCell align="right">{p.pctRecuperacion}%</TableCell><TableCell />
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </Collapse>
                        </TableCell>
                      </TableRow>
                    </>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          {/* PD → Campañas expandibles */}
          <Paper sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
            <Box sx={{ p: 1.5 }}><Typography sx={{ fontWeight: 700 }}>PD por campañas</Typography></Box>
            <TableContainer sx={{ maxHeight: 360 }}>
              <Table stickyHeader size="small">
                <TableHead><TableRow>{['', 'PD / Campaña', 'Cuentas', 'Saldo Local', 'Saldo USD', 'Recuperado', '% Rec'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
                <TableBody>
                  {pdCamp.map((p) => (
                    <>
                      <TableRow key={p.key} hover>
                        <TableCell><IconButton size="small" onClick={() => toggle(expPd, p.key, setExpPd)}>{expPd.has(p.key) ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}</IconButton></TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{p.pd}</TableCell><TableCell>{p.cuentas}</TableCell>
                        <TableCell align="right">{money(p.saldoLocal)}</TableCell><TableCell align="right">{money(p.saldoUsd)}</TableCell>
                        <TableCell align="right">{money(p.recuperadoUsd)}</TableCell><TableCell align="right">{p.pctRecuperacion}%</TableCell>
                      </TableRow>
                      <TableRow key={`${p.key}-c`}>
                        <TableCell colSpan={7} sx={{ p: 0, border: 0 }}>
                          <Collapse in={expPd.has(p.key)} unmountOnExit>
                            <Table size="small">
                              <TableBody>
                                {(p.campanas ?? []).map((cmp) => (
                                  <TableRow key={cmp.key} sx={{ bgcolor: 'action.hover' }}>
                                    <TableCell sx={{ pl: 6 }}>{cmp.campania}</TableCell><TableCell>{cmp.cuentas}</TableCell>
                                    <TableCell align="right">{money(cmp.saldoLocal)}</TableCell><TableCell align="right">{money(cmp.saldoUsd)}</TableCell>
                                    <TableCell align="right">{money(cmp.recuperadoUsd)}</TableCell><TableCell align="right">{cmp.pctRecuperacion}%</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </Collapse>
                        </TableCell>
                      </TableRow>
                    </>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          <Paper sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
            <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography sx={{ fontWeight: 700 }}>Cuentas ({cuentas.length.toLocaleString('es')})</Typography>
              <Button size="small" startIcon={<FileDownloadOutlinedIcon />} onClick={exportarCuentas} sx={{ textTransform: 'none' }}>Exportar</Button>
            </Box>
            <TableContainer sx={{ maxHeight: '60vh' }}>
              <Table stickyHeader size="small">
                <TableHead><TableRow>{['Código', 'Representante', 'País', 'Zona', 'Gestor', 'PD', 'Saldo USD', 'Últ. tipificación', 'Promesa', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</TableCell>)}</TableRow></TableHead>
                <TableBody>
                  {paged.map((r, i) => {
                    const est = estado[str(r.codigo)];
                    return (
                      <TableRow key={str(r.codigo) || i} hover>
                        <TableCell>{str(r.codigo)}</TableCell><TableCell sx={{ whiteSpace: 'nowrap' }}>{str(r.nombre)}</TableCell>
                        <TableCell>{str(r.pais)}</TableCell><TableCell>{str(r.zona)}</TableCell><TableCell>{str(r.gestor)}</TableCell>
                        <TableCell><Chip size="small" label={str(r.pd_actual)} /></TableCell>
                        <TableCell align="right">{money(Number(str(r.saldo_actual_usd)))}</TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{est?.ultimaTipificacion ?? '—'}</TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{est?.promesaVigente ? <Chip size="small" color="info" variant="outlined" label={est.promesaVigente} /> : '—'}</TableCell>
                        <TableCell><Button size="small" onClick={() => abrirGestionar(r)} sx={{ textTransform: 'none' }}>Gestionar</Button></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination component="div" count={cuentas.length} page={page} onPageChange={(_e, p) => setPage(p)} rowsPerPage={rpp} onRowsPerPageChange={(e) => { setRpp(parseInt(e.target.value, 10)); setPage(0); }} rowsPerPageOptions={[25, 50, 100]} labelRowsPerPage="Filas" />
          </Paper>
        </Stack>
      )}

      {tab === 1 && (
        <Paper sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
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

      {/* Gestionar cuenta */}
      <Dialog open={Boolean(sel)} onClose={() => setSel(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Gestionar cuenta {codigoSel} · {str(sel?.nombre)}</DialogTitle>
        <DialogContent dividers>
          <Tabs value={subtab} onChange={(_e, v) => setSubtab(v)} variant="scrollable" sx={{ mb: 2 }}>
            <Tab label="Tipificación" sx={{ textTransform: 'none' }} />
            <Tab label="Promesa" sx={{ textTransform: 'none' }} />
            <Tab label="Carta" sx={{ textTransform: 'none' }} />
            <Tab label="Adjunto" sx={{ textTransform: 'none' }} />
            <Tab label="Detalle" sx={{ textTransform: 'none' }} />
          </Tabs>

          {subtab === 0 && (
            <Stack spacing={2}>
              <TextField select label="Tipificación" value={tip} onChange={(e) => setTip(e.target.value)} size="small" fullWidth>
                {TIPIFICACIONES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </TextField>
              <TextField label="Comentario" value={tipCom} onChange={(e) => setTipCom(e.target.value)} size="small" fullWidth multiline minRows={2} />
              <Button variant="contained" disabled={!canGestionar || busy || !tip} onClick={() => accion(() => tipificarCuenta(codigoSel, tip, tipCom), 'Gestión registrada.')} sx={{ textTransform: 'none' }}>Registrar</Button>
            </Stack>
          )}
          {subtab === 1 && (
            <Stack spacing={2}>
              <TextField label="Fecha de promesa" type="date" value={prom.fechaPromesa} onChange={(e) => setProm({ ...prom, fechaPromesa: e.target.value })} size="small" fullWidth InputLabelProps={{ shrink: true }} />
              <TextField label="Monto" type="number" value={prom.monto} onChange={(e) => setProm({ ...prom, monto: e.target.value })} size="small" fullWidth />
              <TextField label="Comentario" value={prom.comentario} onChange={(e) => setProm({ ...prom, comentario: e.target.value })} size="small" fullWidth multiline minRows={2} />
              <Button variant="contained" disabled={!canPromesa || busy || !prom.fechaPromesa} onClick={() => accion(() => crearPromesa(codigoSel, { fechaPromesa: prom.fechaPromesa, monto: Number(prom.monto) || undefined, comentario: prom.comentario }), 'Promesa registrada.')} sx={{ textTransform: 'none' }}>Registrar promesa</Button>
            </Stack>
          )}
          {subtab === 2 && (
            <Stack spacing={2}>
              <TextField select label="Tipo de carta" value={carta.tipo} onChange={(e) => setCarta({ ...carta, tipo: e.target.value })} size="small" fullWidth>
                {['Carta de cobro', 'Carta de acuerdo de pago'].map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </TextField>
              <TextField label="Comentario" value={carta.comentario} onChange={(e) => setCarta({ ...carta, comentario: e.target.value })} size="small" fullWidth multiline minRows={2} />
              <Alert severity="info" sx={{ py: 0.5 }}>La carta quedará en estado PENDIENTE_APROBACION para revisión del supervisor.</Alert>
              <Button variant="contained" disabled={!canCarta || busy} onClick={() => accion(() => crearCarta(codigoSel, carta.tipo, carta.comentario), 'Carta enviada a aprobación.')} sx={{ textTransform: 'none' }}>Generar carta</Button>
            </Stack>
          )}
          {subtab === 3 && (
            <Stack spacing={2}>
              <TextField select label="Tipo de documento" value={adjTipo} onChange={(e) => setAdjTipo(e.target.value)} size="small" fullWidth>
                {['Carta recibida por la representante', 'Boleta de pago', 'Acuerdo de pago', 'Otro documento'].map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </TextField>
              <Button variant="outlined" component="label" sx={{ textTransform: 'none' }}>{adjFile ? adjFile.name : 'Seleccionar archivo'}<input hidden type="file" onChange={(e) => setAdjFile(e.target.files?.[0] ?? null)} /></Button>
              <Button variant="contained" disabled={!canAdjunto || busy || !adjFile} onClick={() => adjFile && accion(() => subirAdjunto(codigoSel, adjTipo, adjFile), 'Adjunto subido.')} sx={{ textTransform: 'none' }}>Subir</Button>
            </Stack>
          )}
          {subtab === 4 && (
            <Stack spacing={1.5}>
              <Typography sx={{ fontWeight: 700 }}>Contacto</Typography>
              <Typography sx={{ fontSize: 13 }}>Cliente: {str(sel?.nombre)} · Gestor: {str(sel?.gestor)} · Zona: {str(sel?.zona)}</Typography>
              <Divider />
              <Typography sx={{ fontWeight: 700 }}>Historial ({detalle?.historial.length ?? 0})</Typography>
              {(detalle?.historial ?? []).slice(0, 8).map((h, i) => (
                <Typography key={i} sx={{ fontSize: 12 }}>{str(h.created_at).slice(0, 16)} · {str(h.tipificacion)} — {str(h.comentario)}</Typography>
              ))}
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Promesas: {detalle?.promesas.length ?? 0} · Adjuntos: {detalle?.adjuntos.length ?? 0} · Cartas: {detalle?.cartas.length ?? 0}</Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setSel(null)} sx={{ textTransform: 'none' }}>Cerrar</Button></DialogActions>
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

export default GestionPage;
