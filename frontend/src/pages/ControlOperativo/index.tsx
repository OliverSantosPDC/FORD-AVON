import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, FormControlLabel, Grid, IconButton, Menu, MenuItem, Paper, Snackbar, Stack, Tab, Table, TableBody, TableCell,
  TableContainer, TableHead, TablePagination, TableRow, Tabs, TextField, Typography
} from '@mui/material';
import {
  Bar as RBar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis
} from 'recharts';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import DashboardFilters from '../../components/Dashboard/DashboardFilters';
import KpiCards from '../../components/Dashboard/KpiCards';
import ChartCard from '../../components/Dashboard/ChartCard';
import { exportRowsToCsv, exportRowsToExcel } from '../../utils/tableExport';
import { useAuth } from '../../context/AuthContext';
import { useTasasConversion } from '../../hooks/useTasasConversion';
import { usdEquivalente } from '../../utils/monedaConversion';
import { MONEDA_OPTIONS, simboloMoneda } from '../../utils/monedaOptions';
import type { DistribItem } from '../../services/controlService';
import type { DashboardFilterOptions, DashboardMultiFilterParams } from '../../types/cartera';
import {
  getControlDashboard, getControlGestores, getControlZonas, getControlPdCampanas, getControlCuentas,
  getIndicadores, getPendientes, getResumenOperativo, getCalidadResumen, getCalidadEvaluaciones, getCalidadGestores, crearEvaluacionCalidad,
  CALIDAD_RUBRICA, CALIDAD_PENALIZACIONES,
  type ControlDashboard, type ControlNode, type Indicadores, type Pendientes,
  type CalidadResumen, type CalidadEvaluacion, type CalidadGestor, type ResumenOperativo
} from '../../services/controlService';
import {
  getDetalleCuenta, getInfoCuenta, tipificarCuenta, crearPromesa, subirAdjunto,
  crearCarta, getCartaPreview, aprobarCarta, rechazarCarta,
  getFirmaAutorizacion, subirFirmaAutorizacion, autorizarCartasMasivo,
  getEstadoCuentas, getCatalogo, siglaPais, TIPIFICACIONES, TIPO_CONTACTO, CANALES, MONEDA_POR_PAIS,
  type DetalleCuenta, type EstadoCuenta, type CartaPreview, type FirmaAutorizacion
} from '../../services/gestionService';
import CartaRenderer from '../../components/common/CartaRenderer';

const EMPTY_OPTS: DashboardFilterOptions = { pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] };
const EMPTY_FILTERS: DashboardMultiFilterParams = { pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] };
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type Metric = 'saldoLocal' | 'saldoUsd' | 'cuentas';

const exportBarsPng = (title: string, items: Array<{ label: string; value: number }>) => {
  const rows = items.slice(0, 25); const W = 900, rowH = 26, top = 50, H = top + rows.length * rowH + 20;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d'); if (!ctx) return;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#0F172A'; ctx.font = 'bold 18px sans-serif'; ctx.fillText(title, 16, 30);
  const max = Math.max(1, ...rows.map((r) => r.value)); const bx = 236, bmax = W - bx - 130;
  rows.forEach((r, i) => { const y = top + i * rowH; ctx.fillStyle = '#334155'; ctx.font = '12px sans-serif'; ctx.fillText(r.label.slice(0, 32), 16, y + 17); ctx.fillStyle = '#1E3A8A'; ctx.fillRect(bx, y + 6, (r.value / max) * bmax, 14); ctx.fillStyle = '#0F172A'; ctx.fillText(money(r.value), bx + bmax + 8, y + 17); });
  const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = `${title}.png`; a.click();
};
const HEAD_H = ['Nivel', 'Grupo', 'Sub', 'Cuentas', 'Saldo Local', 'Saldo USD', 'Recuperado', '% Rec'];

// ===== Distribución por País/Zona/Sector (Resumen Operativo): gráficos de
// barras horizontales reales (antes: listado de texto). Reutiliza ChartCard
// (mismo componente/estilo de título que el resto del dashboard) y el mismo
// dato que ya alimentaba el listado anterior (resumenOp.distribucion.*,
// calculado en el backend desde saldo_actual + tasa vigente — nunca
// saldo_actual_usd). El saldo se re-expresa en la moneda elegida localmente
// aquí (misma fórmula `usd * tasaActual` que Gestión/Dashboard), nunca
// hardcodeando "$"/"USD".
const DIST_ROW_H = 30;
const DIST_PAD_H = 56;
const DIST_MIN_H = 210;
const DIST_MAX_VISIBLE_H = 360;
const distAxisTick = { fill: '#475569', fontSize: 10.5 };
const distFormatCompact = (value: number) => {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return `${value}`;
};

interface DistRow { clave: string; cuentas: number; valor: number; pct: number; }

