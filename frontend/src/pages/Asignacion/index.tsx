import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, Grid, MenuItem, Paper, Snackbar, Stack, Tab, Table, TableBody, TableCell, TableContainer,
  TableHead, TablePagination, TableRow, Tabs, TextField, Typography
} from '@mui/material';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import { useAuth } from '../../context/AuthContext';
import { getControlCuentas } from '../../services/controlService';
import { exportRowsToCsv, exportRowsToExcel } from '../../utils/tableExport';
import {
  getAsignacionGestores, simularAsignacion, aplicarAsignacion, reasignarCuenta, getAsignacionHistorial,
  type ReglaAsignacion, type SimGestor, type AsignacionGestor, type AsignacionHistorial
} from '../../services/asignacionService';

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const money = (n: number) => n.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const AsignacionPage = () => {
  const { hasPermission } = useAuth();
  const canSimular = hasPermission('control_operativo.asignacion.simular');
  const canAplicar = hasPermission('control_operativo.asignacion.aplicar');
  const canReasignar = hasPermission('control_operativo.reasignacion');
  const canExportBase = hasPermission('control_operativo.base_marcacion.exportar');

  const [tab, setTab] = useState(0);
  // Deep-link de pestaña desde la navegación (?tab=0..3). Compatibilidad con /asignacion.
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const raw = searchParams.get('tab');
    if (raw === null) return;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n <= 3) setTab(n);
  }, [searchParams]);
  const [gestores, setGestores] = useState<AsignacionGestor[]>([]);
  const [cuentas, setCuentas] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Regla de asignación
  const [regla, setRegla] = useState<ReglaAsignacion>({ ambito: 'GLOBAL', grupoPrioritarioPct: 80, criterio: 'saldo', gestoresPrioritario: [], gestoresResto: [] });
  const [sim, setSim] = useState<SimGestor[] | null>(null);
  const [confirmAplicar, setConfirmAplicar] = useState(false);

  // Reasignación
  const [reCodigo, setReCodigo] = useState('');
  const [reGestor, setReGestor] = useState('');
  const [reMotivo, setReMotivo] = useState('');

  // Historial
  const [hist, setHist] = useState<AsignacionHistorial[]>([]);
  const [hf, setHf] = useState({ desde: '', hasta: '', pais: '', tipo: '', gestorNuevo: '' });

  // Base de marcación
  const [bPais, setBPais] = useState(''); const [bZona, setBZona] = useState(''); const [bPd, setBPd] = useState(''); const [bGestor, setBGestor] = useState('');
  const BASE_COLS = ['codigo', 'nombre', 'pais', 'zona', 'gestor', 'pd_actual', 'campania_adeuda', 'saldo_actual', 'saldo_actual_usd', 'telefono_celular'];
  const BASE_HEAD = ['Cuenta', 'Nombre', 'País', 'Zona', 'Gestor', 'PD', 'Campaña', 'Saldo Local', 'Saldo USD', 'Teléfono'];
  const [cols, setCols] = useState<string[]>(BASE_COLS);
  const [bPage, setBPage] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const [g, cu] = await Promise.all([getAsignacionGestores(), getControlCuentas()]);
        setGestores(g); setCuentas(cu);
      } catch (e) { setError(e instanceof Error ? e.message : 'No fue posible cargar la información.'); }
      finally { setLoading(false); }
    })();
  }, []);

  const nombresGestores = useMemo(() => gestores.map((g) => g.nombre).sort(), [gestores]);
  const optBase = useMemo(() => {
    const u = (k: string) => [...new Set(cuentas.map((r) => str(r[k])).filter(Boolean))].sort();
    return { pais: u('pais'), zona: u('zona'), pd: u('pd_actual'), gestor: u('gestor') };
  }, [cuentas]);

  const cuentaSel = useMemo(() => cuentas.find((r) => str(r.codigo) === reCodigo.trim()) ?? null, [cuentas, reCodigo]);

  const baseFiltradas = useMemo(() => cuentas.filter((r) =>
    (!bPais || str(r.pais) === bPais) && (!bZona || str(r.zona) === bZona) && (!bPd || str(r.pd_actual) === bPd) && (!bGestor || str(r.gestor) === bGestor)
  ), [cuentas, bPais, bZona, bPd, bGestor]);
  const baseSaldo = useMemo(() => baseFiltradas.reduce((a, r) => a + Number(str(r.saldo_actual_usd) || 0), 0), [baseFiltradas]);
  const basePaged = baseFiltradas.slice(bPage * 25, bPage * 25 + 25);
  const baseHeadSel = () => cols.map((c) => BASE_HEAD[BASE_COLS.indexOf(c)]);
  const baseRows = () => baseFiltradas.map((r) => cols.map((cc) => str(r[cc])));

  const doSimular = async () => {
    setBusy(true);
    try { const r = await simularAsignacion(regla); setSim(r.gestores); setToast(`Simulación: ${r.totalCuentas.toLocaleString('es')} cuentas.`); }
    catch (e) { setToast(e instanceof Error ? e.message : 'Error al simular.'); }
    finally { setBusy(false); }
  };
  const doAplicar = async () => {
    setBusy(true); setConfirmAplicar(false);
    try { const r = await aplicarAsignacion(regla); setToast(`Asignación aplicada: ${r.afectadas.toLocaleString('es')} cuentas afectadas.`); }
    catch (e) { setToast(e instanceof Error ? e.message : 'Error al aplicar.'); }
    finally { setBusy(false); }
  };
  const doReasignar = async () => {
    setBusy(true);
    try { await reasignarCuenta(reCodigo.trim(), reGestor, reMotivo.trim()); setToast('Cuenta reasignada y registrada en historial.'); setReCodigo(''); setReGestor(''); setReMotivo(''); }
    catch (e) { setToast(e instanceof Error ? e.message : 'Error al reasignar.'); }
    finally { setBusy(false); }
  };
  const cargarHistorial = async () => {
    setBusy(true);
    try { setHist(await getAsignacionHistorial(hf)); }
    catch (e) { setToast(e instanceof Error ? e.message : 'Error al cargar historial.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (tab === 2) void cargarHistorial(); /* eslint-disable-next-line */ }, [tab]);

  const multiVal = (e: { target: { value: unknown } }): string[] => (typeof e.target.value === 'string' ? e.target.value.split(',') : (e.target.value as string[]));

  if (loading) return <Box sx={{ display: 'flex', gap: 1.5, p: 3, alignItems: 'center' }}><CircularProgress size={22} /><Typography sx={{ fontSize: 14 }}>Cargando asignación...</Typography></Box>;
  if (error) return <Box sx={{ p: 2 }}><Alert severity="error">{error}</Alert></Box>;

  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      <Typography sx={{ fontSize: 20, fontWeight: 800, mb: 1 }}>Asignación de Cartera</Typography>
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" sx={{ mb: 2 }}>
        {['Asignación', 'Reasignación manual', 'Historial', 'Base de marcación'].map((t) => <Tab key={t} label={t} sx={{ textTransform: 'none' }} />)}
      </Tabs>

      {/* TAB 0 · Asignación */}
      {tab === 0 && (
        <Stack spacing={2}>
          <Paper sx={{ p: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
            <Typography sx={{ fontWeight: 700, mb: 1 }}>Regla de distribución</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6} md={3}>
                <TextField label="% grupo prioritario" type="number" size="small" fullWidth value={regla.grupoPrioritarioPct}
                  onChange={(e) => setRegla({ ...regla, grupoPrioritarioPct: Number(e.target.value) })}
                  InputProps={{ inputProps: { min: 0, max: 100 } }} helperText={`Resto: ${Math.max(0, 100 - regla.grupoPrioritarioPct)}%`} />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField select label="Criterio de prioridad" size="small" fullWidth value={regla.criterio} onChange={(e) => setRegla({ ...regla, criterio: e.target.value === 'cuentas' ? 'cuentas' : 'saldo' })}>
                  <MenuItem value="saldo">Saldo (mayor primero)</MenuItem>
                  <MenuItem value="cuentas">Cantidad de cuentas</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField select label="Gestores grupo prioritario" size="small" fullWidth value={regla.gestoresPrioritario}
                  SelectProps={{ multiple: true, renderValue: (v) => ((v as string[]).length ? (v as string[]).join(', ') : 'Ninguno') }}
                  onChange={(e) => setRegla({ ...regla, gestoresPrioritario: multiVal(e) })}>
                  {nombresGestores.map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField select label="Gestores grupo restante" size="small" fullWidth value={regla.gestoresResto}
                  SelectProps={{ multiple: true, renderValue: (v) => ((v as string[]).length ? (v as string[]).join(', ') : 'Ninguno') }}
                  onChange={(e) => setRegla({ ...regla, gestoresResto: multiVal(e) })}>
                  {nombresGestores.map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
                </TextField>
              </Grid>
            </Grid>
            <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
              <Button variant="contained" disabled={!canSimular || busy || (regla.gestoresPrioritario.length === 0 && regla.gestoresResto.length === 0)} onClick={doSimular} sx={{ textTransform: 'none' }}>Simular</Button>
              <Button variant="outlined" color="warning" disabled={!canAplicar || busy || !sim} onClick={() => setConfirmAplicar(true)} sx={{ textTransform: 'none' }}>Aplicar asignación</Button>
            </Stack>
          </Paper>

          {sim && (
            <Paper sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
              <Typography sx={{ fontWeight: 700, p: 1.5 }}>Simulación por gestor</Typography>
              <TableContainer sx={{ maxHeight: '55vh' }}>
                <Table stickyHeader size="small">
                  <TableHead><TableRow>{['Gestor', 'Cuentas actuales', 'Cuentas propuestas', 'Saldo actual USD', 'Saldo propuesto USD', 'PD (propuesto)', 'Riesgo (propuesto)'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</TableCell>)}</TableRow></TableHead>
                  <TableBody>
                    {sim.map((g) => (
                      <TableRow key={g.gestor} hover>
                        <TableCell>{g.gestor}</TableCell>
                        <TableCell align="right">{g.cuentasActuales}</TableCell>
                        <TableCell align="right"><strong>{g.cuentasPropuestas}</strong></TableCell>
                        <TableCell align="right">{money(g.saldoActualUsd)}</TableCell>
                        <TableCell align="right">{money(g.saldoPropuestoUsd)}</TableCell>
                        <TableCell sx={{ fontSize: 11 }}>{g.distPD.slice(0, 4).map((d) => `${d.clave}:${d.cuentas}`).join(' · ') || '—'}</TableCell>
                        <TableCell sx={{ fontSize: 11 }}>{g.distRiesgo.slice(0, 4).map((d) => `${d.clave}:${d.cuentas}`).join(' · ') || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </Stack>
      )}

      {/* TAB 1 · Reasignación manual */}
      {tab === 1 && (
        <Paper sx={{ p: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider', maxWidth: 620 }}>
          <Stack spacing={2}>
            <TextField label="Cuenta (código)" size="small" value={reCodigo} onChange={(e) => setReCodigo(e.target.value)} />
            <Alert severity={cuentaSel ? 'info' : 'warning'} sx={{ py: 0.5 }}>
              {cuentaSel ? <>Gestor actual: <strong>{str(cuentaSel.gestor) || 'Sin gestor'}</strong> · País: {str(cuentaSel.pais) || '—'} · Saldo: {money(Number(str(cuentaSel.saldo_actual_usd) || 0))} USD</> : 'Ingresa un código de cuenta dentro de tu alcance.'}
            </Alert>
            <TextField select label="Gestor destino" size="small" value={reGestor} onChange={(e) => setReGestor(e.target.value)} disabled={!cuentaSel}>
              {nombresGestores.map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
            </TextField>
            <TextField label="Motivo (obligatorio)" size="small" value={reMotivo} onChange={(e) => setReMotivo(e.target.value)} multiline minRows={2} />
            <Button variant="contained" disabled={!canReasignar || busy || !cuentaSel || !reGestor || !reMotivo.trim()} onClick={doReasignar} sx={{ textTransform: 'none' }}>Confirmar reasignación</Button>
          </Stack>
        </Paper>
      )}

      {/* TAB 2 · Historial */}
      {tab === 2 && (
        <Stack spacing={2}>
          <Paper sx={{ p: 1.5, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              <TextField label="Desde" type="date" size="small" InputLabelProps={{ shrink: true }} value={hf.desde} onChange={(e) => setHf({ ...hf, desde: e.target.value })} />
              <TextField label="Hasta" type="date" size="small" InputLabelProps={{ shrink: true }} value={hf.hasta} onChange={(e) => setHf({ ...hf, hasta: e.target.value })} />
              <TextField label="País" size="small" value={hf.pais} onChange={(e) => setHf({ ...hf, pais: e.target.value })} />
              <TextField select label="Tipo" size="small" sx={{ minWidth: 140 }} value={hf.tipo} onChange={(e) => setHf({ ...hf, tipo: e.target.value })}>
                <MenuItem value="">Todos</MenuItem><MenuItem value="AUTO">Automática</MenuItem><MenuItem value="MANUAL">Manual</MenuItem>
              </TextField>
              <TextField label="Gestor nuevo" size="small" value={hf.gestorNuevo} onChange={(e) => setHf({ ...hf, gestorNuevo: e.target.value })} />
              <Button variant="contained" onClick={cargarHistorial} disabled={busy} sx={{ textTransform: 'none' }}>Buscar</Button>
            </Stack>
          </Paper>
          <Paper sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
            <TableContainer sx={{ maxHeight: '60vh' }}>
              <Table stickyHeader size="small">
                <TableHead><TableRow>{['Fecha', 'Cuenta', 'Anterior', 'Nuevo', 'Tipo', 'Motivo', 'País', 'Usuario'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</TableCell>)}</TableRow></TableHead>
                <TableBody>
                  {hist.length === 0 ? <TableRow><TableCell colSpan={8} align="center" sx={{ py: 2, color: 'text.secondary' }}>Sin información disponible.</TableCell></TableRow> : hist.map((h) => (
                    <TableRow key={h.id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{h.created_at.slice(0, 16).replace('T', ' ')}</TableCell>
                      <TableCell>{h.codigo}</TableCell><TableCell>{h.gestor_anterior ?? '—'}</TableCell><TableCell>{h.gestor_nuevo}</TableCell>
                      <TableCell><Chip size="small" variant="outlined" label={h.tipo} /></TableCell>
                      <TableCell sx={{ fontSize: 12, maxWidth: 220 }}>{h.motivo ?? '—'}</TableCell>
                      <TableCell>{h.pais ?? '—'}</TableCell><TableCell sx={{ fontSize: 12 }}>{h.asignado_por_nombre ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Stack>
      )}

      {/* TAB 3 · Base de marcación */}
      {tab === 3 && (
        <Stack spacing={2}>
          <Paper sx={{ p: 1.5, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
              <TextField select label="País" size="small" sx={{ minWidth: 120 }} value={bPais} onChange={(e) => { setBPais(e.target.value); setBPage(0); }}><MenuItem value="">Todos</MenuItem>{optBase.pais.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField>
              <TextField select label="Zona" size="small" sx={{ minWidth: 120 }} value={bZona} onChange={(e) => { setBZona(e.target.value); setBPage(0); }}><MenuItem value="">Todas</MenuItem>{optBase.zona.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField>
              <TextField select label="PD" size="small" sx={{ minWidth: 100 }} value={bPd} onChange={(e) => { setBPd(e.target.value); setBPage(0); }}><MenuItem value="">Todos</MenuItem>{optBase.pd.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField>
              <TextField select label="Gestor" size="small" sx={{ minWidth: 140 }} value={bGestor} onChange={(e) => { setBGestor(e.target.value); setBPage(0); }}><MenuItem value="">Todos</MenuItem>{optBase.gestor.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField>
              <Button size="small" onClick={() => { setBPais(''); setBZona(''); setBPd(''); setBGestor(''); setBPage(0); }} sx={{ textTransform: 'none' }}>Limpiar</Button>
            </Stack>
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
              <Chip color="primary" label={`${baseFiltradas.length.toLocaleString('es')} cuentas`} />
              <Chip variant="outlined" label={`Saldo USD ${money(baseSaldo)}`} />
              <Box sx={{ flex: 1 }} />
              <Button size="small" startIcon={<FileDownloadOutlinedIcon />} disabled={!canExportBase || baseFiltradas.length === 0} onClick={() => exportRowsToCsv('base_marcacion.csv', baseHeadSel(), baseRows())} sx={{ textTransform: 'none' }}>CSV</Button>
              <Button size="small" startIcon={<FileDownloadOutlinedIcon />} disabled={!canExportBase || baseFiltradas.length === 0} onClick={() => exportRowsToExcel('base_marcacion.xlsx', 'Base', baseHeadSel(), baseRows())} sx={{ textTransform: 'none' }}>Excel</Button>
            </Stack>
            <Box sx={{ mt: 1 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', mb: 0.5 }}>Columnas a exportar</Typography>
              <Stack direction="row" flexWrap="wrap" useFlexGap>
                {BASE_COLS.map((cc, i) => (
                  <FormControlLabel key={cc} control={<Checkbox size="small" checked={cols.includes(cc)} onChange={(e) => setCols((prev) => e.target.checked ? [...BASE_COLS].filter((x) => prev.includes(x) || x === cc) : prev.filter((x) => x !== cc))} />} label={<Typography sx={{ fontSize: 12 }}>{BASE_HEAD[i]}</Typography>} />
                ))}
              </Stack>
            </Box>
          </Paper>
          <Paper sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
            <TableContainer sx={{ maxHeight: '55vh' }}>
              <Table stickyHeader size="small">
                <TableHead><TableRow>{cols.map((cc) => <TableCell key={cc} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{BASE_HEAD[BASE_COLS.indexOf(cc)]}</TableCell>)}</TableRow></TableHead>
                <TableBody>
                  {basePaged.map((r, i) => <TableRow key={str(r.codigo) || i} hover>{cols.map((cc) => <TableCell key={cc}>{str(r[cc])}</TableCell>)}</TableRow>)}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination component="div" count={baseFiltradas.length} page={bPage} onPageChange={(_e, p) => setBPage(p)} rowsPerPage={25} rowsPerPageOptions={[25]} labelRowsPerPage="Filas" />
          </Paper>
        </Stack>
      )}

      <Dialog open={confirmAplicar} onClose={() => setConfirmAplicar(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Confirmar asignación</DialogTitle>
        <DialogContent><Typography sx={{ fontSize: 14 }}>Se registrará la asignación propuesta (solo las cuentas que cambian de gestor) en el historial auditable. ¿Deseas continuar?</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmAplicar(false)} sx={{ textTransform: 'none' }}>Cancelar</Button>
          <Button variant="contained" color="warning" disabled={busy} onClick={doAplicar} sx={{ textTransform: 'none' }}>Aplicar</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} message={toast ?? ''} />
    </Box>
  );
};

export default AsignacionPage;
