import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, Grid, Paper, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography
} from '@mui/material';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import KpiCards from '../components/Dashboard/KpiCards';
import DashboardFilters from '../components/Dashboard/DashboardFilters';
import OnePagePreviewDialog from '../components/Dashboard/OnePagePreviewDialog';
import { exportRowsToCsv } from '../utils/tableExport';
import { useTasasConversion } from '../hooks/useTasasConversion';
import { MONEDA_OPTIONS } from '../utils/monedaOptions';
import { getCentroInteligencia, type CentroFiltros, type CentroInteligencia } from '../services/inteligenciaService';
import type { DashboardKpi, DashboardMultiFilterParams } from '../types/cartera';

const EMPTY_FILTROS: DashboardMultiFilterParams = { pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] };

/** DashboardFilters expone los mismos 6 campos que el Dashboard (país/gestor/gerente/zona/
 *  pd/campaña), pero el backend de Centro de Inteligencia (CentroFiltros) solo entiende
 *  país/zona/pd/gestor. Gerente y campaña quedan visibles en el filtro (mismo componente,
 *  mismo comportamiento) pero no tienen efecto aquí al no existir en este backend. */
const toCentroFiltros = (f: DashboardMultiFilterParams): CentroFiltros => ({
  pais: f.pais, zona: f.zona, pd: f.pd, gestor: f.gestor
});

const money = (v: number | null, code = 'USD') =>
  v === null || v === undefined ? '—'
    : code === 'USD' ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : `${v.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${code}`;
const pctTxt = (v: number | null) => (v === null || v === undefined ? '—' : `${v}%`);

const NIVEL_COLOR: Record<string, 'error' | 'warning' | 'info' | 'success'> = {
  'Crítico': 'error', 'Atención': 'warning', 'Informativo': 'info', 'Positivo': 'success'
};

const Mini = ({ l, v, sub, color }: { l: string; v: string; sub?: string; color?: string }) => (
  <Paper sx={{ p: 1.25, borderRadius: 2, border: '1px solid', borderColor: 'divider', height: '100%' }}>
    <Typography sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary' }}>{l}</Typography>
    <Typography sx={{ fontSize: 18, fontWeight: 800, color: color ?? 'text.primary' }}>{v}</Typography>
    {sub && <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{sub}</Typography>}
  </Paper>
);

/** Tabla de meta por segmento (país/PD/gestor): réplica en formato TABLA (sin gráficos)
 *  de la hoja VISUAL del Excel. `montoUsd` llega en USD desde el backend; se convierte
 *  aquí con la MISMA tasa (useTasasConversion) que usan los KPIs. `pct` nunca se convierte. */
