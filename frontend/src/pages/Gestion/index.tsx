import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import { useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, Grid, IconButton, Menu, MenuItem, Paper, Snackbar, Stack, Tab, Table, TableBody, TableCell, TableContainer,
  TableHead, TablePagination, TableRow, TableSortLabel, Tabs, TextField, Typography
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import DashboardFilters from '../../components/Dashboard/DashboardFilters';
import KpiCards from '../../components/Dashboard/KpiCards';
import { downloadBlob, exportRowsToCsv, exportRowsToExcel } from '../../utils/tableExport';
import { useAuth } from '../../context/AuthContext';
import { useTasasConversion } from '../../hooks/useTasasConversion';
import { usdEquivalente } from '../../utils/monedaConversion';
import { MONEDA_OPTIONS, simboloMoneda } from '../../utils/monedaOptions';
import type { DashboardResponse, DashboardFilterOptions, DashboardMultiFilterParams } from '../../types/cartera';
import {
  getGestionDashboard, getGestionCuentas, getDetalleCuenta, getInfoCuenta, tipificarCuenta, crearPromesa,
  subirAdjunto, crearCarta, crearCartasMasivo, getCartaPreview, getCartaDetalle, getCartas, aprobarCarta, rechazarCarta, getZonasPd, getPdCampanas, getEstadoCuentas,
  getCatalogo, getTipificaciones, obtenerCartasDescargaLote, MONEDA_POR_PAIS, siglaPais, TIPIFICACIONES, TIPO_CONTACTO, CANALES,
  type CartaGestion, type CartaPreview, type CartaDetalle, type DetalleCuenta, type AggNode, type EstadoCuenta, type CuentaTipificada, type ResultadoCartasMasivo, type MotivoDescargaLote
} from '../../services/gestionService';
import CartaRenderer from '../../components/common/CartaRenderer';
import { descargarCartaPdf, cartaPdfBlob, esperarImagenesCargadas } from '../../utils/exportCartaPdf';

const EMPTY_OPTS: DashboardFilterOptions = { pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] };
const EMPTY_FILTERS: DashboardMultiFilterParams = { pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] };
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
const VisualCard = ({ title, subtitle, onDir, onMetric, csv, excel, png, children }: {
  title: string; subtitle?: string; onDir: (d: 'asc' | 'desc') => void; onMetric: (m: Metric) => void;
  csv: () => void; excel: () => void; png: () => void; children: ReactNode;
}) => {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [full, setFull] = useState(false);
  const close = () => setAnchor(null);
  const header = (
    <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 700 }}>{title}</Typography>
        {subtitle && <Typography sx={{ fontSize: 10.5, color: 'text.secondary', lineHeight: 1.2 }}>{subtitle}</Typography>}
      </Box>
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
      <Box sx={{ px: 1.5, pb: 1.5, maxHeight: 260, overflowY: 'auto' }}>{children}</Box>
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
  // "Cartas" es una pestaña interna de Gestión, no un módulo del Sidebar: se
  // oculta con las MISMAS claves de permiso ya usadas para sus acciones
  // (crear/aprobar carta) — ningún rol pierde acceso que ya tuviera, solo
  // deja de verse para quien no puede ni crear ni aprobar cartas.
  const canVerCartas = canCarta || canAprobar;
  // Índice real de la pestaña Tipificaciones: Cartas solo existe cuando
  // canVerCartas es true, así que su propia posición (y la de todo lo que
  // va después) depende de esa condición — MUI asigna el value de cada Tab
  // por su posición entre los hijos efectivamente renderizados.
  const tabTipificaciones = canVerCartas ? 2 : 1;

  const [searchParams] = useSearchParams();
  // Deep link desde la campana de notificaciones (carta autorizada/rechazada
  // -> /gestion?tab=cartas): solo decide la pestaña INICIAL, una sola vez al
  // montar — después el usuario puede cambiar de pestaña libremente, sin que
  // el parámetro de la URL lo vuelva a forzar.
  const [tab, setTab] = useState(() => (searchParams.get('tab') === 'cartas' && canVerCartas ? 1 : 0));
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
  // Si el filtro cambia varias veces seguidas antes de que responda la
  // primera carga, una respuesta obsoleta que llegue tarde NUNCA debe pisar
  // el resultado de una selección más reciente.
  const loadRequestIdRef = useRef(0);

  const [zMetric, setZMetric] = useState<Metric>('saldoLocal'); const [zDir, setZDir] = useState<'asc' | 'desc'>('desc');
  const [pMetric, setPMetric] = useState<Metric>('saldoUsd'); const [pDir, setPDir] = useState<'asc' | 'desc'>('desc');
  const [fPd, setFPd] = useState(''); const [fZona, setFZona] = useState(''); const [fCamp, setFCamp] = useState(''); const [fCodigo, setFCodigo] = useState('');
  const [fSector, setFSector] = useState('');
  // Selección múltiple de cuentas (checkbox): clave SIEMPRE el código real
  // de la cuenta (identificador estable del sistema, nunca índice de fila ni
  // posición de página — el mismo código que usan getEstadoCuentas/
  // filtrarCodigosEnAlcance/gestion_cartas.codigo en todo el backend).
  const [selCuentas, setSelCuentas] = useState<Set<string>>(new Set());
  const [loteCartaOpen, setLoteCartaOpen] = useState(false);
  const [loteCartaComent, setLoteCartaComent] = useState('');
  const [loteCartaBusy, setLoteCartaBusy] = useState(false);
  const [loteCartaResultado, setLoteCartaResultado] = useState<ResultadoCartasMasivo | null>(null);
  // Ordenamiento de la tabla Cuentas: mismo patrón de las demás tablas del
  // sistema (p.ej. components/Dashboard/DashboardTable.tsx) — TableSortLabel
  // con orderBy/order de 2 estados (asc/desc), sin un tercer estado "sin
  // orden" porque ninguna tabla del sistema lo usa.
  const [cOrderBy, setCOrderBy] = useState<'codigo' | 'pais' | 'zona' | 'pd' | 'campania' | 'saldoLocal' | 'saldoUsd'>('codigo');
  const [cOrder, setCOrder] = useState<'asc' | 'desc'>('asc');

  // Panel único por cuenta
  const [panel, setPanel] = useState<Record<string, unknown> | null>(null);
  const [detalle, setDetalle] = useState<DetalleCuenta | null>(null);
  const [info, setInfo] = useState<Record<string, unknown> | null>(null);
  const [gForm, setGForm] = useState({ tipoContacto: '', canal: '', tip: '', tipCom: '', fechaProm: '', montoProm: '', promCom: '', cartaCom: '', adjTipo: 'Boleta de pago' });
  const [adjFile, setAdjFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const [cartas, setCartas] = useState<CartaGestion[]>([]);
  // Selección múltiple de cartas APROBADAS (Cartas: selección múltiple ->
  // "Descargar cartas"). Clave SIEMPRE `c.id` (identificador real de la
  // carta, el mismo que usa "Ver"/descarga individual) — nunca índice de
  // fila ni posición de página.
  const [selCartas, setSelCartas] = useState<Set<string>>(new Set());
  const [descargaCartasBusy, setDescargaCartasBusy] = useState(false);
  const [descargaCartasProgreso, setDescargaCartasProgreso] = useState<{ hecho: number; total: number } | null>(null);
  const [descargaCartasResultado, setDescargaCartasResultado] = useState<{ total: number; descargadas: number; noDescargadas: Array<{ codigo: string; motivo: string }> } | null>(null);
  const [cartaSel, setCartaSel] = useState<CartaGestion | null>(null);
  const [cartaComent, setCartaComent] = useState('');
  // Vista previa EN VIVO bloqueada al PD actual de la cuenta abierta en el
  // panel — se pide al backend cada vez que se abre el panel, nunca la
  // decide el cliente (ver getCartaPreview).
  const [cartaPreview, setCartaPreview] = useState<CartaPreview | null>(null);
  const [cartaPrevOpen, setCartaPrevOpen] = useState(false);
  // Detalle completo (con logo/firma SOLO si ya está autorizada) de una
  // carta puntual de la pestaña "Cartas", para ver/descargar.
  const [cartaDetalle, setCartaDetalle] = useState<CartaDetalle | null>(null);
  const cartaRenderRef = useRef<HTMLDivElement>(null);

  // Catálogos configurables (fuente única: Configuración). Fallback a constantes si el catálogo está vacío.
  const [catTip, setCatTip] = useState<string[]>(TIPIFICACIONES);
  const [catTC, setCatTC] = useState<string[]>(TIPO_CONTACTO);
  const [catCanal, setCatCanal] = useState<string[]>(CANALES);
  useEffect(() => {
    getCatalogo('tipificaciones').then((v) => { if (v.length) setCatTip(v); }).catch(() => undefined);
    getCatalogo('tipos_contacto').then((v) => { if (v.length) setCatTC(v); }).catch(() => undefined);
    getCatalogo('canales').then((v) => { if (v.length) setCatCanal(v); }).catch(() => undefined);
  }, []);

  const load = async () => {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true); setError(null);
    try {
      const [d, c, z, pc] = await Promise.all([getGestionDashboard(filters), getGestionCuentas(filters), getZonasPd(filters), getPdCampanas(filters)]);
      if (requestId !== loadRequestIdRef.current) return; // obsoleta: llegó después de un filtro más reciente
      setDashboard(d); setCuentas(c); setZonas(z); setPdCamp(pc); setPage(0);
    } catch (err) {
      if (requestId !== loadRequestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'No fue posible cargar la gestión.');
    } finally {
      if (requestId === loadRequestIdRef.current) setLoading(false);
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [filters]);
  useEffect(() => { if (tab === 1 && canVerCartas) getCartas().then(setCartas).catch(() => undefined); }, [tab, canVerCartas]);

  // Solo las cartas APROBADAS son seleccionables/descargables en lote —
  // pendientes/rechazadas/canceladas/cualquier otro estado nunca entran aquí.
  const cartasAprobadas = useMemo(() => cartas.filter((c) => c.estado === 'APROBADA'), [cartas]);
  // Cuando `cartas` se recarga (cambia de pestaña, se aprueba/rechaza una
  // carta), se depura la selección: se quita todo lo que ya no esté entre
  // las aprobadas vigentes, se conserva lo que siga estándolo.
  useEffect(() => {
    setSelCartas((prev) => {
      if (prev.size === 0) return prev;
      const validos = new Set(cartasAprobadas.map((c) => c.id));
      const next = new Set([...prev].filter((id) => validos.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [cartasAprobadas]);
  const toggleSelCarta = (id: string) => setSelCartas((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const todasAprobadasSeleccionadas = cartasAprobadas.length > 0 && cartasAprobadas.every((c) => selCartas.has(c.id));
  const algunaAprobadaSeleccionada = cartasAprobadas.some((c) => selCartas.has(c.id));
  const toggleSeleccionarTodasCartas = () => setSelCartas((prev) => {
    if (todasAprobadasSeleccionadas) {
      const fuera = new Set(cartasAprobadas.map((c) => c.id));
      return new Set([...prev].filter((id) => !fuera.has(id)));
    }
    const next = new Set(prev);
    cartasAprobadas.forEach((c) => next.add(c.id));
    return next;
  });
  const limpiarSeleccionCartas = () => setSelCartas(new Set());

  /** Descarga masiva: UN solo request al backend para todas las
   *  seleccionadas (obtenerCartasDescargaLote), luego — por cada carta
   *  descargable — renderiza el MISMO CartaRenderer que usa "Ver"/descarga
   *  individual fuera de pantalla, espera sus imágenes (logo/firma real ya
   *  autorizada) y la captura con el MISMO motor (`cartaPdfBlob`, reutiliza
   *  `descargarCartaPdf`), para empaquetarlas todas en un único ZIP. Nunca
   *  aborta el lote por una carta inválida: cada motivo (del backend o de un
   *  fallo de render puntual) se reporta real, nunca inventado. */
  const descargarCartasSeleccionadas = async () => {
    if (descargaCartasBusy || selCartas.size === 0) return;
    const ids = [...selCartas];
    setDescargaCartasBusy(true);
    setDescargaCartasProgreso({ hecho: 0, total: ids.length });
    try {
      const r = await obtenerCartasDescargaLote(ids);
      const zip = new JSZip();
      const nombresUsados = new Set<string>();
      const fallidasRender: MotivoDescargaLote[] = [];
      let hecho = 0;
      for (const carta of r.descargables) {
        const contenedor = document.createElement('div');
        contenedor.style.position = 'fixed';
        contenedor.style.top = '-99999px';
        contenedor.style.left = '-99999px';
        document.body.appendChild(contenedor);
        const root = createRoot(contenedor);
        try {
          let nodo: HTMLDivElement | null = null;
          await new Promise<void>((resolve) => {
            root.render(
              <CartaRenderer ref={(el) => { nodo = el; }} contenido={carta.contenido} logoUrl={carta.logoUrl} firmaUrl={carta.firmaUrl} />
            );
            setTimeout(resolve, 0);
          });
          if (!nodo) throw new Error('No se pudo preparar el documento.');
          await esperarImagenesCargadas(nodo);
          const blob = await cartaPdfBlob(nodo);
          const base = `CARTA_${carta.codigo || carta.id}`;
          let nombre = base;
          let n = 2;
          while (nombresUsados.has(nombre)) { nombre = `${base}_${n}`; n += 1; }
          nombresUsados.add(nombre);
          zip.file(`${nombre}.pdf`, blob);
        } catch (err) {
          fallidasRender.push({ id: carta.id, codigo: carta.codigo, motivo: err instanceof Error ? err.message : 'No se pudo generar el documento.' });
        } finally {
          root.unmount();
          document.body.removeChild(contenedor);
          hecho += 1;
          setDescargaCartasProgreso({ hecho, total: ids.length });
        }
      }
      const descargadas = Object.keys(zip.files).length;
      if (descargadas > 0) {
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(zipBlob, 'cartas_aprobadas.zip');
      }
      setDescargaCartasResultado({
        total: r.total, descargadas,
        noDescargadas: [...r.noDescargables, ...fallidasRender].map((n) => ({ codigo: n.codigo, motivo: n.motivo }))
      });
      limpiarSeleccionCartas();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudieron descargar las cartas.');
    } finally {
      setDescargaCartasBusy(false);
      setDescargaCartasProgreso(null);
    }
  };

  const opts = dashboard?.filterOptions ?? EMPTY_OPTS;
  const monedaLocal = useMemo(() => {
    if (filters.pais.length !== 1) return null;
    return { pais: filters.pais[0], moneda: MONEDA_POR_PAIS[filters.pais[0].toUpperCase()] ?? '—' };
  }, [filters.pais]);

  // Indicador/conversión de moneda de los gráficos (Zonas, PD por campañas):
  // misma implementación que Dashboard/Plan y Proyección (pages/Dashboard/index.tsx)
  // — mismo useTasasConversion, mismo MONEDA_OPTIONS, misma fórmula usd * tasa.
  // No se toca la lógica de scope/filtros/cartera ni las optimizaciones de Fase 3.
  const [monedaFiltro, setMonedaFiltro] = useState<string>('USD');
  const { tasas: tasasConversion } = useTasasConversion();
  const monedaOption = MONEDA_OPTIONS.find((option) => option.code === monedaFiltro) ?? MONEDA_OPTIONS[0];
  const monedaCode = monedaOption.code;
  const tasaActual = tasasConversion[monedaCode] ?? 1;
  const simboloGraficos = simboloMoneda(monedaCode);
  const valorMoneda = (usd: number) => usd * tasaActual;

  // ===== Tipificaciones: cuentas clasificadas por su ÚLTIMA gestión
  // registrada, dentro de los MISMOS filtros (país/gestor/gerente/zona/pd/
  // campaña) de las demás pestañas de Gestión — una sola llamada al backend
  // (getTipificaciones), nunca una consulta por tipificación. Se carga
  // perezosamente al entrar a la pestaña y se refresca si los filtros
  // compartidos cambian mientras está activa (mismo patrón que "Cartas").
  const [tipData, setTipData] = useState<CuentaTipificada[]>([]);
  const [tipLoading, setTipLoading] = useState(false);
  const [tipSelTip, setTipSelTip] = useState<string[]>([]);
  const [tipEstado, setTipEstado] = useState<'TODOS' | 'CON' | 'SIN'>('TODOS');
  const [expTip, setExpTip] = useState<Set<string>>(new Set());
  type TipOrderCol = 'tipificacion' | 'cuentas' | 'saldoActual' | 'pctCuentas' | 'saldoPromesa' | 'cuentasConPromesa';
  const [tipOrderBy, setTipOrderBy] = useState<TipOrderCol>('cuentas');
  const [tipOrder, setTipOrder] = useState<'asc' | 'desc'>('desc');
  useEffect(() => {
    if (tab !== tabTipificaciones) return;
    setTipLoading(true);
    getTipificaciones(filters).then(setTipData).catch((e) => setToast(e instanceof Error ? e.message : 'No se pudo cargar Tipificaciones.')).finally(() => setTipLoading(false));
    // eslint-disable-next-line
  }, [tab, tabTipificaciones, filters]);
  const limpiarFiltrosTip = () => { setTipSelTip([]); setTipEstado('TODOS'); };

  // Universo tras el filtro "Estado de gestión" + el selector de Tipificación
  // (ambos locales a esta pestaña, encima de los filtros compartidos ya
  // aplicados por el backend). "Sin gestión" ignora el selector de
  // Tipificación (una cuenta sin gestión no tiene tipificación que filtrar).
  const tipFiltradas = useMemo(() => {
    let rows = tipData;
    if (tipEstado === 'CON') rows = rows.filter((r) => r.tipificacion !== null);
    else if (tipEstado === 'SIN') rows = rows.filter((r) => r.tipificacion === null);
    else if (tipSelTip.length > 0) rows = rows.filter((r) => r.tipificacion !== null && tipSelTip.includes(r.tipificacion));
    return rows;
  }, [tipData, tipEstado, tipSelTip]);
  const tipTotal = tipFiltradas.length;
  const tipCon = useMemo(() => tipFiltradas.filter((r) => r.tipificacion !== null).length, [tipFiltradas]);
  const tipSin = tipTotal - tipCon;
  const tipPctCon = tipTotal ? (tipCon / tipTotal) * 100 : 0;
  const tipPctSin = tipTotal ? (tipSin / tipTotal) * 100 : 0;

  // Tabla resumen: SOLO cuentas CON gestión real, agrupadas por su
  // tipificación tal cual quedó registrada — nunca se agrega aquí una fila
  // "SIN GESTIÓN" (esa es una etiqueta puramente visual del listado aparte,
  // nunca una tipificación real ni algo que se guarde).
  interface TipGrupo { tipificacion: string; cuentas: number; saldoActual: number; pctCuentas: number; saldoPromesa: number; cuentasConPromesa: number; cuentasSinPromesa: number; filas: CuentaTipificada[]; }
  const tipTabla: TipGrupo[] = useMemo(() => {
    const map = new Map<string, CuentaTipificada[]>();
    tipFiltradas.forEach((r) => {
      if (!r.tipificacion) return;
      const arr = map.get(r.tipificacion) ?? [];
      arr.push(r);
      map.set(r.tipificacion, arr);
    });
    const totalConTip = Array.from(map.values()).reduce((a, arr) => a + arr.length, 0);
    return Array.from(map.entries()).map(([tip, filas]) => {
      const saldoActualUsd = filas.reduce((a, f) => a + usdEquivalente(f.saldoActual, f.pais, tasasConversion), 0);
      const conProm = filas.filter((f) => f.fechaPromesa !== null);
      const saldoPromesaUsd = conProm.reduce((a, f) => a + usdEquivalente(f.montoPromesa ?? 0, f.pais, tasasConversion), 0);
      return {
        tipificacion: tip, cuentas: filas.length,
        saldoActual: valorMoneda(saldoActualUsd),
        pctCuentas: totalConTip ? (filas.length / totalConTip) * 100 : 0,
        saldoPromesa: valorMoneda(saldoPromesaUsd),
        cuentasConPromesa: conProm.length,
        cuentasSinPromesa: filas.length - conProm.length,
        filas
      };
    });
    // eslint-disable-next-line
  }, [tipFiltradas, tasasConversion, monedaFiltro]);
  const tipTablaOrdenada = useMemo(() => [...tipTabla].sort((a, b) => {
    const av = a[tipOrderBy]; const bv = b[tipOrderBy];
    const r = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'es', { sensitivity: 'base' });
    return tipOrder === 'asc' ? r : -r;
  }), [tipTabla, tipOrderBy, tipOrder]);
  const handleSortTip = (col: TipOrderCol) => { const isAsc = tipOrderBy === col && tipOrder === 'asc'; setTipOrder(isAsc ? 'desc' : 'asc'); setTipOrderBy(col); };

  const TIP_DETALLE_HEAD = ['Código', 'Nombre / Razón Social', 'País', 'Zona', 'Gestor', 'PD', 'Campaña', 'Saldo Actual', 'Tipificación', 'Fecha Gestión', 'Fecha Promesa', 'Monto Promesa', 'Teléfono', 'WhatsApp', 'Observaciones'];
  // WhatsApp reutiliza el mismo teléfono celular: no existe un campo
  // distinto de WhatsApp en el modelo de cartera (ver GestionService.tipificacionesCuentas).
  const filaDetalleExport = (f: CuentaTipificada): Array<string | number> => [
    f.codigo, f.nombre, f.pais, f.zona, f.gestor, f.pdActual, f.campaniaAdeuda,
    f.saldoActual, f.tipificacion ?? 'Sin gestión', f.fechaGestion ? f.fechaGestion.slice(0, 16).replace('T', ' ') : '',
    f.fechaPromesa ?? '', f.montoPromesa ?? '', f.telefono ?? '', f.telefono ?? '', f.comentarioGestion ?? ''
  ];
  const descargarDetalle = (filas: CuentaTipificada[], nombreBase: string, formato: 'csv' | 'xlsx') => {
    const rows = filas.map(filaDetalleExport);
    if (formato === 'csv') exportRowsToCsv(`${nombreBase}.csv`, TIP_DETALLE_HEAD, rows);
    else exportRowsToExcel(`${nombreBase}.xlsx`, 'Cuentas', TIP_DETALLE_HEAD, rows);
  };

  const sortNodes = (arr: AggNode[], m: Metric, dir: 'asc' | 'desc') =>
    [...arr].sort((a, b) => (dir === 'desc' ? (b[m] as number) - (a[m] as number) : (a[m] as number) - (b[m] as number)));
  const zonasSorted = useMemo(() => sortNodes(zonas, zMetric, zDir), [zonas, zMetric, zDir]);
  const pdSorted = useMemo(() => sortNodes(pdCamp, pMetric, pDir), [pdCamp, pMetric, pDir]);
  const zMax = Math.max(1, ...zonasSorted.map((z) => z[zMetric] as number));
  const pMax = Math.max(1, ...pdSorted.map((p) => p[pMetric] as number));

  const optsTabla = useMemo(() => {
    const uniq = (k: string) => [...new Set(cuentas.map((r) => str(r[k])).filter(Boolean))].sort();
    return { pd: uniq('pd_actual'), zona: uniq('zona'), campania: uniq('campania_adeuda'), sector: uniq('sector') };
  }, [cuentas]);
  const cuentasFiltradas = useMemo(() => {
    // Búsqueda por coincidencia (parcial, sin distinguir mayúsculas/minúsculas):
    // la tabla no tenía antes ningún filtro de texto por código, así que se
    // sigue la misma convención de búsqueda por coincidencia ya usada en
    // Cartera (pages/Cartera/index.tsx). Se combina con los filtros
    // existentes (PD/Zona/Campaña/Sector) con AND, igual que entre ellos.
    const codigoTerm = fCodigo.trim().toLowerCase();
    return cuentas.filter((r) =>
      (!fPd || str(r.pd_actual) === fPd) && (!fZona || str(r.zona) === fZona) && (!fCamp || str(r.campania_adeuda) === fCamp) &&
      (!fSector || str(r.sector) === fSector) &&
      (!codigoTerm || str(r.codigo).toLowerCase().includes(codigoTerm))
    );
  }, [cuentas, fPd, fZona, fCamp, fSector, fCodigo]);
  // Selección múltiple: cuando el universo filtrado cambia (filtro nuevo,
  // recarga de datos), se descarta de la selección cualquier código que ya
  // no esté entre las cuentas filtradas — nunca se deja seleccionada una
  // cuenta fuera de los filtros vigentes. Los códigos que siguen
  // coincidiendo se conservan (la selección sobrevive a la paginación).
  useEffect(() => {
    setSelCuentas((prev) => {
      if (prev.size === 0) return prev;
      const validos = new Set(cuentasFiltradas.map((r) => str(r.codigo)));
      const next = new Set([...prev].filter((c) => validos.has(c)));
      return next.size === prev.size ? prev : next;
    });
  }, [cuentasFiltradas]);
  // "Saldo Inicial/Actual USD" SIEMPRE se derivan de saldo_inicial/saldo_actual
  // (moneda local real) / tasa vigente del país — nunca de las columnas
  // saldo_inicial_usd/saldo_actual_usd (congeladas al importar). Ver utils/monedaConversion.ts.
  const usdInicialDeFila = (r: Record<string, unknown>) => usdEquivalente(Number(str(r.saldo_inicial)) || 0, str(r.pais), tasasConversion);
  const usdActualDeFila = (r: Record<string, unknown>) => usdEquivalente(Number(str(r.saldo_actual)) || 0, str(r.pais), tasasConversion);
  const getValorOrdenCuenta = (r: Record<string, unknown>, columnId: typeof cOrderBy): string | number => {
    switch (columnId) {
      case 'pais': return str(r.pais);
      case 'zona': return str(r.zona);
      case 'pd': return str(r.pd_actual);
      case 'campania': return str(r.campania_adeuda);
      case 'saldoLocal': return Number(str(r.saldo_actual)) || 0;
      case 'saldoUsd': return usdActualDeFila(r);
      default: return str(r.codigo);
    }
  };
  // Primero se filtra (cuentasFiltradas), luego se ordena el resultado —
  // mismo orden de operaciones que DashboardTable (filteredData -> sortedData).
  const cuentasOrdenadas = useMemo(() => [...cuentasFiltradas].sort((a, b) => {
    const av = getValorOrdenCuenta(a, cOrderBy);
    const bv = getValorOrdenCuenta(b, cOrderBy);
    const result = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'es', { sensitivity: 'base' });
    return cOrder === 'asc' ? result : -result;
    // eslint-disable-next-line
  }), [cuentasFiltradas, cOrderBy, cOrder, tasasConversion]);
  const handleSortCuentas = (columnId: typeof cOrderBy) => {
    const isAsc = cOrderBy === columnId && cOrder === 'asc';
    setCOrder(isAsc ? 'desc' : 'asc');
    setCOrderBy(columnId);
  };
  const paged = cuentasOrdenadas.slice(page * rpp, page * rpp + rpp);
  useEffect(() => {
    const codigos = paged.map((r) => str(r.codigo)).filter(Boolean);
    if (codigos.length) getEstadoCuentas(codigos).then((m) => setEstado((prev) => ({ ...prev, ...m }))).catch(() => undefined);
    // eslint-disable-next-line
  }, [page, rpp, cuentasOrdenadas]);
  // Limpiar filtros no reinicia el orden: ninguna otra tabla del sistema ata
  // el estado de orden al de los filtros, así que se conserva (comportamiento
  // estándar: orden y filtros son independientes entre sí).
  const limpiarFiltrosTabla = () => { setFPd(''); setFZona(''); setFCamp(''); setFSector(''); setFCodigo(''); setPage(0); };

  const toggleSeleccionCuenta = (codigo: string) => setSelCuentas((prev) => {
    const next = new Set(prev);
    next.has(codigo) ? next.delete(codigo) : next.add(codigo);
    return next;
  });
  // "Seleccionar todas": actúa sobre TODO el universo filtrado
  // (`cuentasFiltradas`), no solo la página visible — ese universo ya está
  // completo en memoria (getGestionCuentas no pagina en el backend), así
  // que no hace falta ninguna consulta adicional para resolverlo.
  const todasFiltradasSeleccionadas = cuentasFiltradas.length > 0 && cuentasFiltradas.every((r) => selCuentas.has(str(r.codigo)));
  const algunaFiltradaSeleccionada = cuentasFiltradas.some((r) => selCuentas.has(str(r.codigo)));
  const toggleSeleccionarTodasFiltradas = () => setSelCuentas((prev) => {
    if (todasFiltradasSeleccionadas) {
      const fuera = new Set(cuentasFiltradas.map((r) => str(r.codigo)));
      return new Set([...prev].filter((c) => !fuera.has(c)));
    }
    const next = new Set(prev);
    cuentasFiltradas.forEach((r) => next.add(str(r.codigo)));
    return next;
  });
  const limpiarSeleccionCuentas = () => setSelCuentas(new Set());

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
  const CUENTAS_COLS = ['codigo', 'nombre', 'pais', 'zona', 'sector', 'gestor', 'pd_actual', 'campania_adeuda', 'saldo_actual'];
  const CUENTAS_HEAD = ['Cuenta', 'Representante', 'País', 'Zona', 'Sector', 'Gestor', 'PD', 'Campaña', 'Saldo Inicial USD', 'Saldo Actual USD', 'Saldo Local'];
  const rowsCuentasDe = (rows: Record<string, unknown>[]) => rows.map((r) => {
    const base = CUENTAS_COLS.filter((c) => c !== 'saldo_actual').map((c) => str(r[c]));
    return [...base, money(usdInicialDeFila(r)), money(usdActualDeFila(r)), str(r.saldo_actual)];
  });
  const rowsCuentas = () => rowsCuentasDe(cuentasOrdenadas);
  // Exportación de la SELECCIÓN: nunca toda la cartera filtrada, solo las
  // cuentas marcadas (mismas columnas/orden que el export general, mismo
  // exportador real xlsx/csv — ver utils/tableExport.ts, sin tocarlo).
  const cuentasSeleccionadas = () => cuentasOrdenadas.filter((r) => selCuentas.has(str(r.codigo)));
  const rowsCuentasSeleccionadas = () => rowsCuentasDe(cuentasSeleccionadas());

  // Generación masiva de cartas: un solo request con TODOS los códigos
  // seleccionados (ver gestionService.crearCartasMasivo / POST
  // /api/gestion/cartas/lote) — nunca una llamada por cuenta. El resultado
  // nunca es un éxito falso: siempre indica cuántas se generaron y, por
  // cada una que no, el motivo real devuelto por el backend.
  const generarCartasMasivo = async () => {
    if (loteCartaBusy || selCuentas.size === 0) return;
    setLoteCartaBusy(true);
    try {
      const r = await crearCartasMasivo([...selCuentas], loteCartaComent);
      setLoteCartaOpen(false);
      setLoteCartaComent('');
      setLoteCartaResultado(r);
      limpiarSeleccionCuentas();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudieron generar las cartas.');
    } finally {
      setLoteCartaBusy(false);
    }
  };

  const abrirPanel = async (row: Record<string, unknown>) => {
    setPanel(row); setDetalle(null); setInfo(null);
    setGForm({ tipoContacto: '', canal: '', tip: '', tipCom: '', fechaProm: '', montoProm: '', promCom: '', cartaCom: '', adjTipo: 'Boleta de pago' });
    setAdjFile(null);
    setCartaPreview(null);
    const cod = str(row.codigo);
    getDetalleCuenta(cod).then(setDetalle).catch(() => undefined);
    getInfoCuenta(cod).then(setInfo).catch(() => undefined);
    if (canCarta) getCartaPreview(cod).then(setCartaPreview).catch(() => undefined);
  };
  const cod = str(panel?.codigo);
  const accion = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try { await fn(); setToast(ok); setDetalle(await getDetalleCuenta(cod)); }
    catch (err) { setToast(err instanceof Error ? err.message : 'Error.'); }
    finally { setBusy(false); }
  };
  // Información de cobro y reglas de promesa de la cuenta abierta.
  const monedaCuenta = MONEDA_POR_PAIS[str(panel?.pais).toUpperCase()] ?? '—';
  const cobroPD = str(panel?.pd_actual) || 'No disponible';
  const esPromesa = gForm.tip === 'PROMESA DE PAGO';
  const montoPromNum = Number(gForm.montoProm);
  const promesaValida = !esPromesa || (Boolean(gForm.fechaProm) && Number.isFinite(montoPromNum) && montoPromNum > 0);
  const registrarGestion = () => accion(async () => {
    await tipificarCuenta(cod, { tipificacion: gForm.tip, comentario: gForm.tipCom, tipoContacto: gForm.tipoContacto, canal: gForm.canal });
    if (esPromesa) {
      await crearPromesa(cod, { fechaPromesa: gForm.fechaProm, monto: montoPromNum, comentario: gForm.promCom });
    }
  }, esPromesa ? 'Gestión y promesa registradas.' : 'Gestión registrada.');

  if (loading && !dashboard) return <Box sx={{ display: 'flex', gap: 1.5, p: 3, alignItems: 'center' }}><CircularProgress size={22} /><Typography sx={{ fontSize: 14 }}>Cargando gestión...</Typography></Box>;
  if (error) return <Box sx={{ p: 2 }}><Alert severity="error">{error}</Alert></Box>;

  const promVigente = (detalle?.promesas ?? []).find((p) => str(p.estado) === 'PENDIENTE') ?? (detalle?.promesas ?? [])[0];

  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Operación" sx={{ textTransform: 'none' }} />
        {canVerCartas && <Tab label="Cartas" sx={{ textTransform: 'none' }} />}
        <Tab label="Tipificaciones" sx={{ textTransform: 'none' }} />
      </Tabs>

      {tab === 0 && dashboard && (
        <Stack spacing={2}>
          <DashboardFilters filters={filters} onChange={setFilters} onClear={() => setFilters(EMPTY_FILTERS)} options={opts} moneda={monedaFiltro} onMonedaChange={setMonedaFiltro} />
          {monedaLocal && <Alert severity="info" sx={{ py: 0.5 }}>Moneda local: <strong>{monedaLocal.pais.toUpperCase()} · {monedaLocal.moneda}</strong></Alert>}
          <KpiCards kpis={dashboard.kpis} />
        </Stack>
      )}

      {tab === 0 && dashboard && (
        <Box sx={{ mt: 2, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
          {/* Zonas — visual de barras */}
          <VisualCard title="Zonas" subtitle={`Moneda: ${simboloGraficos}`} onDir={setZDir} onMetric={setZMetric}
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
                    <Box sx={{ width: 190, textAlign: 'right', fontSize: 12 }}>{z.cuentas} cta · {money(valorMoneda(z.saldoUsd))} · {z.pctRecuperacion}%</Box>
                  </Box>
                  <Collapse in={expZ.has(z.key)} unmountOnExit>
                    <Stack spacing={0.5} sx={{ pl: 7, py: 0.5 }}>
                      {(z.pds ?? []).map((p) => (
                        <Box key={p.key} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ width: 110, fontSize: 12 }}>{p.pd}</Box>
                          <Bar value={p.saldoUsd} max={Math.max(1, ...(z.pds ?? []).map((x) => x.saldoUsd))} color="#0EA5E9" />
                          <Box sx={{ width: 190, textAlign: 'right', fontSize: 11 }}>{p.cuentas} cta · {money(valorMoneda(p.saldoUsd))} · {p.pctRecuperacion}%</Box>
                        </Box>
                      ))}
                    </Stack>
                  </Collapse>
                </Box>
              ))}
            </Stack>
          </VisualCard>

          {/* PD por campañas — visual de barras */}
          <VisualCard title="PD por campañas" subtitle={`Moneda: ${simboloGraficos}`} onDir={setPDir} onMetric={setPMetric}
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
                    <Box sx={{ width: 190, textAlign: 'right', fontSize: 12 }}>{p.cuentas} cta · {money(valorMoneda(p.saldoUsd))} · {p.pctRecuperacion}%</Box>
                  </Box>
                  <Collapse in={expPd.has(p.key)} unmountOnExit>
                    <Stack spacing={0.5} sx={{ pl: 7, py: 0.5 }}>
                      {(p.campanas ?? []).map((c) => (
                        <Box key={c.key} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ width: 150, fontSize: 12 }}>{c.campania}</Box>
                          <Bar value={c.saldoUsd} max={Math.max(1, ...(p.campanas ?? []).map((x) => x.saldoUsd))} color="#22C55E" />
                          <Box sx={{ width: 190, textAlign: 'right', fontSize: 11 }}>{c.cuentas} cta · {money(valorMoneda(c.saldoUsd))} · {c.pctRecuperacion}%</Box>
                        </Box>
                      ))}
                    </Stack>
                  </Collapse>
                </Box>
              ))}
            </Stack>
          </VisualCard>
        </Box>
      )}

      {tab === 0 && (
        <Paper sx={{ mt: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
          <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography sx={{ fontWeight: 700, mr: 1 }}>Cuentas ({cuentasFiltradas.length.toLocaleString('en-US')})</Typography>
              <TextField size="small" label="Código" placeholder="Buscar por código" value={fCodigo} onChange={(e) => { setFCodigo(e.target.value); setPage(0); }} sx={{ minWidth: 150 }} />
              <TextField select size="small" label="PD" value={fPd} onChange={(e) => { setFPd(e.target.value); setPage(0); }} sx={{ minWidth: 100 }}><MenuItem value="">Todos</MenuItem>{optsTabla.pd.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField>
              <TextField select size="small" label="Zona" value={fZona} onChange={(e) => { setFZona(e.target.value); setPage(0); }} sx={{ minWidth: 120 }}><MenuItem value="">Todas</MenuItem>{optsTabla.zona.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField>
              <TextField select size="small" label="Sector" value={fSector} onChange={(e) => { setFSector(e.target.value); setPage(0); }} sx={{ minWidth: 120 }}><MenuItem value="">Todos</MenuItem>{optsTabla.sector.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField>
              <TextField select size="small" label="Campaña" value={fCamp} onChange={(e) => { setFCamp(e.target.value); setPage(0); }} sx={{ minWidth: 120 }}><MenuItem value="">Todas</MenuItem>{optsTabla.campania.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField>
              <Button size="small" onClick={limpiarFiltrosTabla} sx={{ textTransform: 'none' }}>Limpiar filtros</Button>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Button size="small" startIcon={<FileDownloadOutlinedIcon />} onClick={() => exportRowsToCsv('gestion_cuentas.csv', CUENTAS_HEAD, rowsCuentas())} sx={{ textTransform: 'none' }}>CSV</Button>
              <Button size="small" startIcon={<FileDownloadOutlinedIcon />} onClick={() => exportRowsToExcel('gestion_cuentas.xlsx', 'Cuentas', CUENTAS_HEAD, rowsCuentas())} sx={{ textTransform: 'none' }}>Excel</Button>
            </Box>
          </Box>
          {/* Barra de acciones masivas: solo visible con >=1 cuenta
              seleccionada. Las acciones operan EXCLUSIVAMENTE sobre
              `selCuentas` (nunca sobre la página visible ni sobre todo lo
              filtrado), y quedan inactivas mientras no hay selección o
              mientras un lote está en proceso. */}
          <Collapse in={selCuentas.size > 0} unmountOnExit>
            <Box sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', bgcolor: 'action.hover', borderTop: '1px solid', borderColor: 'divider' }}>
              <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{selCuentas.size.toLocaleString('en-US')} cuenta{selCuentas.size === 1 ? '' : 's'} seleccionada{selCuentas.size === 1 ? '' : 's'}</Typography>
              {canCarta && (
                <Button size="small" variant="contained" disabled={loteCartaBusy} onClick={() => setLoteCartaOpen(true)} sx={{ textTransform: 'none' }}>
                  {loteCartaBusy ? 'Generando cartas…' : 'Generar cartas'}
                </Button>
              )}
              <Button size="small" variant="outlined" startIcon={<FileDownloadOutlinedIcon />} onClick={() => exportRowsToCsv('gestion_cuentas_seleccionadas.csv', CUENTAS_HEAD, rowsCuentasSeleccionadas())} sx={{ textTransform: 'none' }}>Descargar CSV</Button>
              <Button size="small" variant="outlined" startIcon={<FileDownloadOutlinedIcon />} onClick={() => exportRowsToExcel('gestion_cuentas_seleccionadas.xlsx', 'Cuentas', CUENTAS_HEAD, rowsCuentasSeleccionadas())} sx={{ textTransform: 'none' }}>Descargar Excel</Button>
              <Button size="small" onClick={limpiarSeleccionCuentas} sx={{ textTransform: 'none' }}>Limpiar selección</Button>
            </Box>
          </Collapse>
          <TableContainer sx={{ maxHeight: '62vh' }}>
            <Table stickyHeader size="small">
              {/* Columna "Acciones" (abre el panel de gestión de la cuenta): visible
                  solo con gestion.gestionar, la misma clave que ya gatea el botón
                  "Registrar gestión" dentro de ese panel — sin ella, el panel no
                  tiene ninguna acción disponible, así que la columna se omite. */}
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={todasFiltradasSeleccionadas}
                      indeterminate={!todasFiltradasSeleccionadas && algunaFiltradaSeleccionada}
                      onChange={toggleSeleccionarTodasFiltradas}
                      inputProps={{ 'aria-label': 'Seleccionar todas las cuentas filtradas' }}
                    />
                  </TableCell>
                  {canGestionar && <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Acciones</TableCell>}
                  {([
                    { id: 'codigo', label: 'Cuenta' }, { id: 'pais', label: 'País' }, { id: 'zona', label: 'Zona' },
                    { id: 'pd', label: 'PD' }, { id: 'campania', label: 'Campaña' },
                    { id: 'saldoLocal', label: 'Saldo Local' }, { id: 'saldoUsd', label: 'Saldo USD' }
                  ] as const).map((col) => (
                    <TableCell key={col.id} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }} sortDirection={cOrderBy === col.id ? cOrder : false}>
                      <TableSortLabel active={cOrderBy === col.id} direction={cOrderBy === col.id ? cOrder : 'asc'} onClick={() => handleSortCuentas(col.id)}>
                        {col.label}
                      </TableSortLabel>
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {paged.map((r, i) => (
                  <TableRow key={str(r.codigo) || i} hover selected={selCuentas.has(str(r.codigo))}>
                    <TableCell padding="checkbox">
                      <Checkbox size="small" checked={selCuentas.has(str(r.codigo))} onChange={() => toggleSeleccionCuenta(str(r.codigo))} inputProps={{ 'aria-label': `Seleccionar cuenta ${str(r.codigo)}` }} />
                    </TableCell>
                    {canGestionar && <TableCell><Button size="small" variant="outlined" onClick={() => abrirPanel(r)} sx={{ textTransform: 'none', minWidth: 0 }}>Acciones</Button></TableCell>}
                    <TableCell>{str(r.codigo)}</TableCell>
                    <TableCell><Chip size="small" label={siglaPais(str(r.pais))} /></TableCell><TableCell>{str(r.zona)}</TableCell>
                    <TableCell><Chip size="small" label={str(r.pd_actual)} /></TableCell>
                    <TableCell>{str(r.campania_adeuda)}</TableCell>
                    <TableCell align="right">{money(Number(str(r.saldo_actual)))}</TableCell>
                    <TableCell align="right">{money(usdActualDeFila(r))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination component="div" count={cuentasFiltradas.length} page={page} onPageChange={(_e, p) => setPage(p)} rowsPerPage={rpp} onRowsPerPageChange={(e) => { setRpp(parseInt(e.target.value, 10)); setPage(0); }} rowsPerPageOptions={[25, 50, 100]} labelRowsPerPage="Filas" />
        </Paper>
      )}

      {tab === 1 && canVerCartas && (
        <Paper sx={{ mt: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
          {/* Barra de acciones masivas: solo cartas APROBADAS son
              seleccionables; la descarga queda inactiva/oculta sin selección. */}
          <Collapse in={selCartas.size > 0} unmountOnExit>
            <Box sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{selCartas.size.toLocaleString('en-US')} carta{selCartas.size === 1 ? '' : 's'} seleccionada{selCartas.size === 1 ? '' : 's'}</Typography>
              <Button size="small" variant="contained" disabled={descargaCartasBusy} onClick={() => void descargarCartasSeleccionadas()} sx={{ textTransform: 'none' }}>
                {descargaCartasBusy
                  ? `Preparando ${descargaCartasProgreso?.hecho ?? 0}/${descargaCartasProgreso?.total ?? selCartas.size}…`
                  : 'Descargar cartas'}
              </Button>
              <Button size="small" onClick={limpiarSeleccionCartas} disabled={descargaCartasBusy} sx={{ textTransform: 'none' }}>Limpiar selección</Button>
            </Box>
          </Collapse>
          <TableContainer sx={{ maxHeight: '65vh' }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={todasAprobadasSeleccionadas}
                      indeterminate={!todasAprobadasSeleccionadas && algunaAprobadaSeleccionada}
                      disabled={cartasAprobadas.length === 0}
                      onChange={toggleSeleccionarTodasCartas}
                      inputProps={{ 'aria-label': 'Seleccionar todas las cartas aprobadas' }}
                    />
                  </TableCell>
                  {['Código', 'PD', 'Estado', 'Comentario', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {cartas.map((c) => (
                  <TableRow key={c.id} hover selected={selCartas.has(c.id)}>
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={selCartas.has(c.id)}
                        disabled={c.estado !== 'APROBADA'}
                        onChange={() => toggleSelCarta(c.id)}
                        inputProps={{ 'aria-label': `Seleccionar carta ${c.codigo}` }}
                      />
                    </TableCell>
                    <TableCell>{c.codigo}</TableCell><TableCell>{c.pd ?? '—'}</TableCell>
                    <TableCell><Chip size="small" label={c.estado} color={c.estado === 'APROBADA' ? 'success' : c.estado === 'RECHAZADA' ? 'error' : 'warning'} variant="outlined" /></TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{c.comentario}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5}>
                        <Button size="small" onClick={() => { setCartaDetalle(null); getCartaDetalle(c.id).then(setCartaDetalle).catch((e) => setToast(e instanceof Error ? e.message : 'Error.')); }} sx={{ textTransform: 'none' }}>Ver</Button>
                        {canAprobar && c.estado === 'PENDIENTE_APROBACION' && <Button size="small" onClick={() => { setCartaSel(c); setCartaComent(''); }} sx={{ textTransform: 'none' }}>Revisar</Button>}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
                {cartas.length === 0 && <TableRow><TableCell colSpan={6} align="center" sx={{ py: 3, color: 'text.secondary' }}>Sin cartas.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {tab === tabTipificaciones && (
        <Stack spacing={2}>
          <DashboardFilters filters={filters} onChange={setFilters} onClear={() => setFilters(EMPTY_FILTERS)} options={opts} moneda={monedaFiltro} onMonedaChange={setMonedaFiltro} />

          {/* KPIs: cuentas únicas por código, nunca gestiones contadas como cuentas. */}
          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(5, minmax(0, 1fr))' } }}>
            {[
              { l: 'Total Cuentas', v: tipTotal.toLocaleString('en-US') },
              { l: 'Cuentas Con Gestión', v: tipCon.toLocaleString('en-US') },
              { l: 'Cuentas Sin Gestión', v: tipSin.toLocaleString('en-US') },
              { l: '% Cuentas Con Gestión', v: `${tipPctCon.toFixed(1)}%` },
              { l: '% Cuentas Sin Gestión', v: `${tipPctSin.toFixed(1)}%` }
            ].map((k) => (
              <Paper key={k.l} sx={{ p: 1.25, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'text.secondary' }}>{k.l}</Typography>
                <Typography sx={{ fontSize: 22, fontWeight: 800 }}>{k.v}</Typography>
              </Paper>
            ))}
          </Box>

          <Paper sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
            <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography sx={{ fontWeight: 700, mr: 0.5 }}>Tipificaciones</Typography>
                <TextField
                  select size="small" label="Tipificación" value={tipSelTip} disabled={tipEstado === 'SIN'}
                  SelectProps={{ multiple: true, renderValue: (v) => (v as string[]).length ? `${(v as string[]).length} seleccionada(s)` : 'Todas' }}
                  onChange={(e) => setTipSelTip(typeof e.target.value === 'string' ? e.target.value.split(',') : (e.target.value as unknown as string[]))}
                  sx={{ minWidth: 190 }}
                >
                  {catTip.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </TextField>
                <TextField select size="small" label="Estado de gestión" value={tipEstado} onChange={(e) => setTipEstado(e.target.value as 'TODOS' | 'CON' | 'SIN')} sx={{ minWidth: 150 }}>
                  <MenuItem value="TODOS">Todos</MenuItem>
                  <MenuItem value="CON">Con gestión</MenuItem>
                  <MenuItem value="SIN">Sin gestión</MenuItem>
                </TextField>
                <Button size="small" onClick={limpiarFiltrosTip} sx={{ textTransform: 'none' }}>Limpiar filtros</Button>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Button size="small" startIcon={<FileDownloadOutlinedIcon />} onClick={() => descargarDetalle(tipFiltradas, 'gestion_tipificaciones_cuentas', 'csv')} sx={{ textTransform: 'none' }}>CSV</Button>
                <Button size="small" startIcon={<FileDownloadOutlinedIcon />} onClick={() => descargarDetalle(tipFiltradas, 'gestion_tipificaciones_cuentas', 'xlsx')} sx={{ textTransform: 'none' }}>Excel</Button>
              </Box>
            </Box>
            <Alert severity="info" sx={{ mx: 1.5, mb: 1.5, py: 0.25, fontSize: 11.5, '& .MuiAlert-message': { fontSize: 11.5 } }}>
              Clasificación por última gestión registrada dentro del período seleccionado. Gestión no tiene (todavía) un filtro de fecha propio: el período considerado es el historial completo.
            </Alert>

            {tipLoading && <Box sx={{ p: 2 }}><CircularProgress size={20} /></Box>}

            {!tipLoading && tipEstado !== 'SIN' && (
              <TableContainer sx={{ maxHeight: '55vh' }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, width: 36 }} />
                      {([
                        { id: 'tipificacion', label: 'Tipificación' }, { id: 'cuentas', label: 'Cuentas' },
                        { id: 'saldoActual', label: 'Saldo Actual' }, { id: 'pctCuentas', label: '% Cuentas' },
                        { id: 'saldoPromesa', label: 'Saldo Promesa' }, { id: 'cuentasConPromesa', label: 'Cuentas Con Promesa' }
                      ] as const).map((col) => (
                        <TableCell key={col.id} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }} sortDirection={tipOrderBy === col.id ? tipOrder : false}>
                          <TableSortLabel active={tipOrderBy === col.id} direction={tipOrderBy === col.id ? tipOrder : 'asc'} onClick={() => handleSortTip(col.id)}>{col.label}</TableSortLabel>
                        </TableCell>
                      ))}
                      <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Cuentas Sin Promesa</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tipTablaOrdenada.map((g) => (
                      <Fragment key={g.tipificacion}>
                        <TableRow hover sx={{ cursor: 'pointer' }} onClick={() => toggle(expTip, g.tipificacion, setExpTip)}>
                          <TableCell><IconButton size="small">{expTip.has(g.tipificacion) ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}</IconButton></TableCell>
                          <TableCell>{g.tipificacion}</TableCell>
                          <TableCell align="right">{g.cuentas.toLocaleString('en-US')}</TableCell>
                          <TableCell align="right">{money(g.saldoActual)}</TableCell>
                          <TableCell align="right">{g.pctCuentas.toFixed(1)}%</TableCell>
                          <TableCell align="right">{g.saldoPromesa ? money(g.saldoPromesa) : '0.00'}</TableCell>
                          <TableCell align="right">{g.cuentasConPromesa}</TableCell>
                          <TableCell align="right">{g.cuentasSinPromesa}</TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Button size="small" startIcon={<FileDownloadOutlinedIcon />} onClick={() => descargarDetalle(g.filas, `gestion_tipificacion_${g.tipificacion}`, 'xlsx')} sx={{ textTransform: 'none', fontSize: 11 }}>Descargar cuentas</Button>
                          </TableCell>
                        </TableRow>
                        {expTip.has(g.tipificacion) && (
                          <TableRow>
                            <TableCell colSpan={9} sx={{ p: 0, borderBottom: 'none' }}>
                              <Collapse in unmountOnExit>
                                <Box sx={{ p: 1.5, bgcolor: 'action.hover' }}>
                                  <TableContainer sx={{ maxHeight: 320 }}>
                                    <Table size="small" stickyHeader>
                                      <TableHead><TableRow>{TIP_DETALLE_HEAD.map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: 10.5, whiteSpace: 'nowrap' }}>{h}</TableCell>)}</TableRow></TableHead>
                                      <TableBody>
                                        {g.filas.map((f) => (
                                          <TableRow key={f.codigo}>
                                            <TableCell sx={{ fontSize: 11 }}>{f.codigo}</TableCell>
                                            <TableCell sx={{ fontSize: 11 }}>{f.nombre}</TableCell>
                                            <TableCell sx={{ fontSize: 11 }}>{siglaPais(f.pais)}</TableCell>
                                            <TableCell sx={{ fontSize: 11 }}>{f.zona}</TableCell>
                                            <TableCell sx={{ fontSize: 11 }}>{f.gestor}</TableCell>
                                            <TableCell sx={{ fontSize: 11 }}><Chip size="small" label={f.pdActual} /></TableCell>
                                            <TableCell sx={{ fontSize: 11 }}>{f.campaniaAdeuda}</TableCell>
                                            <TableCell align="right" sx={{ fontSize: 11 }}>{money(f.saldoActual)}</TableCell>
                                            <TableCell sx={{ fontSize: 11 }}>{f.tipificacion ?? 'Sin gestión'}</TableCell>
                                            <TableCell sx={{ fontSize: 11, whiteSpace: 'nowrap' }}>{f.fechaGestion ? f.fechaGestion.slice(0, 16).replace('T', ' ') : '—'}</TableCell>
                                            <TableCell sx={{ fontSize: 11 }}>{f.fechaPromesa ?? '—'}</TableCell>
                                            <TableCell align="right" sx={{ fontSize: 11 }}>{f.montoPromesa !== null ? money(f.montoPromesa) : '—'}</TableCell>
                                            <TableCell sx={{ fontSize: 11 }}>{f.telefono ?? '—'}</TableCell>
                                            <TableCell sx={{ fontSize: 11 }}>{f.telefono ?? '—'}</TableCell>
                                            <TableCell title={f.comentarioGestion ?? undefined} sx={{ fontSize: 11, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.comentarioGestion ?? '—'}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                </Box>
                              </Collapse>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    ))}
                    {tipTablaOrdenada.length === 0 && <TableRow><TableCell colSpan={9} align="center" sx={{ py: 3, color: 'text.secondary' }}>Sin tipificaciones para los filtros actuales.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {/* Estado de gestión = "Sin gestión": listado plano de cuentas sin
                ninguna gestión registrada — "Sin gestión" es aquí SOLO una
                etiqueta visual de esta vista, nunca una tipificación real ni
                algo que se guarde en gestion_log. */}
            {!tipLoading && tipEstado === 'SIN' && (
              <TableContainer sx={{ maxHeight: '55vh' }}>
                <Table stickyHeader size="small">
                  <TableHead><TableRow>{['Código', 'Nombre', 'País', 'Zona', 'Gestor', 'PD', 'Campaña', 'Saldo Actual', 'Teléfono'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</TableCell>)}</TableRow></TableHead>
                  <TableBody>
                    {tipFiltradas.map((f) => (
                      <TableRow key={f.codigo} hover>
                        <TableCell>{f.codigo}</TableCell><TableCell>{f.nombre}</TableCell>
                        <TableCell>{siglaPais(f.pais)}</TableCell><TableCell>{f.zona}</TableCell><TableCell>{f.gestor}</TableCell>
                        <TableCell><Chip size="small" label={f.pdActual} /></TableCell><TableCell>{f.campaniaAdeuda}</TableCell>
                        <TableCell align="right">{money(f.saldoActual)}</TableCell><TableCell>{f.telefono ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                    {tipFiltradas.length === 0 && <TableRow><TableCell colSpan={9} align="center" sx={{ py: 3, color: 'text.secondary' }}>Sin cuentas sin gestión para los filtros actuales.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Stack>
      )}

      {/* Panel único: Información general + Detalle (izquierda), Historial + Gestión (derecha), dos columnas, sin tabs. */}
      <Dialog open={Boolean(panel)} onClose={() => setPanel(null)} maxWidth="lg" fullWidth sx={{ '& .MuiDialog-paper': { margin: '16px', maxHeight: 'calc(100% - 32px)' } }}>
        <DialogTitle sx={{ fontWeight: 700, py: 1.25 }}>Cuenta {cod} · {str(panel?.nombre)}</DialogTitle>
        <DialogContent dividers sx={{ py: 0.75 }}>
          {/* minmax(0, Xfr), no "Xfr" a secas: un track de grid sin el minmax
              hereda un mínimo "auto" = el ancho mínimo de su contenido: la tabla
              de historial (con columnas whiteSpace:nowrap) podía así robarle
              ancho a la columna izquierda en vez de recortarse ella misma. */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1.1fr)' }, gap: 2 }}>
            {/* ===== Columna izquierda: Información general + Detalle ===== */}
            <Stack spacing={1}>
              <Stack spacing={0.75}>
                <Typography sx={{ fontWeight: 800, fontSize: 14 }}>Información general</Typography>
                {!info ? <CircularProgress size={22} /> : (
                  <Stack spacing={0.75}>
                    <Typography sx={{ fontWeight: 700, fontSize: 12.5 }}>Datos generales</Typography>
                    {/* Un Field por celda (nunca agrupados en columnas verticales
                        desiguales): el grid empaqueta 4 por fila y usa el alto
                        mínimo real en vez de la altura de la columna más larga. */}
                    <Grid container spacing={0.75}>
                      <Grid item xs={3}><Field l="Sector" v={pick(info, ['sector'])} /></Grid>
                      <Grid item xs={3}><Field l="LOA" v={pick(info, ['loa', 'l_o_a'])} /></Grid>
                      <Grid item xs={3}><Field l="LOS" v={pick(info, ['los', 'l_o_s'])} /></Grid>
                      <Grid item xs={3}><Field l="Departamento" v={pick(info, ['departamento'])} /></Grid>
                      <Grid item xs={3}><Field l="Municipio" v={pick(info, ['municipio'])} /></Grid>
                      <Grid item xs={3}><Field l="Fecha de nacimiento" v={pick(info, ['fecha_de_nacimiento', 'fecha_nacimiento'])} /></Grid>
                      <Grid item xs={3}>
                        <Field l="Edad" v={pick(info, ['fecha_de_nacimiento', 'fecha_nacimiento']) === 'No disponible' ? 'No disponible' : edad(pick(info, ['fecha_de_nacimiento', 'fecha_nacimiento']))} />
                      </Grid>
                    </Grid>
                    <Divider />
                    <Typography sx={{ fontWeight: 700, fontSize: 12.5 }}>Contactos</Typography>
                    <Grid container spacing={0.75}>
                      <Grid item xs={3}><Field l="Teléfono celular" v={pick(info, ['telefono_celular', 'celular', 'telefono'])} /></Grid>
                      <Grid item xs={3}><Field l="Teléfono casa" v={pick(info, ['telefono_casa', 'casa'])} /></Grid>
                      <Grid item xs={3}><Field l="Teléfono trabajo" v={pick(info, ['telefono_trabajo', 'trabajo'])} /></Grid>
                      <Grid item xs={3}><Field l="Extensión" v={pick(info, ['extension_telefono_trabajo', 'extension'])} /></Grid>
                    </Grid>
                    <Divider />
                    <Typography sx={{ fontWeight: 700, fontSize: 12.5 }}>Referencias</Typography>
                    <Grid container spacing={0.75}>
                      <Grid item xs={4}><Field l="Nombre" v={pick(info, ['nombre_referencia', 'referencia', 'referencia_nombre'])} /></Grid>
                      <Grid item xs={4}><Field l="Teléfono 1" v={pick(info, ['telefono_referencia_1', 'referencia_telefono_1'])} /></Grid>
                      <Grid item xs={4}><Field l="Teléfono 2" v={pick(info, ['telefono_referencia_2', 'referencia_telefono_2'])} /></Grid>
                    </Grid>
                    <Divider />
                    <Typography sx={{ fontWeight: 700, fontSize: 12.5 }}>Gestión asignada</Typography>
                    <Grid container spacing={0.75}>
                      <Grid item xs={4}><Field l="Gerente de zona" v={pick(info, ['gerente_zona'])} /></Grid>
                      <Grid item xs={4}><Field l="Contacto gerente" v={pick(info, ['contacto_gerente', 'telefono_gerente'])} /></Grid>
                      <Grid item xs={4}><Field l="Gestor" v={pick(info, ['gestor'])} /></Grid>
                    </Grid>
                  </Stack>
                )}
              </Stack>

              <Divider />

              {/* Detalle de cuenta: datos de la propia fila (cartera) + último estado ya
                  cargado por la tabla (getEstadoCuentas), sin ninguna consulta nueva. */}
              <Stack spacing={0.75}>
                <Typography sx={{ fontWeight: 800, fontSize: 14 }}>Detalle</Typography>
                <Grid container spacing={0.75}>
                  <Grid item xs={3}><Field l="Cuenta" v={cod} /></Grid>
                  <Grid item xs={3}><Field l="PD" v={cobroPD} /></Grid>
                  <Grid item xs={3}><Field l="País" v={str(panel?.pais) || 'No disponible'} /></Grid>
                  <Grid item xs={3}><Field l="Zona" v={str(panel?.zona) || 'No disponible'} /></Grid>
                  <Grid item xs={3}><Field l="Saldo local" v={money(Number(str(panel?.saldo_actual)))} /></Grid>
                  <Grid item xs={3}><Field l="Saldo USD" v={panel ? money(usdActualDeFila(panel)) : '—'} /></Grid>
                  <Grid item xs={3}><Field l="Campaña" v={str(panel?.campania_adeuda) || 'No disponible'} /></Grid>
                  <Grid item xs={3}><Field l="Moneda" v={monedaCuenta} /></Grid>
                  <Grid item xs={3}><Field l="Última tipificación" v={estado[cod]?.ultimaTipificacion || 'No disponible'} /></Grid>
                </Grid>
              </Stack>
            </Stack>

            {/* ===== Columna derecha: Historial de gestión + Gestión ===== */}
            <Stack spacing={1}>
              <Stack spacing={0.75}>
                <Typography sx={{ fontWeight: 800, fontSize: 14 }}>Historial de gestión</Typography>
                {!detalle ? <CircularProgress size={22} /> : (
                  <Stack spacing={0.75}>
                    {promVigente && (
                      <Alert severity="info" sx={{ py: 0.25, fontSize: 11.5, '& .MuiAlert-message': { fontSize: 11.5 } }}>
                        Promesa: <strong>{str(promVigente.fecha_promesa)}</strong> · Monto {str(promVigente.monto) || '—'} · Estado {str(promVigente.estado)}
                      </Alert>
                    )}
                    {/* Sin scroll interno propio ni tope de alto: filas compactas (fontSize
                        11) para que quepan en el flujo normal de la columna. Nunca se
                        recortan registros — se muestra el historial completo. */}
                    <TableContainer>
                      <Table size="small">
                        <TableHead><TableRow>{['Tipificación', 'Fecha', 'Gestor', 'Contacto', 'Canal', 'Observación'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: 10.5, py: 0.25 }}>{h}</TableCell>)}</TableRow></TableHead>
                        <TableBody>
                          {detalle.historial.length === 0 && <TableRow><TableCell colSpan={6} align="center" sx={{ py: 0.75, fontSize: 11.5, color: 'text.secondary' }}>Sin gestiones.</TableCell></TableRow>}
                          {detalle.historial.map((h, i) => (
                            <TableRow key={i}>
                              <TableCell sx={{ fontSize: 11, py: 0.25 }}>{str(h.tipificacion)}</TableCell>
                              <TableCell sx={{ fontSize: 11, py: 0.25, whiteSpace: 'nowrap' }}>{str(h.created_at).slice(0, 16).replace('T', ' ')}</TableCell>
                              <TableCell sx={{ fontSize: 11, py: 0.25 }}>{str(h.gestor_id) || 'No disponible'}</TableCell>
                              <TableCell sx={{ fontSize: 11, py: 0.25 }}>{str(h.tipo_contacto) || 'No disponible'}</TableCell>
                              <TableCell sx={{ fontSize: 11, py: 0.25 }}>{str(h.canal) || 'No disponible'}</TableCell>
                              {/* Observación: texto completo disponible al pasar el cursor
                                  (title) — nunca se elimina, solo se recorta visualmente a 1
                                  línea para que el historial no dispare la altura de la fila. */}
                              <TableCell title={str(h.comentario) || undefined} sx={{ fontSize: 11, py: 0.25, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{str(h.comentario) || '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Stack>
                )}
              </Stack>

              <Divider />

              <Stack spacing={0.5}>
                <Typography sx={{ fontWeight: 800, fontSize: 13 }}>Gestión</Typography>
                <Stack direction="row" spacing={1.25}>
                  <TextField select label="Tipo de contacto" value={gForm.tipoContacto} onChange={(e) => setGForm({ ...gForm, tipoContacto: e.target.value })} size="small" fullWidth InputLabelProps={{ sx: { fontSize: 12 } }} InputProps={{ sx: { fontSize: 12 } }}>
                    {catTC.map((t) => <MenuItem key={t} value={t} sx={{ fontSize: 12 }}>{t}</MenuItem>)}
                  </TextField>
                  <TextField select label="Canal" value={gForm.canal} onChange={(e) => setGForm({ ...gForm, canal: e.target.value })} size="small" fullWidth InputLabelProps={{ sx: { fontSize: 12 } }} InputProps={{ sx: { fontSize: 12 } }}>
                    {catCanal.map((t) => <MenuItem key={t} value={t} sx={{ fontSize: 12 }}>{t}</MenuItem>)}
                  </TextField>
                </Stack>
                <Divider />
                <Typography sx={{ fontWeight: 700, fontSize: 11.5 }}>Tipificación *</Typography>
                <TextField select label="Tipificación" value={gForm.tip} onChange={(e) => setGForm({ ...gForm, tip: e.target.value })} size="small" fullWidth InputLabelProps={{ sx: { fontSize: 12 } }} InputProps={{ sx: { fontSize: 12 } }}>
                  {catTip.map((t) => <MenuItem key={t} value={t} sx={{ fontSize: 12 }}>{t}</MenuItem>)}
                </TextField>
                <TextField label="Comentario" value={gForm.tipCom} onChange={(e) => setGForm({ ...gForm, tipCom: e.target.value })} size="small" fullWidth multiline minRows={1} InputLabelProps={{ sx: { fontSize: 12 } }} InputProps={{ sx: { fontSize: 12 } }} />

                {/* Promesa de pago: solo si la tipificación es PROMESA DE PAGO; fecha y monto obligatorios en moneda local */}
                {esPromesa && (
                  <Paper variant="outlined" sx={{ p: 0.75, borderRadius: 2 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: 11.5, mb: 0.5 }}>Promesa de pago (obligatoria)</Typography>
                    <Stack direction="row" spacing={1.25}>
                      <TextField label="Fecha de promesa" type="date" required value={gForm.fechaProm} onChange={(e) => setGForm({ ...gForm, fechaProm: e.target.value })} size="small" fullWidth InputLabelProps={{ shrink: true, sx: { fontSize: 12 } }} InputProps={{ sx: { fontSize: 12 } }} error={!gForm.fechaProm} />
                      <TextField label={`Monto (${monedaCuenta})`} type="number" required value={gForm.montoProm} onChange={(e) => setGForm({ ...gForm, montoProm: e.target.value })} size="small" fullWidth
                        error={Boolean(gForm.montoProm) && !(montoPromNum > 0)}
                        helperText={Boolean(gForm.montoProm) && !(montoPromNum > 0) ? 'El monto debe ser mayor que 0.' : `Moneda local: ${monedaCuenta}`}
                        FormHelperTextProps={{ sx: { fontSize: 10 } }}
                        InputLabelProps={{ sx: { fontSize: 12 } }} InputProps={{ sx: { fontSize: 12 }, inputProps: { min: 0, step: '0.01' } }} />
                    </Stack>
                  </Paper>
                )}
                <Button variant="contained" size="small" disabled={!canGestionar || busy || !gForm.tip || !promesaValida || (esPromesa && !canPromesa)} onClick={registrarGestion} sx={{ textTransform: 'none', fontSize: 12 }}>Registrar gestión{esPromesa ? ' + promesa' : ''}</Button>

                <Divider />
                {/* Carta y Adjunto, lado a lado: mismo contenido/acciones que antes,
                    solo compactados en dos sub-columnas para evitar scroll vertical. */}
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25 }}>
                  <Stack spacing={0.5}>
                    <Typography sx={{ fontWeight: 700, fontSize: 11.5 }}>Carta (opcional)</Typography>
                    {/* La plantilla la decide ÚNICAMENTE el PD actual de la cuenta (backend,
                        ver getCartaPreview) — el Gestor nunca elige manualmente una plantilla
                        de otro PD; PD0 no tiene carta disponible. */}
                    {cartaPreview?.disponible ? (
                      <Button variant="outlined" size="small" disabled={!canCarta || busy} onClick={() => setCartaPrevOpen(true)} sx={{ textTransform: 'none', fontSize: 11.5 }}>
                        Generar carta ({cartaPreview.pd}) — vista previa
                      </Button>
                    ) : (
                      <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                        {cartaPreview === null ? 'Cargando…' : `Sin plantilla de carta para ${cartaPreview.pd ?? 'este PD'}.`}
                      </Typography>
                    )}
                  </Stack>
                  <Stack spacing={0.5}>
                    <Typography sx={{ fontWeight: 700, fontSize: 11.5 }}>Adjunto (opcional)</Typography>
                    <TextField select label="Tipo de documento" value={gForm.adjTipo} onChange={(e) => setGForm({ ...gForm, adjTipo: e.target.value })} size="small" fullWidth InputLabelProps={{ sx: { fontSize: 12 } }} InputProps={{ sx: { fontSize: 12 } }}>
                      {['Carta recibida por la representante', 'Boleta de pago', 'Acuerdo de pago', 'Otro documento'].map((t) => <MenuItem key={t} value={t} sx={{ fontSize: 12 }}>{t}</MenuItem>)}
                    </TextField>
                    <Button variant="outlined" size="small" component="label" sx={{ textTransform: 'none', fontSize: 11.5 }}>{adjFile ? adjFile.name : 'Seleccionar archivo'}<input hidden type="file" onChange={(e) => setAdjFile(e.target.files?.[0] ?? null)} /></Button>
                    <Button variant="outlined" size="small" disabled={!canAdjunto || busy || !adjFile} onClick={() => adjFile && accion(() => subirAdjunto(cod, gForm.adjTipo, adjFile), 'Adjunto subido.')} sx={{ textTransform: 'none', fontSize: 11.5 }}>Subir adjunto</Button>
                  </Stack>
                </Box>
              </Stack>
            </Stack>
          </Box>
        </DialogContent>
        <DialogActions><Button onClick={() => setPanel(null)} sx={{ textTransform: 'none' }}>Cerrar</Button></DialogActions>
      </Dialog>

      {/* Vista previa de carta antes de enviar a aprobación: SIEMPRE sin logo/
          firma (nada está autorizado todavía — ver CartaRenderer/estado). */}
      <Dialog open={cartaPrevOpen} onClose={() => setCartaPrevOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Vista previa · {cartaPreview?.pd}</DialogTitle>
        <DialogContent dividers>
          <Chip size="small" color="warning" variant="outlined" label="Pendiente de autorización" sx={{ mb: 1.5 }} />
          {cartaPreview?.contenido && <CartaRenderer contenido={cartaPreview.contenido} logoUrl={null} firmaUrl={null} />}
          <TextField label="Comentario (opcional)" value={gForm.cartaCom} onChange={(e) => setGForm({ ...gForm, cartaCom: e.target.value })} size="small" fullWidth multiline minRows={2} sx={{ mt: 2 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCartaPrevOpen(false)} sx={{ textTransform: 'none' }}>Cancelar</Button>
          <Button variant="contained" disabled={busy} onClick={() => { setCartaPrevOpen(false); void accion(() => crearCarta(cod, gForm.cartaCom), 'Carta enviada a aprobación.'); }} sx={{ textTransform: 'none' }}>Confirmar y enviar</Button>
        </DialogActions>
      </Dialog>

      {/* Generar cartas por lote (Cuentas: selección múltiple). Sin vista
          previa EN VIVO (las cuentas seleccionadas pueden tener PD/plantillas
          distintas) — el backend decide, cuenta por cuenta, la plantilla
          según su PD actual, exactamente igual que la generación individual. */}
      <Dialog open={loteCartaOpen} onClose={() => { if (!loteCartaBusy) setLoteCartaOpen(false); }} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Generar cartas · {selCuentas.size} cuenta{selCuentas.size === 1 ? '' : 's'} seleccionada{selCuentas.size === 1 ? '' : 's'}</DialogTitle>
        <DialogContent dividers>
          <Typography sx={{ fontSize: 13, mb: 1.5 }}>
            Se generará una carta para cada cuenta seleccionada que tenga plantilla disponible según su PD actual.
            Las cuentas sin plantilla, sin alcance, o con una carta no disponible no se generarán, y el motivo de
            cada una se mostrará al finalizar.
          </Typography>
          <TextField label="Comentario (opcional, aplica a todas)" value={loteCartaComent} onChange={(e) => setLoteCartaComent(e.target.value)} size="small" fullWidth multiline minRows={2} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLoteCartaOpen(false)} disabled={loteCartaBusy} sx={{ textTransform: 'none' }}>Cancelar</Button>
          <Button variant="contained" disabled={loteCartaBusy || selCuentas.size === 0} onClick={() => void generarCartasMasivo()} sx={{ textTransform: 'none' }}>
            {loteCartaBusy ? <><CircularProgress size={14} sx={{ mr: 1 }} />Generando…</> : 'Confirmar y generar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Resultado del lote: nunca un éxito falso — siempre indica cuántas
          se generaron y, por cada una que no, el motivo REAL devuelto por
          el backend (nunca inventado aquí). */}
      <Dialog open={Boolean(loteCartaResultado)} onClose={() => setLoteCartaResultado(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Resultado de la generación</DialogTitle>
        <DialogContent dividers>
          {loteCartaResultado && (
            <Stack spacing={1.5}>
              <Alert severity={loteCartaResultado.noGeneradas === 0 ? 'success' : loteCartaResultado.generadas === 0 ? 'error' : 'warning'}>
                {loteCartaResultado.total} seleccionada{loteCartaResultado.total === 1 ? '' : 's'} / {loteCartaResultado.generadas} carta{loteCartaResultado.generadas === 1 ? '' : 's'} generada{loteCartaResultado.generadas === 1 ? '' : 's'} / {loteCartaResultado.noGeneradas} no generada{loteCartaResultado.noGeneradas === 1 ? '' : 's'}
              </Alert>
              {loteCartaResultado.detalle.noGeneradas.length > 0 && (
                <Box>
                  <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 0.5 }}>No generadas:</Typography>
                  <Stack spacing={0.5}>
                    {loteCartaResultado.detalle.noGeneradas.map((n) => (
                      <Typography key={n.codigo} sx={{ fontSize: 12.5 }}>
                        <strong>{n.codigo}</strong> — {n.motivo}
                      </Typography>
                    ))}
                  </Stack>
                </Box>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => { setLoteCartaResultado(null); if (tab === 1) getCartas().then(setCartas).catch(() => undefined); }} sx={{ textTransform: 'none' }}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      {/* Resultado de la descarga masiva (Cartas: selección múltiple):
          nunca un éxito falso — siempre indica cuántas se descargaron y,
          por cada una que no, el motivo REAL (del backend o de un fallo de
          render puntual), nunca inventado. */}
      <Dialog open={Boolean(descargaCartasResultado)} onClose={() => setDescargaCartasResultado(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Resultado de la descarga</DialogTitle>
        <DialogContent dividers>
          {descargaCartasResultado && (
            <Stack spacing={1.5}>
              <Alert severity={descargaCartasResultado.noDescargadas.length === 0 ? 'success' : descargaCartasResultado.descargadas === 0 ? 'error' : 'warning'}>
                {descargaCartasResultado.total} seleccionada{descargaCartasResultado.total === 1 ? '' : 's'} / {descargaCartasResultado.descargadas} descargada{descargaCartasResultado.descargadas === 1 ? '' : 's'}
                {descargaCartasResultado.noDescargadas.length > 0 ? ` / ${descargaCartasResultado.noDescargadas.length} no disponible${descargaCartasResultado.noDescargadas.length === 1 ? '' : 's'}` : ''}
              </Alert>
              {descargaCartasResultado.noDescargadas.length > 0 && (
                <Box>
                  <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 0.5 }}>No disponibles:</Typography>
                  <Stack spacing={0.5}>
                    {descargaCartasResultado.noDescargadas.map((n, i) => (
                      <Typography key={`${n.codigo}-${i}`} sx={{ fontSize: 12.5 }}>
                        <strong>{n.codigo || '(sin código)'}</strong> — {n.motivo}
                      </Typography>
                    ))}
                  </Stack>
                </Box>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setDescargaCartasResultado(null)} sx={{ textTransform: 'none' }}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      {/* Revisar carta (Supervisor): el contenido ya viene en la fila listada
          (listarCartas devuelve la fila completa) — sin logo/firma porque
          todavía no está autorizada. */}
      <Dialog open={Boolean(cartaSel)} onClose={() => setCartaSel(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Revisar carta · {cartaSel?.pd}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography sx={{ fontSize: 13 }}>Cuenta {cartaSel?.codigo}</Typography>
            {cartaSel?.contenido && <CartaRenderer contenido={cartaSel.contenido} logoUrl={null} firmaUrl={null} />}
            <TextField label="Comentario" value={cartaComent} onChange={(e) => setCartaComent(e.target.value)} size="small" fullWidth multiline minRows={2} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button color="error" onClick={async () => { if (cartaSel) { await rechazarCarta(cartaSel.id, cartaComent); setCartaSel(null); setToast('Carta rechazada.'); getCartas().then(setCartas); } }} sx={{ textTransform: 'none' }}>Rechazar</Button>
          <Button variant="contained" onClick={async () => { if (cartaSel) { await aprobarCarta(cartaSel.id, cartaComent); setCartaSel(null); setToast('Carta aprobada.'); getCartas().then(setCartas); } }} sx={{ textTransform: 'none' }}>Aprobar</Button>
        </DialogActions>
      </Dialog>

      {/* Ver / descargar una carta puntual: logo/firma y "Descargar" SOLO si
          el backend marcó `descargable` (estado === 'APROBADA') — nunca por
          un flag local, así que ni manipulando el estado del cliente se
          puede saltar la autorización. */}
      <Dialog open={Boolean(cartaDetalle)} onClose={() => setCartaDetalle(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Carta · {cartaDetalle?.codigo} · {cartaDetalle?.pd}</DialogTitle>
        <DialogContent dividers>
          {!cartaDetalle?.descargable && <Chip size="small" color="warning" variant="outlined" label="Pendiente de autorización" sx={{ mb: 1.5 }} />}
          {cartaDetalle?.contenido && (
            <CartaRenderer ref={cartaRenderRef} contenido={cartaDetalle.contenido} logoUrl={cartaDetalle.logoUrl} firmaUrl={cartaDetalle.firmaUrl} />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCartaDetalle(null)} sx={{ textTransform: 'none' }}>Cerrar</Button>
          <Button
            variant="contained"
            disabled={!cartaDetalle?.descargable}
            onClick={() => cartaRenderRef.current && descargarCartaPdf(cartaRenderRef.current, `Carta_${cartaDetalle?.codigo}_${cartaDetalle?.pd}`)}
            sx={{ textTransform: 'none' }}
          >
            Descargar Carta
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(toast)} autoHideDuration={3500} onClose={() => setToast(null)} message={toast ?? ''} />
    </Box>
  );
};

const Field = ({ l, v }: { l: string; v: string }) => (
  <Box sx={{ mb: 0.75 }}>
    <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase' }}>{l}</Typography>
    <Typography sx={{ fontSize: 12.5 }}>{v}</Typography>
  </Box>
);

export default GestionPage;