const DistribTooltip = ({ active, payload, dimLabel, simbolo }: {
  active?: boolean; payload?: Array<{ payload: DistRow }>; dimLabel: string; simbolo: string;
}) => {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <Box sx={{ borderRadius: 1.5, border: '1px solid #E2E8F0', boxShadow: '0 16px 40px rgba(15, 23, 42, 0.14)', backgroundColor: '#FFFFFF', px: 1.5, py: 1, minWidth: 200 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#0F172A', mb: 0.25 }}>{dimLabel}: {d.clave}</Typography>
      <Typography sx={{ fontSize: 12, color: '#475569' }}>Cuentas: {d.cuentas.toLocaleString('en-US')}</Typography>
      <Typography sx={{ fontSize: 12, color: '#475569' }}>Saldo actual: {simbolo} {d.valor.toLocaleString('en-US', { maximumFractionDigits: 0 })}</Typography>
      <Typography sx={{ fontSize: 12, color: '#475569' }}>% del total: {d.pct.toFixed(1)}%</Typography>
    </Box>
  );
};

const DistribucionCard = ({ titulo, dimLabel, items, simbolo, tasaActual, chartId }: {
  titulo: string; dimLabel: string; items: DistribItem[]; simbolo: string; tasaActual: number; chartId: string;
}) => {
  const data: DistRow[] = useMemo(() => {
    const total = items.reduce((a, x) => a + x.saldoUsd, 0);
    return items.map((x) => ({
      clave: x.clave, cuentas: x.cuentas,
      valor: Number((x.saldoUsd * tasaActual).toFixed(2)),
      pct: total > 0 ? (x.saldoUsd / total) * 100 : 0
    }));
  }, [items, tasaActual]);

  const chartHeight = Math.max(DIST_MIN_H, data.length * DIST_ROW_H + DIST_PAD_H);
  const cardHeight = Math.min(chartHeight, DIST_MAX_VISIBLE_H);

  return (
    <ChartCard
      title={titulo}
      subtitle={`Moneda: ${simbolo}`}
      chartId={chartId}
      fileBaseName={chartId}
      height={cardHeight}
      csvHeaders={[dimLabel, 'Cuentas', `Saldo Actual ${simbolo}`, '% del total']}
      csvRows={data.map((d) => [d.clave, d.cuentas, d.valor, Number(d.pct.toFixed(2))])}
    >
      {(visibleH) => data.length === 0 ? (
        <Box sx={{ height: visibleH, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Sin datos para los filtros seleccionados.</Typography>
        </Box>
      ) : (
        <Box sx={{ height: visibleH, overflowY: 'auto', overflowX: 'hidden' }}>
          <Box sx={{ height: chartHeight, width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ top: 4, right: 28, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                <XAxis type="number" tickFormatter={distFormatCompact} tick={distAxisTick} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="clave" width={132} tick={distAxisTick} axisLine={false} tickLine={false} interval={0} />
                <RTooltip content={<DistribTooltip dimLabel={dimLabel} simbolo={simbolo} />} cursor={{ fill: 'rgba(230,0,126,0.06)' }} />
                <RBar dataKey="valor" name="Saldo actual" fill="#1E3A8A" radius={[0, 6, 6, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Box>
      )}
    </ChartCard>
  );
};

const VisualCard = ({ title, onDir, onMetric, csv, excel, png, children }: {
  title: string; onDir: (d: 'asc' | 'desc') => void; onMetric: (m: Metric) => void; csv: () => void; excel: () => void; png: () => void; children: ReactNode;
}) => {
  const [an, setAn] = useState<null | HTMLElement>(null); const [full, setFull] = useState(false); const close = () => setAn(null);
  return (
    <Paper sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
      <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography sx={{ fontWeight: 700 }}>{title}</Typography>
        <IconButton size="small" onClick={(e) => setAn(e.currentTarget)}><MoreVertIcon fontSize="small" /></IconButton>
        <Menu anchorEl={an} open={Boolean(an)} onClose={close}>
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
      <Box sx={{ px: 1.5, pb: 1.5, maxHeight: 260, overflowY: 'auto' }}>{children}</Box>
      <Dialog fullScreen open={full} onClose={() => setFull(false)}>
        <DialogTitle sx={{ fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>{title}<Button onClick={() => setFull(false)} sx={{ textTransform: 'none' }}>Cerrar</Button></DialogTitle>
        <DialogContent dividers>{children}</DialogContent>
      </Dialog>
    </Paper>
  );
};
const Bar = ({ value, max, color = '#1E3A8A' }: { value: number; max: number; color?: string }) => (
  <Box sx={{ flex: 1, bgcolor: 'action.hover', borderRadius: 1, height: 14, minWidth: 70 }}><Box sx={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%`, bgcolor: color, height: '100%', borderRadius: 1 }} /></Box>
);
const KpiMini = ({ l, v }: { l: string; v: string | number }) => (
  <Paper sx={{ p: 1.25, borderRadius: 2, border: '1px solid', borderColor: 'divider', minWidth: 120 }}>
    <Typography sx={{ fontSize: 10, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase' }}>{l}</Typography>
    <Typography sx={{ fontSize: 18, fontWeight: 800 }}>{v}</Typography>
  </Paper>
);

const ControlOperativoPage = () => {
  const { hasPermission, user } = useAuth();
  const canGestionar = hasPermission('gestion.gestionar');
  const canCarta = hasPermission('gestion.carta.crear');
  const canAprobar = hasPermission('gestion.carta.aprobar');
  const canCalidadVer = hasPermission('control_operativo.calidad.ver');
  const canCalidadEdit = hasPermission('control_operativo.calidad.editar');
  const { tasas } = useTasasConversion();
  const nombreAutorizador = user ? (`${user.nombre ?? ''} ${user.apellido ?? ''}`.trim() || user.email) : '';

  // Moneda de "Resumen Operativo" (Distribución por País/Zona/Sector): mismo
  // mecanismo/útil que ya usan Dashboard y Gestión — useTasasConversion +
  // MONEDA_OPTIONS + usd * tasaActual — nunca saldo_actual_usd ni un símbolo
  // fijo. No afecta las demás tarjetas de Control Operativo (Operativa por
  // gestor/zona/PD siguen mostrando Saldo Local/Saldo USD como antes).
  const [monedaResumen, setMonedaResumen] = useState<string>('USD');
  const monedaResumenOption = MONEDA_OPTIONS.find((o) => o.code === monedaResumen) ?? MONEDA_OPTIONS[0];
  const tasaResumen = tasas[monedaResumenOption.code] ?? 1;
  const simboloResumen = simboloMoneda(monedaResumenOption.code);

  const [filters, setFilters] = useState<DashboardMultiFilterParams>(EMPTY_FILTERS);
  const [dash, setDash] = useState<ControlDashboard | null>(null);
  const [gestores, setGestores] = useState<ControlNode[]>([]);
  const [zonas, setZonas] = useState<ControlNode[]>([]);
  const [pdCamp, setPdCamp] = useState<ControlNode[]>([]);
  const [cuentas, setCuentas] = useState<Array<Record<string, unknown>>>([]);
  const [ind, setInd] = useState<Indicadores | null>(null);
  const [pend, setPend] = useState<Pendientes | null>(null);
  const [resumenOp, setResumenOp] = useState<ResumenOperativo | null>(null);
  const [estado, setEstado] = useState<Record<string, EstadoCuenta>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Si el filtro cambia varias veces seguidas (Gestor A -> B -> C) antes de
  // que responda la primera carga, una respuesta obsoleta que llegue tarde
  // NUNCA debe pisar el resultado de una selección más reciente.
  const loadRequestIdRef = useRef(0);

  const [gMetric, setGMetric] = useState<Metric>('saldoLocal'); const [gDir, setGDir] = useState<'asc' | 'desc'>('desc'); const [expG, setExpG] = useState<Set<string>>(new Set());
  const [zMetric, setZMetric] = useState<Metric>('saldoLocal'); const [zDir, setZDir] = useState<'asc' | 'desc'>('desc'); const [expZ, setExpZ] = useState<Set<string>>(new Set());
  const [pMetric, setPMetric] = useState<Metric>('saldoUsd'); const [pDir, setPDir] = useState<'asc' | 'desc'>('desc'); const [expP, setExpP] = useState<Set<string>>(new Set());

  const [fPd, setFPd] = useState(''); const [fZona, setFZona] = useState(''); const [fCamp, setFCamp] = useState('');
  const [page, setPage] = useState(0); const [rpp, setRpp] = useState(25);

  const [panel, setPanel] = useState<Record<string, unknown> | null>(null); const [ptab, setPtab] = useState(0);
  const [detalle, setDetalle] = useState<DetalleCuenta | null>(null); const [info, setInfo] = useState<Record<string, unknown> | null>(null);
  const [g, setG] = useState({ tipoContacto: '', canal: '', tip: '', tipCom: '', fechaProm: '', montoProm: '', cartaCom: '', adjTipo: 'Boleta de pago' });
  const [adjFile, setAdjFile] = useState<File | null>(null); const [busy, setBusy] = useState(false);
  // Vista previa EN VIVO bloqueada al PD actual de la cuenta — el backend
  // decide la plantilla (ver getCartaPreview); nunca se elige manualmente.
  const [cartaPreview, setCartaPreview] = useState<CartaPreview | null>(null);
  const [cartaPrevOpen, setCartaPrevOpen] = useState(false);
  const [cartaSel, setCartaSel] = useState<Record<string, unknown> | null>(null);
  const [cartaComent, setCartaComent] = useState('');
  // "Mi firma de autorización": la firma predeterminada del supervisor
  // AUTENTICADO, usada automáticamente al autorizar — nunca elegida a mano.
  const [miFirma, setMiFirma] = useState<FirmaAutorizacion | null>(null);
  const [miFirmaSubiendo, setMiFirmaSubiendo] = useState(false);
  const cargarMiFirma = () => { if (canAprobar) getFirmaAutorizacion().then(setMiFirma).catch(() => undefined); };
  const subirMiFirma = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setToast('El archivo debe ser una imagen (PNG, JPG, GIF, WEBP, SVG, etc.).'); return; }
    setMiFirmaSubiendo(true);
    try { await subirFirmaAutorizacion(file); cargarMiFirma(); setToast('Firma de autorización actualizada.'); }
    catch (e) { setToast(e instanceof Error ? e.message : 'No se pudo subir tu firma.'); }
    finally { setMiFirmaSubiendo(false); }
  };
  useEffect(() => { cargarMiFirma(); /* eslint-disable-next-line */ }, [canAprobar]);
  // Selección múltiple de cartas pendientes (autorización masiva) — SIEMPRE
  // acotada a lo que el usuario puede ver bajo los filtros/alcance actuales
  // (ver cartasPendientesFiltradas más abajo), nunca a la lista completa sin filtrar.
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());
  const [autorizarOpen, setAutorizarOpen] = useState(false);
  const [autorizarBusy, setAutorizarBusy] = useState(false);
  const [cCatTip, setCCatTip] = useState<string[]>(TIPIFICACIONES);
  const [cCatTC, setCCatTC] = useState<string[]>(TIPO_CONTACTO);
  const [cCatCanal, setCCatCanal] = useState<string[]>(CANALES);
  useEffect(() => {
    getCatalogo('tipificaciones').then((v) => { if (v.length) setCCatTip(v); }).catch(() => undefined);
    getCatalogo('tipos_contacto').then((v) => { if (v.length) setCCatTC(v); }).catch(() => undefined);
    getCatalogo('canales').then((v) => { if (v.length) setCCatCanal(v); }).catch(() => undefined);
  }, []);

  // Calidad de Gestión
  const [calResumen, setCalResumen] = useState<CalidadResumen | null>(null);
  const [calEvals, setCalEvals] = useState<CalidadEvaluacion[]>([]);
  const [calGestores, setCalGestores] = useState<CalidadGestor[]>([]);
  const [calOpen, setCalOpen] = useState(false);
  const [calBusy, setCalBusy] = useState(false);
  const emptyCal = () => ({ gestorNombre: '', gestorId: '' as string, pais: '', zona: '', cuenta: '', tipificacion: '', observaciones: '', criterios: {} as Record<string, number>, penalizaciones: {} as Record<string, number> });
  const [calForm, setCalForm] = useState(emptyCal());

  const loadCalidad = async () => {
    if (!canCalidadVer) return;
    try {
      const [res, evs, ges] = await Promise.all([getCalidadResumen(filters), getCalidadEvaluaciones(filters), getCalidadGestores()]);
      setCalResumen(res); setCalEvals(evs); setCalGestores(ges);
    } catch { /* no bloquea la vista principal */ }
  };
  const guardarEvaluacion = async () => {
    setCalBusy(true);
    try {
      await crearEvaluacionCalidad({
        gestorId: calForm.gestorId || null,
        gestorNombre: calForm.gestorNombre,
        pais: calForm.pais || null, zona: calForm.zona || null, cuenta: calForm.cuenta || null,
        tipificacion: calForm.tipificacion || null,
        criterios: calForm.criterios, penalizaciones: calForm.penalizaciones,
        observaciones: calForm.observaciones || null
      });
      setToast('Evaluación de calidad registrada.'); setCalOpen(false); setCalForm(emptyCal());
      await loadCalidad();
    } catch (e) { setToast(e instanceof Error ? e.message : 'No se pudo guardar la evaluación.'); }
    finally { setCalBusy(false); }
  };

  const load = async () => {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true); setError(null);
    try {
      const [d, ge, z, pc, cu, i, pe, ro] = await Promise.all([getControlDashboard(filters), getControlGestores(filters), getControlZonas(filters), getControlPdCampanas(filters), getControlCuentas(filters), getIndicadores(), getPendientes(), getResumenOperativo(filters)]);
      if (requestId !== loadRequestIdRef.current) return; // obsoleta: llegó después de un filtro más reciente
      setDash(d); setGestores(ge); setZonas(z); setPdCamp(pc); setCuentas(cu); setInd(i); setPend(pe); setResumenOp(ro); setPage(0);
    } catch (e) {
      if (requestId !== loadRequestIdRef.current) return;
      setError(e instanceof Error ? e.message : 'No fue posible cargar el control operativo.');
    } finally {
      if (requestId === loadRequestIdRef.current) setLoading(false);
    }
  };
  useEffect(() => { void load(); void loadCalidad(); /* eslint-disable-next-line */ }, [filters]);

  const opts = dash?.filterOptions ?? EMPTY_OPTS;
  const monedaLocal = useMemo(() => (filters.pais.length === 1 ? { pais: filters.pais[0], moneda: MONEDA_POR_PAIS[filters.pais[0].toUpperCase()] ?? '—' } : null), [filters.pais]);
  const sort = (arr: ControlNode[], m: Metric, dir: 'asc' | 'desc') => [...arr].sort((a, b) => (dir === 'desc' ? (b[m] as number) - (a[m] as number) : (a[m] as number) - (b[m] as number)));
  const gS = useMemo(() => sort(gestores, gMetric, gDir), [gestores, gMetric, gDir]);
  const zS = useMemo(() => sort(zonas, zMetric, zDir), [zonas, zMetric, zDir]);
  const pS = useMemo(() => sort(pdCamp, pMetric, pDir), [pdCamp, pMetric, pDir]);

  const optsTabla = useMemo(() => { const u = (k: string) => [...new Set(cuentas.map((r) => str(r[k])).filter(Boolean))].sort(); return { pd: u('pd_actual'), zona: u('zona'), campania: u('campania_adeuda') }; }, [cuentas]);
  const filtradas = useMemo(() => cuentas.filter((r) => (!fPd || str(r.pd_actual) === fPd) && (!fZona || str(r.zona) === fZona) && (!fCamp || str(r.campania_adeuda) === fCamp)), [cuentas, fPd, fZona, fCamp]);
  const paged = filtradas.slice(page * rpp, page * rpp + rpp);
  // Cartas pendientes "visibles": intersección entre TODAS las pendientes del
  // alcance (pend.cartas, ya acotadas por backend) y las cuentas que pasan
  // los filtros ACTUALES (país/gestor/gerente/zona/pd/campaña arriba +
  // PD/Zona/Campaña de esta tabla) — "Seleccionar todas" nunca toca una
  // carta fuera de lo que el usuario está viendo en este momento.
  const codigosFiltrados = useMemo(() => new Set(filtradas.map((r) => str(r.codigo))), [filtradas]);
  const cartasPendientesFiltradas = useMemo(
    () => (pend?.cartas ?? []).filter((cr) => codigosFiltrados.has(str(cr.codigo))),
    [pend, codigosFiltrados]
  );
  useEffect(() => {
    setSeleccionadas((prev) => {
      const visibles = new Set(cartasPendientesFiltradas.map((cr) => str(cr.id)));
      const next = new Set([...prev].filter((id) => visibles.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [cartasPendientesFiltradas]);
  const toggleSeleccion = (id: string) => setSeleccionadas((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const seleccionarTodasVisibles = () => setSeleccionadas(new Set(cartasPendientesFiltradas.map((cr) => str(cr.id))));
  const deseleccionarTodas = () => setSeleccionadas(new Set());
  useEffect(() => { const cs = paged.map((r) => str(r.codigo)).filter(Boolean); if (cs.length) getEstadoCuentas(cs).then((m) => setEstado((p) => ({ ...p, ...m }))).catch(() => undefined); /* eslint-disable-next-line */ }, [page, rpp, filtradas]);

  const toggle = (s2: Set<string>, k: string, set: (x: Set<string>) => void) => { const n = new Set(s2); n.has(k) ? n.delete(k) : n.add(k); set(n); };
  const rowsAgg = (arr: ControlNode[], childKey: 'pds' | 'gestores' | 'campanas', childLabel: keyof ControlNode) => {
    const out: Array<Array<string | number>> = [];
    arr.forEach((x) => { out.push(['G', str(x.gestor ?? x.zona ?? x.pd ?? x.key), '', x.cuentas, x.saldoLocal, x.saldoUsd, x.recuperadoUsd, x.pctRecuperacion]); (x[childKey] as ControlNode[] | undefined ?? []).forEach((ch) => out.push(['S', str(x.gestor ?? x.zona ?? x.pd ?? x.key), str(ch[childLabel]), ch.cuentas, ch.saldoLocal, ch.saldoUsd, ch.recuperadoUsd, ch.pctRecuperacion])); });
    return out;
  };
  // "Saldo USD" SIEMPRE se deriva de saldo_actual (moneda local real) / tasa
  // vigente del país — nunca de la columna saldo_actual_usd (congelada al
  // importar, queda obsoleta cuando cambian las tasas). Ver utils/monedaConversion.ts.
  const usdDeFila = (r: Record<string, unknown>) => usdEquivalente(Number(str(r.saldo_actual)) || 0, str(r.pais), tasas);
  const CUENTAS_COLS = ['codigo', 'pais', 'zona', 'gestor', 'pd_actual', 'campania_adeuda', 'saldo_actual'];
  const CUENTAS_HEAD = ['Cuenta', 'País', 'Zona', 'Gestor', 'PD', 'Campaña', 'Saldo Local', 'Saldo USD'];
  const rowsCuentas = () => filtradas.map((r) => [...CUENTAS_COLS.map((c) => str(r[c])), money(usdDeFila(r))]);

  const abrir = async (row: Record<string, unknown>) => {
    setPanel(row); setPtab(0); setDetalle(null); setInfo(null);
    setG({ tipoContacto: '', canal: '', tip: '', tipCom: '', fechaProm: '', montoProm: '', cartaCom: '', adjTipo: 'Boleta de pago' }); setAdjFile(null);
    setCartaPreview(null);
    const cod = str(row.codigo);
    getDetalleCuenta(cod).then(setDetalle).catch(() => undefined);
    getInfoCuenta(cod).then(setInfo).catch(() => undefined);
    if (canCarta) getCartaPreview(cod).then(setCartaPreview).catch(() => undefined);
  };
  const cod = str(panel?.codigo);
  const accion = async (fn: () => Promise<void>, ok: string) => { setBusy(true); try { await fn(); setToast(ok); setDetalle(await getDetalleCuenta(cod)); } catch (e) { setToast(e instanceof Error ? e.message : 'Error.'); } finally { setBusy(false); } };
  const pick = (row: Record<string, unknown>, keys: string[]): string => { for (const k of keys) { const v = row[k]; if (v !== null && v !== undefined && String(v).trim() !== '') return String(v); } return 'No disponible'; };
  const resolverCarta = async (id: string, aprobar: boolean, comentario: string) => { try { aprobar ? await aprobarCarta(id, comentario) : await rechazarCarta(id, comentario); setToast(aprobar ? 'Carta aprobada.' : 'Carta rechazada.'); setCartaSel(null); setPend(await getPendientes()); } catch (e) { setToast(e instanceof Error ? e.message : 'Error.'); } };
  // Información de cobro y reglas de promesa de la cuenta abierta.
  const cMoneda = MONEDA_POR_PAIS[str(panel?.pais).toUpperCase()] ?? '—';
  const cCobroPD = str(panel?.pd_actual) || 'No disponible';
  const cCobroRiesgo = str(panel?.riesgo || panel?.nivel_riesgo || panel?.riesgo_pd) || (info ? pick(info, ['riesgo', 'nivel_riesgo', 'riesgo_pd']) : 'No disponible');
  const cEsPromesa = g.tip === 'PROMESA DE PAGO';
  const cMontoNum = Number(g.montoProm);
  const cPromValida = !cEsPromesa || (Boolean(g.fechaProm) && Number.isFinite(cMontoNum) && cMontoNum > 0);
  const cRegistrarGestion = () => accion(async () => {
    await tipificarCuenta(cod, { tipificacion: g.tip, comentario: g.tipCom, tipoContacto: g.tipoContacto, canal: g.canal });
    if (cEsPromesa) await crearPromesa(cod, { fechaPromesa: g.fechaProm, monto: cMontoNum });
  }, cEsPromesa ? 'Gestión y promesa registradas.' : 'Gestión registrada.');

  if (loading && !dash) return <Box sx={{ display: 'flex', gap: 1.5, p: 3, alignItems: 'center' }}><CircularProgress size={22} /><Typography sx={{ fontSize: 14 }}>Cargando control operativo...</Typography></Box>;
  if (error) return <Box sx={{ p: 2 }}><Alert severity="error">{error}</Alert></Box>;

  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      {dash && (
        <Stack spacing={2}>
          <DashboardFilters filters={filters} onChange={setFilters} onClear={() => setFilters(EMPTY_FILTERS)} options={opts} />
          {monedaLocal && <Alert severity="info" sx={{ py: 0.5 }}>Moneda local: <strong>{monedaLocal.pais.toUpperCase()} · {monedaLocal.moneda}</strong></Alert>}
          <KpiCards kpis={dash.kpis} />
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <KpiMini l="Total Gestores" v={dash.contadores.gestores} />
            <KpiMini l="Total Gerentes" v={dash.contadores.gerentes} />
            <KpiMini l="Total Zonas" v={dash.contadores.zonas} />
            {monedaLocal && dash.countrySummary?.[0] && <>
              <KpiMini l={`Saldo Actual ${monedaLocal.moneda}`} v={money(dash.topZonasDetalle.reduce((s2, z) => s2 + z.saldoActualLocal, 0))} />
            </>}
          </Stack>

          {/* Indicadores operativos */}
          {ind && (
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              <KpiMini l="Contactabilidad" v={ind.contactabilidad} /><KpiMini l="Gestiones" v={ind.gestiones} />
              <KpiMini l="Llamadas" v={ind.llamadas} /><KpiMini l="SMS" v={ind.sms} /><KpiMini l="WhatsApp" v={ind.whatsapp} /><KpiMini l="Correos" v={ind.correos} />
              <KpiMini l="Promesas" v={ind.promesas} /><KpiMini l="Cumpl. Promesas" v={ind.cumplimientoPromesas} />
              <KpiMini l="Cartas emitidas" v={ind.cartasEmitidas} /><KpiMini l="Cartas aprobadas" v={ind.cartasAprobadas} />
              <KpiMini l="Acuerdos" v={ind.acuerdos} /><KpiMini l="Adjuntos" v={ind.adjuntos} />
            </Stack>
          )}

          {/* Resumen Operativo */}
          {resumenOp && (
            <Paper sx={{ p: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                <Typography sx={{ fontWeight: 700 }}>Resumen Operativo</Typography>
                <TextField
                  select size="small" label="Moneda de los gráficos" value={monedaResumen}
                  onChange={(e) => setMonedaResumen(e.target.value)}
                  sx={{ minWidth: 170, '& .MuiInputBase-input': { fontSize: 12 }, '& .MuiInputLabel-root': { fontSize: 12 } }}
                >
                  {MONEDA_OPTIONS.map((o) => <MenuItem key={o.code} value={o.code} sx={{ fontSize: 12.5 }}>{o.label} ({o.symbol})</MenuItem>)}
                </TextField>
              </Box>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
                <KpiMini l="Cuentas" v={resumenOp.totales.cuentas.toLocaleString('en-US')} />
                <KpiMini l="Gestiones" v={resumenOp.totales.gestiones.toLocaleString('en-US')} />
                <KpiMini l="Sin gestión" v={`${resumenOp.totales.cuentasSinGestion.toLocaleString('en-US')} (${resumenOp.totales.pctSinGestion}%)`} />
                <KpiMini l="Con gestión" v={resumenOp.totales.cuentasConGestion.toLocaleString('en-US')} />
                <KpiMini l="Gestores" v={resumenOp.totales.gestores} />
              </Stack>
              <Stack spacing={2} sx={{ mb: 2 }}>
                <DistribucionCard titulo="DISTRIBUCIÓN POR PAÍS" dimLabel="País" items={resumenOp.distribucion.pais} simbolo={simboloResumen} tasaActual={tasaResumen} chartId="chart-resumen-dist-pais" />
                <DistribucionCard titulo="DISTRIBUCIÓN POR ZONA" dimLabel="Zona" items={resumenOp.distribucion.zona} simbolo={simboloResumen} tasaActual={tasaResumen} chartId="chart-resumen-dist-zona" />
                <DistribucionCard titulo="DISTRIBUCIÓN POR SECTOR" dimLabel="Sector" items={resumenOp.distribucion.sector} simbolo={simboloResumen} tasaActual={tasaResumen} chartId="chart-resumen-dist-sector" />
              </Stack>
              <Grid container spacing={2}>
                {([['PD', resumenOp.distribucion.pd], ['Riesgo', resumenOp.distribucion.riesgo]] as const).map(([lbl, arr]) => (
                  <Grid item xs={12} sm={6} key={lbl}>
                    <Typography sx={{ fontSize: 12, fontWeight: 700, mb: 0.5 }}>Distribución por {lbl}</Typography>
                    <Stack spacing={0.25} sx={{ maxHeight: 160, overflowY: 'auto' }}>
                      {arr.length === 0 ? <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Sin datos.</Typography> : arr.slice(0, 15).map((x) => (
                        <Box key={x.clave} sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{x.clave}</span>
                          <span>{x.cuentas} · {money(x.saldoUsd)}</span>
                        </Box>
                      ))}
                    </Stack>
                  </Grid>
                ))}
              </Grid>
              <Grid container spacing={2} sx={{ mt: 0.5 }}>
                {([['Gestores · más gestiones', resumenOp.gestoresMasGestiones], ['Gestores · menos gestiones', resumenOp.gestoresMenosGestiones]] as const).map(([lbl, arr]) => (
                  <Grid item xs={12} md={6} key={lbl}>
                    <Typography sx={{ fontSize: 12, fontWeight: 700, mb: 0.5 }}>{lbl}</Typography>
                    <TableContainer sx={{ maxHeight: 200 }}>
                      <Table size="small" stickyHeader>
                        <TableHead><TableRow>{['Gestor', 'Gestiones', 'Cuentas', 'Prod.'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
                        <TableBody>
                          {arr.length === 0 ? <TableRow><TableCell colSpan={4} align="center" sx={{ py: 1, color: 'text.secondary' }}>Sin datos.</TableCell></TableRow> : arr.map((g) => (
                            <TableRow key={g.gestor} hover><TableCell>{g.gestor}</TableCell><TableCell align="right">{g.gestiones}</TableCell><TableCell align="right">{g.cuentas}</TableCell><TableCell align="right">{g.productividad}</TableCell></TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Grid>
                ))}
                <Grid item xs={12} md={6}>
                  <Typography sx={{ fontSize: 12, fontWeight: 700, mb: 0.5 }}>Cuentas con más gestiones</Typography>
                  <TableContainer sx={{ maxHeight: 200 }}>
                    <Table size="small" stickyHeader>
                      <TableHead><TableRow>{['Cuenta', 'Gestor', 'Gestiones'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
                      <TableBody>
                        {resumenOp.cuentasMasGestionadas.length === 0 ? <TableRow><TableCell colSpan={3} align="center" sx={{ py: 1, color: 'text.secondary' }}>Sin datos.</TableCell></TableRow> : resumenOp.cuentasMasGestionadas.map((cta) => (
                          <TableRow key={cta.codigo} hover><TableCell>{cta.codigo}</TableCell><TableCell>{cta.gestor}</TableCell><TableCell align="right">{cta.gestiones}</TableCell></TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography sx={{ fontSize: 12, fontWeight: 700, mb: 0.5 }}>Calendario del mes</Typography>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary', mt: 0.5 }}>Países con más asuetos</Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                    {resumenOp.paisesMasAsuetos.length === 0 ? <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Sin asuetos registrados.</Typography> : resumenOp.paisesMasAsuetos.map((p) => <Chip key={p.clave} size="small" label={`${p.clave}: ${p.total}`} />)}
                  </Stack>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary' }}>Gestores con más incapacidades</Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {resumenOp.gestoresMasIncapacidades.length === 0 ? <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Sin incapacidades registradas.</Typography> : resumenOp.gestoresMasIncapacidades.map((g) => <Chip key={g.clave} size="small" color="warning" variant="outlined" label={`${g.clave}: ${g.total}`} />)}
                  </Stack>
                </Grid>
              </Grid>
            </Paper>
          )}

          <Grid container spacing={2}>
            {/* Gestores */}
            <Grid item xs={12} md={6}>
              <VisualCard title="Operativa por gestor" onDir={setGDir} onMetric={setGMetric}
                csv={() => exportRowsToCsv('control_gestores.csv', HEAD_H, rowsAgg(gS, 'pds', 'pd'))} excel={() => exportRowsToExcel('control_gestores.xlsx', 'Gestores', HEAD_H, rowsAgg(gS, 'pds', 'pd'))}
                png={() => exportBarsPng('Gestores', gS.map((x) => ({ label: str(x.gestor), value: x[gMetric] as number })))}>
                <Stack spacing={0.75}>{gS.map((x) => {
                  const mx = Math.max(1, ...gS.map((y) => y[gMetric] as number));
                  return (<Box key={x.key}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }} onClick={() => toggle(expG, x.key, setExpG)}>
                      <IconButton size="small">{expG.has(x.key) ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}</IconButton>
                      <Box sx={{ width: 130, fontSize: 12, fontWeight: 600 }}>{x.gestor}</Box><Bar value={x[gMetric] as number} max={mx} /><Box sx={{ width: 150, textAlign: 'right', fontSize: 11 }}>{x.cuentas} · {money(x.saldoUsd)} · {x.pctRecuperacion}%</Box>
                    </Box>
                    <Collapse in={expG.has(x.key)} unmountOnExit><Stack spacing={0.5} sx={{ pl: 6, py: 0.5 }}>{(x.pds ?? []).map((p) => (
                      <Box key={p.key} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}><Box sx={{ width: 90, fontSize: 11 }}>{p.pd}</Box><Bar value={p.saldoUsd} max={Math.max(1, ...(x.pds ?? []).map((y) => y.saldoUsd))} color="#0EA5E9" /><Box sx={{ width: 150, textAlign: 'right', fontSize: 11 }}>{p.cuentas} · {money(p.saldoUsd)}</Box></Box>
                    ))}</Stack></Collapse>
                  </Box>);
                })}</Stack>
              </VisualCard>
            </Grid>
            {/* Zonas */}
            <Grid item xs={12} md={6}>
              <VisualCard title="Operativa por zona" onDir={setZDir} onMetric={setZMetric}
                csv={() => exportRowsToCsv('control_zonas.csv', HEAD_H, rowsAgg(zS, 'gestores', 'gestor'))} excel={() => exportRowsToExcel('control_zonas.xlsx', 'Zonas', HEAD_H, rowsAgg(zS, 'gestores', 'gestor'))}
                png={() => exportBarsPng('Zonas', zS.map((x) => ({ label: str(x.zona), value: x[zMetric] as number })))}>
                <Stack spacing={0.75}>{zS.map((x) => {
                  const mx = Math.max(1, ...zS.map((y) => y[zMetric] as number));
                  return (<Box key={x.key}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }} onClick={() => toggle(expZ, x.key, setExpZ)}>
                      <IconButton size="small">{expZ.has(x.key) ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}</IconButton>
                      <Box sx={{ width: 130, fontSize: 12, fontWeight: 600 }}>{x.zona} <Typography component="span" sx={{ fontSize: 10, color: 'text.secondary' }}>({siglaPais(str(x.pais))})</Typography></Box><Bar value={x[zMetric] as number} max={mx} /><Box sx={{ width: 150, textAlign: 'right', fontSize: 11 }}>{x.cuentas} · {money(x.saldoLocal)} L · {x.pctRecuperacion}%</Box>
                    </Box>
                    <Collapse in={expZ.has(x.key)} unmountOnExit><Stack spacing={0.5} sx={{ pl: 6, py: 0.5 }}>{(x.gestores ?? []).map((ge) => (
                      <Box key={ge.key} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}><Box sx={{ width: 130, fontSize: 11 }}>{ge.gestor}</Box><Bar value={ge.saldoUsd} max={Math.max(1, ...(x.gestores ?? []).map((y) => y.saldoUsd))} color="#22C55E" /><Box sx={{ width: 150, textAlign: 'right', fontSize: 11 }}>{ge.cuentas} · {money(ge.saldoUsd)}</Box></Box>
                    ))}</Stack></Collapse>
                  </Box>);
                })}</Stack>
              </VisualCard>
            </Grid>
            {/* PD */}
            <Grid item xs={12}>
              <VisualCard title="PD por campañas" onDir={setPDir} onMetric={setPMetric}
                csv={() => exportRowsToCsv('control_pd.csv', HEAD_H, rowsAgg(pS, 'campanas', 'campania'))} excel={() => exportRowsToExcel('control_pd.xlsx', 'PD', HEAD_H, rowsAgg(pS, 'campanas', 'campania'))}
                png={() => exportBarsPng('PD', pS.map((x) => ({ label: str(x.pd), value: x[pMetric] as number })))}>
                <Stack spacing={0.75}>{pS.map((x) => {
                  const mx = Math.max(1, ...pS.map((y) => y[pMetric] as number));
                  return (<Box key={x.key}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }} onClick={() => toggle(expP, x.key, setExpP)}>
                      <IconButton size="small">{expP.has(x.key) ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}</IconButton>
                      <Box sx={{ width: 90, fontSize: 12, fontWeight: 700 }}>{x.pd}</Box><Bar value={x[pMetric] as number} max={mx} color="#7C3AED" /><Box sx={{ width: 160, textAlign: 'right', fontSize: 11 }}>{x.cuentas} · {money(x.saldoUsd)} · {x.pctRecuperacion}%</Box>
                    </Box>
                    <Collapse in={expP.has(x.key)} unmountOnExit><Stack spacing={0.5} sx={{ pl: 6, py: 0.5 }}>{(x.campanas ?? []).map((cm) => (
                      <Box key={cm.key} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}><Box sx={{ width: 140, fontSize: 11 }}>{cm.campania}</Box><Bar value={cm.saldoUsd} max={Math.max(1, ...(x.campanas ?? []).map((y) => y.saldoUsd))} color="#0EA5E9" /><Box sx={{ width: 150, textAlign: 'right', fontSize: 11 }}>{cm.cuentas} · {money(cm.saldoUsd)}</Box></Box>
                    ))}</Stack></Collapse>
                  </Box>);
                })}</Stack>
              </VisualCard>
            </Grid>
          </Grid>

          {/* "Mi firma de autorización": SOLO visible/accesible para quien puede
              aprobar cartas (gestion.carta.aprobar) — es la firma que el
              sistema usará AUTOMÁTICAMENTE al autorizar, nunca elegida a mano
              por carta ni por plantilla. */}
          {canAprobar && (
            <Paper sx={{ p: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
              <Typography sx={{ fontWeight: 700, mb: 1 }}>Firma de autorización</Typography>
              <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
                <Box sx={{ minWidth: 160 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase' }}>Supervisor</Typography>
                  <Typography sx={{ fontSize: 13 }}>{nombreAutorizador || '—'}</Typography>
                </Box>
                <Box sx={{ minWidth: 140 }}>
                  {miFirma?.url ? (
                    <Box component="img" src={miFirma.url} alt="Mi firma" sx={{ height: 48, border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 0.5, bgcolor: '#fff' }} />
                  ) : (
                    <Typography sx={{ fontSize: 13, color: 'text.secondary', fontStyle: 'italic' }}>Sin firma configurada</Typography>
                  )}
                </Box>
                <Button variant="outlined" size="small" component="label" disabled={miFirmaSubiendo} sx={{ textTransform: 'none' }}>
                  {miFirmaSubiendo ? 'Subiendo...' : (miFirma?.configurada ? 'Reemplazar firma' : 'Agregar firma')}
                  <input hidden type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; void subirMiFirma(f); }} />
                </Button>
                {miFirma && (
                  <Chip size="small" label={miFirma.configurada ? 'Firma configurada' : 'Sin firma configurada'} color={miFirma.configurada ? 'success' : 'default'} variant={miFirma.configurada ? 'filled' : 'outlined'} />
                )}
              </Stack>
              {miFirma && !miFirma.configurada && (
                <Alert severity="warning" sx={{ mt: 1.5, py: 0.5 }}>
                  No tienes una firma de autorización configurada. Configúrala antes de autorizar cartas — mientras tanto no podrás aprobar ninguna.
                </Alert>
              )}
            </Paper>
          )}

          {/* Panel supervisor: pendientes */}
          {pend && (
            <Paper sx={{ p: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
              <Typography sx={{ fontWeight: 700, mb: 1 }}>Pendientes (supervisor)</Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Typography sx={{ fontSize: 13, fontWeight: 600 }}>Promesas pendientes ({pend.promesas.length})</Typography>
                  <Stack sx={{ maxHeight: 180, overflowY: 'auto' }}>{pend.promesas.slice(0, 30).map((p, i) => <Typography key={i} sx={{ fontSize: 12 }}>{str(p.codigo)} · {str(p.fecha_promesa)} · {str(p.monto) || '—'}</Typography>)}</Stack>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 0.5 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
                      Cartas / acuerdos pendientes ({cartasPendientesFiltradas.length}{cartasPendientesFiltradas.length !== pend.cartas.length ? ` de ${pend.cartas.length}, según filtros` : ''})
                    </Typography>
                    {canAprobar && cartasPendientesFiltradas.length > 0 && (
                      <Stack direction="row" spacing={0.5}>
                        <Button size="small" onClick={seleccionarTodasVisibles} sx={{ textTransform: 'none', minWidth: 0 }}>Seleccionar todas</Button>
                        <Button size="small" onClick={deseleccionarTodas} disabled={seleccionadas.size === 0} sx={{ textTransform: 'none', minWidth: 0 }}>Deseleccionar</Button>
                      </Stack>
                    )}
                  </Box>
                  <Stack sx={{ maxHeight: 180, overflowY: 'auto' }}>{cartasPendientesFiltradas.slice(0, 50).map((cr) => (
                    <Box key={str(cr.id)} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {canAprobar && <Checkbox size="small" checked={seleccionadas.has(str(cr.id))} onChange={() => toggleSeleccion(str(cr.id))} sx={{ p: 0.5 }} />}
                      <Typography sx={{ fontSize: 12, flex: 1 }}>{str(cr.codigo)} · {str(cr.pd)}</Typography>
                      {canAprobar && <Button size="small" onClick={() => { setCartaSel(cr); setCartaComent(''); }} sx={{ textTransform: 'none', minWidth: 0 }}>Revisar</Button>}
                    </Box>
                  ))}</Stack>
                  {canAprobar && (
                    <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{seleccionadas.size} carta{seleccionadas.size === 1 ? '' : 's'} seleccionada{seleccionadas.size === 1 ? '' : 's'}</Typography>
                      <Button size="small" variant="contained" disabled={seleccionadas.size === 0} onClick={() => setAutorizarOpen(true)} sx={{ textTransform: 'none' }}>
                        Autorizar seleccionada{seleccionadas.size === 1 ? '' : 's'}
                      </Button>
                    </Box>
                  )}
                </Grid>
              </Grid>
            </Paper>
          )}

          {/* Calidad de Gestión */}
          {canCalidadVer && (
            <Paper sx={{ p: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Typography sx={{ fontWeight: 700 }}>Calidad de Gestión</Typography>
                  <Chip color="primary" label={`Nota global ${calResumen?.notaGlobal ?? 0}`} />
                  <Chip variant="outlined" label={`${calResumen?.evaluaciones ?? 0} evaluaciones`} />
                </Box>
                {canCalidadEdit && <Button variant="contained" onClick={() => setCalOpen(true)} sx={{ textTransform: 'none' }}>Nueva evaluación</Button>}
              </Box>
              <Grid container spacing={2}>
                {([['Por gestor', calResumen?.porGestor], ['Por país', calResumen?.porPais], ['Por zona', calResumen?.porZona]] as const).map(([lbl, arr]) => (
                  <Grid item xs={12} md={4} key={lbl}>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 0.5 }}>{lbl}</Typography>
                    <Stack spacing={0.25} sx={{ maxHeight: 140, overflowY: 'auto' }}>
                      {(arr ?? []).slice(0, 20).map((x) => (
                        <Box key={x.clave} sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                          <span>{x.clave}</span><span><strong>{x.nota}</strong> ({x.evaluaciones})</span>
                        </Box>
                      ))}
                      {(!arr || arr.length === 0) && <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Sin datos suficientes</Typography>}
                    </Stack>
                  </Grid>
                ))}
              </Grid>
              {(calResumen?.penalizaciones?.length ?? 0) > 0 && (
                <Box sx={{ mt: 1.5 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 0.5 }}>Principales penalizaciones</Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {calResumen!.penalizaciones.map((p) => <Chip key={p.clave} size="small" color="error" variant="outlined" label={`${p.clave}: ${p.total}`} />)}
                  </Stack>
                </Box>
              )}
              {calEvals.length > 0 && (
                <TableContainer sx={{ maxHeight: 220, mt: 1.5 }}>
                  <Table stickyHeader size="small">
                    <TableHead><TableRow>{['Gestor', 'País', 'Zona', 'Cuenta', 'Tipificación', 'Nota', 'Fecha'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</TableCell>)}</TableRow></TableHead>
                    <TableBody>
                      {calEvals.slice(0, 100).map((e) => (
                        <TableRow key={e.id} hover>
                          <TableCell>{e.gestor_nombre}</TableCell><TableCell>{e.pais ?? '—'}</TableCell><TableCell>{e.zona ?? '—'}</TableCell>
                          <TableCell>{e.cuenta ?? '—'}</TableCell><TableCell sx={{ fontSize: 12 }}>{e.tipificacion ?? '—'}</TableCell>
                          <TableCell><Chip size="small" color={e.nota >= 80 ? 'success' : e.nota >= 60 ? 'warning' : 'error'} label={e.nota} /></TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 12 }}>{e.created_at.slice(0, 16).replace('T', ' ')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Paper>
          )}

          {/* Tabla operativa */}
          <Paper sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
            <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography sx={{ fontWeight: 700, mr: 1 }}>Cuentas ({filtradas.length.toLocaleString('en-US')})</Typography>
                <TextField select size="small" label="PD" value={fPd} onChange={(e) => { setFPd(e.target.value); setPage(0); }} sx={{ minWidth: 100 }}><MenuItem value="">Todos</MenuItem>{optsTabla.pd.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField>
                <TextField select size="small" label="Zona" value={fZona} onChange={(e) => { setFZona(e.target.value); setPage(0); }} sx={{ minWidth: 120 }}><MenuItem value="">Todas</MenuItem>{optsTabla.zona.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField>
                <TextField select size="small" label="Campaña" value={fCamp} onChange={(e) => { setFCamp(e.target.value); setPage(0); }} sx={{ minWidth: 120 }}><MenuItem value="">Todas</MenuItem>{optsTabla.campania.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField>
                <Button size="small" onClick={() => { setFPd(''); setFZona(''); setFCamp(''); setPage(0); }} sx={{ textTransform: 'none' }}>Limpiar filtros</Button>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Button size="small" startIcon={<FileDownloadOutlinedIcon />} onClick={() => exportRowsToCsv('control_cuentas.csv', CUENTAS_HEAD, rowsCuentas())} sx={{ textTransform: 'none' }}>CSV</Button>
                <Button size="small" startIcon={<FileDownloadOutlinedIcon />} onClick={() => exportRowsToExcel('control_cuentas.xlsx', 'Cuentas', CUENTAS_HEAD, rowsCuentas())} sx={{ textTransform: 'none' }}>Excel</Button>
              </Box>
            </Box>
            <TableContainer sx={{ maxHeight: '60vh' }}>
              <Table stickyHeader size="small">
                <TableHead><TableRow>{['Acciones', 'Cuenta', 'País', 'Zona', 'Gestor', 'PD', 'Campaña', 'Saldo Local', 'Saldo USD', 'Últ. gestión', 'Promesa'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</TableCell>)}</TableRow></TableHead>
                <TableBody>
                  {paged.map((r, i) => { const e = estado[str(r.codigo)]; return (
                    <TableRow key={str(r.codigo) || i} hover>
                      <TableCell><Button size="small" variant="outlined" onClick={() => abrir(r)} sx={{ textTransform: 'none', minWidth: 0 }}>Acciones</Button></TableCell>
                      <TableCell>{str(r.codigo)}</TableCell>
                      <TableCell><Chip size="small" label={siglaPais(str(r.pais))} /></TableCell><TableCell>{str(r.zona)}</TableCell><TableCell>{str(r.gestor)}</TableCell>
                      <TableCell><Chip size="small" label={str(r.pd_actual)} /></TableCell><TableCell>{str(r.campania_adeuda)}</TableCell>
                      <TableCell align="right">{money(Number(str(r.saldo_actual)))}</TableCell><TableCell align="right">{money(usdDeFila(r))}</TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{e?.ultimaTipificacion ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{e?.promesaVigente ? <Chip size="small" color="info" variant="outlined" label={e.promesaVigente} /> : '—'}</TableCell>
                    </TableRow>
                  ); })}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination component="div" count={filtradas.length} page={page} onPageChange={(_e, p) => setPage(p)} rowsPerPage={rpp} onRowsPerPageChange={(e) => { setRpp(parseInt(e.target.value, 10)); setPage(0); }} rowsPerPageOptions={[25, 50, 100]} labelRowsPerPage="Filas" />
          </Paper>
        </Stack>
      )}

      {/* Panel acciones (reutiliza gestión) */}
      <Dialog open={Boolean(panel)} onClose={() => setPanel(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Cuenta {cod} · {str(panel?.nombre)}</DialogTitle>
        <DialogContent dividers>
          <Tabs value={ptab} onChange={(_e, v) => setPtab(v)} sx={{ mb: 2 }}>
            <Tab label="Información" sx={{ textTransform: 'none' }} /><Tab label="Detalle" sx={{ textTransform: 'none' }} /><Tab label="Gestionar" sx={{ textTransform: 'none' }} />
          </Tabs>
          {ptab === 0 && (!info ? <CircularProgress size={22} /> : (
            <Stack spacing={1.5}>
              <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary', mb: 0.5 }}>Información de Cobro</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={`PD: ${cCobroPD}`} />
                  <Chip size="small" color="warning" variant="outlined" label={`Riesgo: ${cCobroRiesgo}`} />
                  <Chip size="small" variant="outlined" label={`Moneda: ${cMoneda}`} />
                </Stack>
              </Paper>
              <Grid container spacing={1.5}>
                {[['Sector', ['sector']], ['Departamento', ['departamento']], ['Municipio', ['municipio']], ['Teléfono', ['telefono_celular', 'celular', 'telefono']], ['Gestor', ['gestor']], ['Gerente de zona', ['gerente_zona']]].map(([l, ks]) => (
                  <Grid item xs={6} key={l as string}><Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase' }}>{l as string}</Typography><Typography sx={{ fontSize: 13 }}>{pick(info, ks as string[])}</Typography></Grid>
                ))}
              </Grid>
            </Stack>
          ))}
          {ptab === 1 && (!detalle ? <CircularProgress size={22} /> : (
            <TableContainer sx={{ maxHeight: 360 }}><Table stickyHeader size="small">
              <TableHead><TableRow>{['Tipificación', 'Fecha', 'Tipo contacto', 'Canal', 'Obs.'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>{detalle.historial.length === 0 ? <TableRow><TableCell colSpan={5} align="center" sx={{ py: 2, color: 'text.secondary' }}>Sin gestiones.</TableCell></TableRow> : detalle.historial.map((h, i) => (
                <TableRow key={i}><TableCell>{str(h.tipificacion)}</TableCell><TableCell sx={{ whiteSpace: 'nowrap' }}>{str(h.created_at).slice(0, 16).replace('T', ' ')}</TableCell><TableCell sx={{ fontSize: 12 }}>{str(h.tipo_contacto) || 'No disponible'}</TableCell><TableCell sx={{ fontSize: 12 }}>{str(h.canal) || 'No disponible'}</TableCell><TableCell sx={{ fontSize: 12 }}>{str(h.comentario) || '—'}</TableCell></TableRow>
              ))}</TableBody>
            </Table></TableContainer>
          ))}
          {ptab === 2 && (
            <Stack spacing={2}>
              <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary', mb: 0.5 }}>Información de Cobro</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={`PD: ${cCobroPD}`} />
                  <Chip size="small" color="warning" variant="outlined" label={`Riesgo: ${cCobroRiesgo}`} />
                  <Chip size="small" variant="outlined" label={`Moneda: ${cMoneda}`} />
                </Stack>
              </Paper>
              <Stack direction="row" spacing={2}>
                <TextField select label="Tipo de contacto" value={g.tipoContacto} onChange={(e) => setG({ ...g, tipoContacto: e.target.value })} size="small" fullWidth>{cCatTC.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}</TextField>
                <TextField select label="Canal" value={g.canal} onChange={(e) => setG({ ...g, canal: e.target.value })} size="small" fullWidth>{cCatCanal.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}</TextField>
              </Stack>
              <TextField select label="Tipificación *" value={g.tip} onChange={(e) => setG({ ...g, tip: e.target.value })} size="small" fullWidth>{cCatTip.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}</TextField>
              <TextField label="Comentario" value={g.tipCom} onChange={(e) => setG({ ...g, tipCom: e.target.value })} size="small" fullWidth multiline minRows={2} />
              {cEsPromesa && (
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 1 }}>Promesa de pago (obligatoria)</Typography>
                  <Stack direction="row" spacing={2}>
                    <TextField label="Fecha de promesa" type="date" required value={g.fechaProm} onChange={(e) => setG({ ...g, fechaProm: e.target.value })} size="small" fullWidth InputLabelProps={{ shrink: true }} error={!g.fechaProm} />
                    <TextField label={`Monto (${cMoneda})`} type="number" required value={g.montoProm} onChange={(e) => setG({ ...g, montoProm: e.target.value })} size="small" fullWidth
                      error={Boolean(g.montoProm) && !(cMontoNum > 0)}
                      helperText={Boolean(g.montoProm) && !(cMontoNum > 0) ? 'El monto debe ser mayor que 0.' : `Moneda local: ${cMoneda}`}
                      InputProps={{ inputProps: { min: 0, step: '0.01' } }} />
                  </Stack>
                </Paper>
              )}
              <Button variant="contained" disabled={!canGestionar || busy || !g.tip || !cPromValida} onClick={cRegistrarGestion} sx={{ textTransform: 'none' }}>Registrar gestión{cEsPromesa ? ' + promesa' : ''}</Button>
              <Divider />
              {/* La plantilla disponible depende EXCLUSIVAMENTE del PD actual de la
                  cuenta (ver getCartaPreview) — no se elige manualmente; PD0 no tiene
                  carta disponible. */}
              {cartaPreview?.disponible ? (
                <Button variant="outlined" disabled={!canCarta || busy} onClick={() => setCartaPrevOpen(true)} sx={{ textTransform: 'none' }}>
                  Generar carta ({cartaPreview.pd}) — vista previa
                </Button>
              ) : (
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                  {cartaPreview === null ? 'Cargando…' : `Sin plantilla de carta para ${cartaPreview.pd ?? 'este PD'}.`}
                </Typography>
              )}
              <Divider />
              <TextField select label="Tipo de documento" value={g.adjTipo} onChange={(e) => setG({ ...g, adjTipo: e.target.value })} size="small" fullWidth>{['Carta recibida por la representante', 'Boleta de pago', 'Acuerdo de pago', 'Otro documento'].map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}</TextField>
              <Button variant="outlined" component="label" sx={{ textTransform: 'none' }}>{adjFile ? adjFile.name : 'Seleccionar archivo'}<input hidden type="file" onChange={(e) => setAdjFile(e.target.files?.[0] ?? null)} /></Button>
              <Button variant="outlined" disabled={busy || !adjFile} onClick={() => adjFile && accion(() => subirAdjunto(cod, g.adjTipo, adjFile), 'Adjunto subido.')} sx={{ textTransform: 'none' }}>Subir adjunto</Button>
            </Stack>
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setPanel(null)} sx={{ textTransform: 'none' }}>Cerrar</Button></DialogActions>
      </Dialog>

      {/* Vista previa de carta antes de enviar a aprobación: SIEMPRE sin logo/
          firma (nada está autorizado todavía — ver CartaRenderer/estado). */}
      <Dialog open={cartaPrevOpen} onClose={() => setCartaPrevOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Vista previa · {cartaPreview?.pd}</DialogTitle>
        <DialogContent dividers>
          {cartaPreview?.contenido && <CartaRenderer contenido={cartaPreview.contenido} logoUrl={null} firmaUrl={null} />}
          <TextField label="Comentario (opcional)" value={g.cartaCom} onChange={(e) => setG({ ...g, cartaCom: e.target.value })} size="small" fullWidth multiline minRows={2} sx={{ mt: 2 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCartaPrevOpen(false)} sx={{ textTransform: 'none' }}>Cancelar</Button>
          <Button variant="contained" disabled={busy} onClick={() => { setCartaPrevOpen(false); void accion(() => crearCarta(cod, g.cartaCom), 'Carta enviada a aprobación.'); }} sx={{ textTransform: 'none' }}>Confirmar y enviar</Button>
        </DialogActions>
      </Dialog>

      {/* Revisar carta (Supervisor): contenido ya incluido en la fila de
          pendientes. Logo: aún pendiente de autorización (comportamiento por
          defecto de CartaRenderer, sin cambios). Firma: la que SE USARÁ al
          autorizar es la firma predeterminada del usuario autenticado
          (miFirma) — no la de la carta (que todavía no tiene ninguna). Si no
          hay firma configurada, Aprobar queda bloqueado (y el backend lo
          rechazaría igual aunque se forzara el botón). */}
      <Dialog open={Boolean(cartaSel)} onClose={() => setCartaSel(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Revisar carta · {str(cartaSel?.pd)}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography sx={{ fontSize: 13 }}>Cuenta {str(cartaSel?.codigo)}</Typography>
            <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary' }}>Autorizará</Typography>
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 0.5 }}>
                <Typography sx={{ fontSize: 13 }}>{nombreAutorizador}</Typography>
                {miFirma?.url && <Box component="img" src={miFirma.url} alt="Mi firma" sx={{ height: 32 }} />}
              </Stack>
            </Paper>
            {miFirma && !miFirma.configurada && (
              <Alert severity="warning" sx={{ py: 0.5 }}>
                No tienes una firma de autorización configurada. Configura tu firma predeterminada antes de autorizar cartas.
              </Alert>
            )}
            {cartaSel?.contenido != null && (
              <CartaRenderer
                contenido={str(cartaSel.contenido)}
                logoUrl={null}
                firmaUrl={miFirma?.url ?? null}
                firmaPendienteTexto="Firma pendiente de configurar"
              />
            )}
            <TextField label="Comentario" value={cartaComent} onChange={(e) => setCartaComent(e.target.value)} size="small" fullWidth multiline minRows={2} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCartaSel(null)} sx={{ textTransform: 'none' }}>Cerrar</Button>
          <Button color="error" onClick={() => cartaSel && resolverCarta(str(cartaSel.id), false, cartaComent)} sx={{ textTransform: 'none' }}>Rechazar</Button>
          <Button variant="contained" disabled={!miFirma?.configurada} onClick={() => cartaSel && resolverCarta(str(cartaSel.id), true, cartaComent)} sx={{ textTransform: 'none' }}>Aprobar</Button>
        </DialogActions>
      </Dialog>

      {/* Autorizar en lote: la firma SIEMPRE es la predeterminada del
          usuario autenticado — nunca un selector. Bloqueado si no hay firma
          configurada. El resultado informa cuáles no pudieron autorizarse
          (ya resueltas, fuera de alcance, condición de carrera). */}
      <Dialog open={autorizarOpen} onClose={() => (!autorizarBusy && setAutorizarOpen(false))} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Autorizar cartas</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            <Typography sx={{ fontSize: 13 }}>Cartas seleccionadas: <strong>{seleccionadas.size}</strong></Typography>
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary' }}>Supervisor autorizador</Typography>
              <Typography sx={{ fontSize: 13 }}>{nombreAutorizador}</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary' }}>Firma</Typography>
              {miFirma?.url ? (
                <Box component="img" src={miFirma.url} alt="Mi firma" sx={{ height: 44, mt: 0.5 }} />
              ) : (
                <Typography sx={{ fontSize: 13, color: 'text.secondary', fontStyle: 'italic' }}>Sin firma configurada</Typography>
              )}
            </Box>
            {miFirma?.configurada ? (
              <Alert severity="info" sx={{ py: 0.5 }}>Esta firma se aplicará a todas las cartas seleccionadas.</Alert>
            ) : (
              <Alert severity="warning" sx={{ py: 0.5 }}>
                No tienes una firma de autorización configurada. Configura tu firma predeterminada antes de autorizar cartas.
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAutorizarOpen(false)} disabled={autorizarBusy} sx={{ textTransform: 'none' }}>Cancelar</Button>
          <Button
            variant="contained"
            disabled={autorizarBusy || !miFirma?.configurada || seleccionadas.size === 0}
            onClick={async () => {
              setAutorizarBusy(true);
              try {
                const r = await autorizarCartasMasivo(Array.from(seleccionadas));
                const msg = r.omitidas.length > 0
                  ? `${r.autorizadas.length} carta(s) autorizada(s). ${r.omitidas.length} no se pudieron autorizar (ya resueltas o fuera de alcance).`
                  : `${r.autorizadas.length} carta(s) autorizada(s).`;
                setToast(msg);
                setSeleccionadas(new Set());
                setAutorizarOpen(false);
                setPend(await getPendientes());
              } catch (e) { setToast(e instanceof Error ? e.message : 'No se pudieron autorizar las cartas.'); }
              finally { setAutorizarBusy(false); }
            }}
            sx={{ textTransform: 'none' }}
          >
            {autorizarBusy ? 'Autorizando...' : `Autorizar ${seleccionadas.size} carta${seleccionadas.size === 1 ? '' : 's'}`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Diálogo nueva evaluación de calidad */}
      <Dialog open={calOpen} onClose={() => setCalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Nueva evaluación de calidad</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <TextField select label="Gestor evaluado" value={calForm.gestorNombre}
              onChange={(e) => { const gsel = calGestores.find((x) => x.nombre === e.target.value); setCalForm((f) => ({ ...f, gestorNombre: e.target.value, gestorId: gsel?.usuarioId ?? '' })); }}
              size="small" fullWidth>
              {calGestores.length === 0 ? <MenuItem value="" disabled>Sin gestores en tu alcance</MenuItem> : calGestores.map((x) => <MenuItem key={x.nombre} value={x.nombre}>{x.nombre}</MenuItem>)}
            </TextField>
            <Stack direction="row" spacing={2}>
              <TextField label="País" value={calForm.pais} onChange={(e) => setCalForm((f) => ({ ...f, pais: e.target.value }))} size="small" fullWidth />
              <TextField label="Zona" value={calForm.zona} onChange={(e) => setCalForm((f) => ({ ...f, zona: e.target.value }))} size="small" fullWidth />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField label="Cuenta" value={calForm.cuenta} onChange={(e) => setCalForm((f) => ({ ...f, cuenta: e.target.value }))} size="small" fullWidth />
              <TextField select label="Tipificación" value={calForm.tipificacion} onChange={(e) => setCalForm((f) => ({ ...f, tipificacion: e.target.value }))} size="small" fullWidth>{TIPIFICACIONES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}</TextField>
            </Stack>
            {CALIDAD_RUBRICA.map((sec) => (
              <Box key={sec.seccion}>
                <Typography sx={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary', mb: 0.5 }}>{sec.seccion}</Typography>
                <Stack>
                  {sec.items.map((it) => (
                    <FormControlLabel key={it} control={<Checkbox size="small" checked={calForm.criterios[it] === 1}
                      onChange={(e) => setCalForm((f) => ({ ...f, criterios: { ...f.criterios, [it]: e.target.checked ? 1 : 0 } }))} />}
                      label={<Typography sx={{ fontSize: 13 }}>{it}</Typography>} />
                  ))}
                </Stack>
              </Box>
            ))}
            <Box>
              <Typography sx={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'error.main', mb: 0.5 }}>Penalizaciones</Typography>
              <Stack>
                {CALIDAD_PENALIZACIONES.map((p) => (
                  <FormControlLabel key={p.clave} control={<Checkbox size="small" color="error" checked={(calForm.penalizaciones[p.clave] ?? 0) > 0}
                    onChange={(e) => setCalForm((f) => ({ ...f, penalizaciones: { ...f.penalizaciones, [p.clave]: e.target.checked ? p.puntos : 0 } }))} />}
                    label={<Typography sx={{ fontSize: 13 }}>{p.clave} <Typography component="span" sx={{ color: 'text.secondary', fontSize: 12 }}>(−{p.puntos})</Typography></Typography>} />
                ))}
              </Stack>
            </Box>
            <TextField label="Observaciones" value={calForm.observaciones} onChange={(e) => setCalForm((f) => ({ ...f, observaciones: e.target.value }))} size="small" fullWidth multiline minRows={2} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCalOpen(false)} sx={{ textTransform: 'none' }}>Cancelar</Button>
          <Button variant="contained" onClick={guardarEvaluacion} disabled={calBusy || !calForm.gestorNombre} sx={{ textTransform: 'none' }}>
            {calBusy ? <CircularProgress size={20} color="inherit" /> : 'Guardar evaluación'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(toast)} autoHideDuration={3500} onClose={() => setToast(null)} message={toast ?? ''} />
    </Box>
  );
};

export default ControlOperativoPage;