const MetaTable = ({ titulo, columna, rows, convMoneda, monedaLabel }: {
  titulo: string; columna: string; rows: Array<{ clave: string; montoUsd: number | null; pct: number | null }>;
  convMoneda: (v: number | null) => number | null; monedaLabel: string;
}) => (
  <>
    <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 0.5 }}>{titulo}</Typography>
    <TableContainer sx={{ maxHeight: 280, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Table size="small" stickyHeader>
        <TableHead><TableRow>{[columna, 'Meta', '%'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={3} align="center" sx={{ py: 2, color: 'text.secondary', fontSize: 12 }}>Sin datos disponibles.</TableCell></TableRow>
          ) : rows.map((r) => (
            <TableRow key={r.clave} hover>
              <TableCell sx={{ fontSize: 12 }}>{r.clave}</TableCell>
              <TableCell align="right" sx={{ fontSize: 12 }}>{money(convMoneda(r.montoUsd), monedaLabel)}</TableCell>
              <TableCell align="right" sx={{ fontSize: 12 }}>{pctTxt(r.pct)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  </>
);

const BarList = <T extends { clave: string; cuentas?: number }>({ title, items, valueOf, code, empty }: {
  title: string; items: T[]; valueOf: (x: T) => number; code: string; empty: string;
}) => {
  const max = Math.max(1, ...items.map((x) => valueOf(x)));
  return (
    <Paper sx={{ p: 1.5, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
      <Typography sx={{ fontWeight: 700, mb: 1 }}>{title}</Typography>
      {items.length === 0 ? <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{empty}</Typography> : (
        <Stack spacing={0.5} sx={{ maxHeight: 240, overflowY: 'auto' }}>
          {items.slice(0, 20).map((x) => (
            <Box key={x.clave} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 120, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.clave}</Box>
              <Tooltip arrow title={`${x.clave}: ${money(valueOf(x), code)}${x.cuentas !== undefined ? ` · ${x.cuentas} cuentas` : ''}`}>
                <Box sx={{ flex: 1, bgcolor: 'action.hover', borderRadius: 1, height: 14, minWidth: 50 }}>
                  <Box sx={{ width: `${Math.max(2, (valueOf(x) / max) * 100)}%`, bgcolor: '#1E3A8A', height: '100%', borderRadius: 1 }} />
                </Box>
              </Tooltip>
              <Box sx={{ width: 130, textAlign: 'right', fontSize: 11, whiteSpace: 'nowrap' }}>{money(valueOf(x), code)}</Box>
            </Box>
          ))}
        </Stack>
      )}
    </Paper>
  );
};

const InteligenciaPage = () => {
  const [filtros, setFiltros] = useState<DashboardMultiFilterParams>(EMPTY_FILTROS);
  const [data, setData] = useState<CentroInteligencia | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Moneda: mismo campo del MISMO filtro que el Dashboard (DashboardFilters), misma fuente
  // de tasas oficiales (useTasasConversion) — no un control de moneda aparte.
  const [monedaFiltro, setMonedaFiltro] = useState<string>('USD');
  const { tasas, error: tasasError } = useTasasConversion();
  const inteligenciaRootRef = useRef<HTMLDivElement | null>(null);
  const [onePagePreviewOpen, setOnePagePreviewOpen] = useState(false);

  const cargar = async (f: DashboardMultiFilterParams) => {
    setLoading(true); setError(null);
    try { setData(await getCentroInteligencia(toCentroFiltros(f))); }
    catch (e) { setError(e instanceof Error ? e.message : 'No fue posible cargar el Centro de Inteligencia.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void cargar(filtros); /* eslint-disable-next-line */ }, [filtros]);

  // DashboardFilters requiere los 6 campos del Dashboard; gerente/campaña no existen en
  // el backend de Centro de Inteligencia, por lo que se muestran vacíos (sin datos).
  const opts = {
    pais: data?.filterOptions.pais ?? [], gestor: data?.filterOptions.gestor ?? [], gerente: [] as string[],
    zona: data?.filterOptions.zona ?? [], pd: data?.filterOptions.pd ?? [], campania: [] as string[]
  };
  // Misma lógica del Dashboard: la tasa configurada (Configuración > Tasas de Conversión)
  // se aplica siempre a la moneda seleccionada, sin excepción para USD.
  const monedaOption = MONEDA_OPTIONS.find((option) => option.code === monedaFiltro) ?? MONEDA_OPTIONS[0];
  const monedaCode = monedaOption.code;
  const monedaLabel = monedaCode;
  const tasaDisponible = tasas[monedaCode] !== undefined;
  const tasaActual = tasaDisponible ? tasas[monedaCode] : 1;

  const kpisDisplay: DashboardKpi | null = useMemo(() => {
    if (!data) return null;
    const k = data.kpis;
    return {
      saldoAsignado: k.saldoAsignadoUsd * tasaActual,
      saldoActual: k.saldoActualUsd * tasaActual,
      recuperado: k.recuperadoUsd * tasaActual,
      porcentajeRecuperacion: k.pctRecuperacion,
      totalCuentas: k.cuentas
    };
  }, [data, tasaActual]);

  // Conversión de moneda para las metas: misma tasa (tasaActual) que ya usan los KPIs.
  // La META % NUNCA se convierte (es adimensional); solo los montos.
  const convMoneda = (v: number | null) => (v === null ? null : v * tasaActual);

  const hallazgosPorCategoria = useMemo(() => {
    const m = new Map<string, CentroInteligencia['hallazgos']>();
    (data?.hallazgos ?? []).forEach((h) => { const it = m.get(h.categoria) ?? []; it.push(h); m.set(h.categoria, it); });
    return [...m.entries()];
  }, [data]);

  if (loading && !data) return <Box sx={{ display: 'flex', gap: 1.5, p: 3, alignItems: 'center' }}><CircularProgress size={22} /><Typography sx={{ fontSize: 14 }}>Cargando Centro de Inteligencia...</Typography></Box>;
  if (error) return <Box sx={{ p: 2 }}><Alert severity="error">{error}</Alert></Box>;
  if (!data || !kpisDisplay) return <Box sx={{ p: 2 }}><Typography>Sin datos disponibles.</Typography></Box>;

  return (
    <>
    <Box ref={inteligenciaRootRef} sx={{ p: { xs: 1, md: 2 } }}>
      <Stack spacing={2}>
        {/* 1 · Encabezado + filtros (mismo componente Filtro anclado en el sidebar que usan
            Dashboard/Gestión/Control Operativo — DashboardFilters se porta al mismo slot) */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
          <Box>
            <Typography sx={{ fontSize: 20, fontWeight: 800 }}>Centro de Inteligencia</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Período {data.periodo} · {data.dias.transcurridos}/{data.dias.total} días · {data.dias.restantes} restantes</Typography>
          </Box>
          <Box data-onepage-skip="true">
            <Button variant="outlined" startIcon={<DescriptionOutlinedIcon />} onClick={() => setOnePagePreviewOpen(true)} sx={{ textTransform: 'none' }}>Generar OnePage</Button>
          </Box>
        </Box>

        <DashboardFilters
          filters={filtros}
          onChange={setFiltros}
          onClear={() => setFiltros(EMPTY_FILTROS)}
          options={opts}
          moneda={monedaFiltro}
          onMonedaChange={setMonedaFiltro}
        />
        {(tasasError || !tasaDisponible) && (
          <Alert severity="warning">
            No se pudo obtener la tasa oficial de {monedaCode} desde Configuración. Los valores mostrados pueden no reflejar la tasa configurada.
          </Alert>
        )}

        {/* 2 · KPIs principales */}
        <KpiCards kpis={kpisDisplay} moneda={monedaLabel} />
        <Grid container spacing={1.5}>
          <Grid item xs={6} sm={4} md={2}><Mini l="Meta" v={data.meta.definida ? money(convMoneda(data.meta.montoUsd), monedaLabel) : 'No definida'} sub={data.meta.definida ? `${((data.meta.porcentaje ?? 0) * 100).toFixed(2)}%` : undefined} /></Grid>
          <Grid item xs={6} sm={4} md={2}><Mini l="% Cumplimiento" v={data.cumplimiento.pct === null ? 'Meta no definida' : pctTxt(data.cumplimiento.pct)} /></Grid>
          <Grid item xs={6} sm={4} md={2}><Mini l="Promesado" v={money(data.promesas.totalUsd)} sub={`${data.promesas.cantidad} promesas`} /></Grid>
          <Grid item xs={6} sm={4} md={2}><Mini l="Proyección recup." v={money(data.proyeccion.recuperacionProyectadaUsd)} sub={`ritmo ${money(data.proyeccion.ritmoDiarioUsd)}/día`} /></Grid>
          <Grid item xs={6} sm={4} md={2}><Mini l="Proyección cumpl." v={data.proyeccion.cumplimientoProyectadoPct === null ? 'Sin meta' : pctTxt(data.proyeccion.cumplimientoProyectadoPct)} sub={data.proyeccion.estado} color={data.proyeccion.cumplimientoProyectadoPct === null ? undefined : data.proyeccion.cumplimientoProyectadoPct >= 100 ? '#22C55E' : data.proyeccion.cumplimientoProyectadoPct >= 90 ? '#F59E0B' : '#EF4444'} /></Grid>
          <Grid item xs={6} sm={4} md={2}><Mini l="Calidad global" v={data.calidad.notaGlobal !== null && data.calidad.evaluaciones > 0 ? `${data.calidad.notaGlobal}/100` : 'Sin evaluaciones'} sub={data.calidad.evaluaciones > 0 ? `${data.calidad.evaluaciones} eval.` : undefined} /></Grid>
        </Grid>

        {/* 3 · Meta vs recuperación */}
        <Paper sx={{ p: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
          <Typography sx={{ fontWeight: 700, mb: 1 }}>Meta vs Recuperación</Typography>
          {!data.meta.definida ? (
            <Alert severity="info" sx={{ py: 0.5 }}>Meta no definida para el contexto actual. Configura metas para habilitar comparación y proyección de cumplimiento.</Alert>
          ) : (
            <Stack spacing={1}>
              {([['Meta', data.meta.montoUsd ?? 0, '#94A3B8'], ['Recuperado', data.kpis.recuperadoUsd, '#22C55E'], ['Proyección', data.proyeccion.recuperacionProyectadaUsd, '#1E3A8A']] as Array<[string, number, string]>).map(([l, val, col]) => {
                const mx = Math.max(1, data.meta.montoUsd ?? 0, data.kpis.recuperadoUsd, data.proyeccion.recuperacionProyectadaUsd);
                return (
                  <Box key={l} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ width: 110, fontSize: 12, fontWeight: 600 }}>{l}</Box>
                    <Box sx={{ flex: 1, bgcolor: 'action.hover', borderRadius: 1, height: 16 }}><Box sx={{ width: `${Math.max(2, (val / mx) * 100)}%`, bgcolor: col, height: '100%', borderRadius: 1 }} /></Box>
                    <Box sx={{ width: 130, textAlign: 'right', fontSize: 12 }}>{money(val)}</Box>
                  </Box>
                );
              })}
            </Stack>
          )}
        </Paper>

        {/* 3.b · Metas: resumen + tablas por país/PD/gestor (réplica de la hoja VISUAL del Excel,
            en formato tabla — sin gráficos). La meta % es fija (configurada en Configuración >
            Metas); el saldo/monto siempre corresponde al universo visible (alcance del usuario +
            filtros aplicados), y cada fila se distribuye proporcionalmente a su saldo inicial. */}
        <Paper sx={{ p: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
          <Typography sx={{ fontWeight: 700, mb: 1 }}>Metas</Typography>
          {!data.meta.definida ? (
            <Alert severity="info" sx={{ py: 0.5 }}>Meta no definida. Configúrala en Configuración &gt; Metas.</Alert>
          ) : (
            <Stack spacing={2}>
              <Grid container spacing={1.5}>
                <Grid item xs={12} sm={4}><Mini l="Total Saldo Inicial" v={money(convMoneda(data.meta.totalSaldoInicialUsd), monedaLabel)} /></Grid>
                <Grid item xs={12} sm={4}><Mini l="Meta %" v={`${((data.meta.porcentaje ?? 0) * 100).toFixed(2)}%`} /></Grid>
                <Grid item xs={12} sm={4}><Mini l="Meta Monto" v={money(convMoneda(data.meta.montoUsd), monedaLabel)} /></Grid>
              </Grid>
              <Grid container spacing={2}>
                <Grid item xs={12} md={4}>
                  <MetaTable titulo="Meta por país" columna="País" rows={data.metasPorPais.map((x) => ({ clave: x.pais, montoUsd: x.montoUsd, pct: x.pct }))} convMoneda={convMoneda} monedaLabel={monedaLabel} />
                </Grid>
                <Grid item xs={12} md={4}>
                  <MetaTable titulo="Meta por PD" columna="PD" rows={data.metasPorPD.map((x) => ({ clave: x.pd, montoUsd: x.montoUsd, pct: x.pct }))} convMoneda={convMoneda} monedaLabel={monedaLabel} />
                </Grid>
                <Grid item xs={12} md={4}>
                  <MetaTable titulo="Meta por gestor" columna="Gestor" rows={data.metasPorGestor.map((x) => ({ clave: x.gestor, montoUsd: x.montoUsd, pct: x.pct }))} convMoneda={convMoneda} monedaLabel={monedaLabel} />
                </Grid>
              </Grid>
            </Stack>
          )}
        </Paper>

        {/* 4 · Promesas y recuperación */}
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <Paper sx={{ p: 1.5, borderRadius: 2.5, border: '1px solid', borderColor: 'divider', height: '100%' }}>
              <Typography sx={{ fontWeight: 700, mb: 1 }}>Promesas</Typography>
              <Stack spacing={0.75}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>Total</span><strong>{money(data.promesas.totalUsd)} · {data.promesas.cantidad}</strong></Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>Vigentes</span><span>{money(data.promesas.vigentesUsd)} · {data.promesas.cantidadVigentes}</span></Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'error.main' }}><span>Vencidas</span><span>{money(data.promesas.vencidasUsd)} · {data.promesas.cantidadVencidas}</span></Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'success.main' }}><span>Cumplidas</span><span>{money(data.promesas.cumplidasUsd)} · {data.promesas.cantidadCumplidas}</span></Box>
              </Stack>
              {data.promesas.cantidad === 0 && <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>Sin promesas en el alcance.</Typography>}
            </Paper>
          </Grid>
          <Grid item xs={12} md={4}><BarList title="Recuperación por país (saldo actual)" items={data.recuperacion.porPais} valueOf={(x) => x.saldoActualUsd} code="USD" empty="Sin datos disponibles." /></Grid>
          <Grid item xs={12} md={4}><BarList title="Recuperación por PD (saldo actual)" items={data.recuperacion.porPD} valueOf={(x) => x.saldoActualUsd} code="USD" empty="Sin datos disponibles." /></Grid>
        </Grid>

        <Grid container spacing={2}>
          <Grid item xs={12} md={6}><BarList title="Promesado por país" items={data.promesas.porPais} valueOf={(x) => x.montoUsd} code="USD" empty="Sin promesas." /></Grid>
          <Grid item xs={12} md={6}><BarList title="Promesado por PD" items={data.promesas.porPD} valueOf={(x) => x.montoUsd} code="USD" empty="Sin promesas." /></Grid>
        </Grid>

        {/* 6 · Hallazgos */}
        <Paper sx={{ p: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
          <Typography sx={{ fontWeight: 700, mb: 1 }}>Hallazgos</Typography>
          {hallazgosPorCategoria.length === 0 ? <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Sin hallazgos con los datos disponibles.</Typography> : (
            <Grid container spacing={2}>
              {hallazgosPorCategoria.map(([cat, list]) => (
                <Grid item xs={12} md={6} key={cat}>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 0.5 }}>{cat}</Typography>
                  <Stack spacing={0.75}>
                    {list.map((h, i) => (
                      <Paper key={i} variant="outlined" sx={{ p: 1, borderRadius: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                          <Chip size="small" color={NIVEL_COLOR[h.nivel]} label={h.nivel} />
                          <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{h.titulo}</Typography>
                          {h.valor && <Chip size="small" variant="outlined" label={h.valor} sx={{ ml: 'auto' }} />}
                        </Box>
                        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{h.detalle}</Typography>
                      </Paper>
                    ))}
                  </Stack>
                </Grid>
              ))}
            </Grid>
          )}
        </Paper>

        {/* 7 · Histórico mensual */}
        <Paper sx={{ p: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography sx={{ fontWeight: 700 }}>Histórico mensual</Typography>
            {data.historico.length > 0 && (
              <Button size="small" startIcon={<FileDownloadOutlinedIcon />} sx={{ textTransform: 'none' }}
                onClick={() => exportRowsToCsv('inteligencia_historico.csv', ['Mes', 'Asignado USD', 'Recuperado USD', '% Rec', 'Meta USD', '% Cumpl'],
                  data.historico.map((h) => [h.periodo, h.saldoAsignadoUsd, h.recuperadoUsd, h.pctRecuperacion, h.metaUsd ?? '', h.cumplimientoPct ?? '']))}>CSV</Button>
            )}
          </Box>
          {data.historico.length === 0 ? (
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Sin información histórica disponible. El histórico se mostrará cuando existan snapshots mensuales.</Typography>
          ) : (
            <>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-end', height: 120, mb: 1.5, overflowX: 'auto' }}>
                {(() => { const mx = Math.max(1, ...data.historico.map((h) => Math.max(h.saldoAsignadoUsd, h.recuperadoUsd))); return data.historico.map((h) => (
                  <Tooltip key={h.periodo} arrow title={`${h.periodo}: Asig ${money(h.saldoAsignadoUsd)} · Rec ${money(h.recuperadoUsd)} · ${h.pctRecuperacion}%`}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25, minWidth: 44 }}>
                      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.25, height: 90 }}>
                        <Box sx={{ width: 10, bgcolor: '#94A3B8', height: `${(h.saldoAsignadoUsd / mx) * 100}%`, borderRadius: 0.5 }} />
                        <Box sx={{ width: 10, bgcolor: '#22C55E', height: `${(h.recuperadoUsd / mx) * 100}%`, borderRadius: 0.5 }} />
                      </Box>
                      <Typography sx={{ fontSize: 10 }}>{h.periodo.slice(2)}</Typography>
                    </Box>
                  </Tooltip>
                )); })()}
              </Stack>
              <TableContainer sx={{ maxHeight: 260 }}>
                <Table size="small" stickyHeader>
                  <TableHead><TableRow>{['Mes', 'Asignado', 'Recuperado', '% Rec', 'Meta', '% Cumpl'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
                  <TableBody>
                    {data.historico.map((h) => (
                      <TableRow key={h.periodo} hover>
                        <TableCell>{h.periodo}</TableCell><TableCell align="right">{money(h.saldoAsignadoUsd)}</TableCell>
                        <TableCell align="right">{money(h.recuperadoUsd)}</TableCell><TableCell align="right">{h.pctRecuperacion}%</TableCell>
                        <TableCell align="right">{h.metaUsd !== null ? money(h.metaUsd) : 'No definida'}</TableCell>
                        <TableCell align="right">{h.cumplimientoPct !== null ? `${h.cumplimientoPct}%` : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </Paper>

        <Divider />
        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Las proyecciones son estimaciones basadas en el ritmo diario de recuperación del mes en curso; no representan valores garantizados.</Typography>
      </Stack>
    </Box>
    <OnePagePreviewDialog
      open={onePagePreviewOpen}
      onClose={() => setOnePagePreviewOpen(false)}
      getRoot={() => inteligenciaRootRef.current}
      filenamePrefix="FORD-AVON_Inteligencia_OnePage"
    />
    </>
  );
};

export default InteligenciaPage;
