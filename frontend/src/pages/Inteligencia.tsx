import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, Grid, MenuItem, Paper, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography
} from '@mui/material';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import KpiCards from '../components/Dashboard/KpiCards';
import InteligenciaOnePage from '../components/Inteligencia/InteligenciaOnePage';
import { exportRowsToCsv } from '../utils/tableExport';
import { MONEDA_POR_PAIS } from '../services/gestionService';
import { getCentroInteligencia, type CentroFiltros, type CentroInteligencia } from '../services/inteligenciaService';
import type { DashboardKpi } from '../types/cartera';

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
  const [filtros, setFiltros] = useState<CentroFiltros>({});
  const [data, setData] = useState<CentroInteligencia | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moneda, setMoneda] = useState<'USD' | 'LOCAL'>('USD');
  const [onePageOpen, setOnePageOpen] = useState(false);

  const cargar = async (f: CentroFiltros) => {
    setLoading(true); setError(null);
    try { setData(await getCentroInteligencia(f)); }
    catch (e) { setError(e instanceof Error ? e.message : 'No fue posible cargar el Centro de Inteligencia.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void cargar(filtros); /* eslint-disable-next-line */ }, [filtros]);

  const opts = data?.filterOptions ?? { pais: [], zona: [], sector: [], pd: [], riesgo: [], gestor: [] };
  const singlePais = (filtros.pais ?? []).length === 1;
  const monedaCode = singlePais ? (MONEDA_POR_PAIS[(filtros.pais as string[])[0].toUpperCase()] ?? 'USD') : 'USD';
  const monedaSel: 'USD' | 'LOCAL' = singlePais && moneda === 'LOCAL' ? 'LOCAL' : 'USD';
  const codeMostrar = monedaSel === 'LOCAL' ? monedaCode : 'USD';

  const kpisDisplay: DashboardKpi | null = useMemo(() => {
    if (!data) return null;
    const k = data.kpis;
    return monedaSel === 'LOCAL'
      ? { saldoAsignado: k.saldoAsignadoLocal, saldoActual: k.saldoActualLocal, recuperado: k.recuperadoLocal, porcentajeRecuperacion: k.pctRecuperacion, totalCuentas: k.cuentas }
      : { saldoAsignado: k.saldoAsignadoUsd, saldoActual: k.saldoActualUsd, recuperado: k.recuperadoUsd, porcentajeRecuperacion: k.pctRecuperacion, totalCuentas: k.cuentas };
  }, [data, monedaSel]);

  const setF = (k: keyof CentroFiltros, v: string[]) => setFiltros((prev) => ({ ...prev, [k]: v }));
  const multiVal = (e: { target: { value: unknown } }): string[] => (typeof e.target.value === 'string' ? e.target.value.split(',') : (e.target.value as string[]));

  const hallazgosPorCategoria = useMemo(() => {
    const m = new Map<string, CentroInteligencia['hallazgos']>();
    (data?.hallazgos ?? []).forEach((h) => { const it = m.get(h.categoria) ?? []; it.push(h); m.set(h.categoria, it); });
    return [...m.entries()];
  }, [data]);

  if (loading && !data) return <Box sx={{ display: 'flex', gap: 1.5, p: 3, alignItems: 'center' }}><CircularProgress size={22} /><Typography sx={{ fontSize: 14 }}>Cargando Centro de Inteligencia...</Typography></Box>;
  if (error) return <Box sx={{ p: 2 }}><Alert severity="error">{error}</Alert></Box>;
  if (!data || !kpisDisplay) return <Box sx={{ p: 2 }}><Typography>Sin datos disponibles.</Typography></Box>;

  const filtroSelects: Array<{ key: keyof CentroFiltros; label: string; options: string[] }> = [
    { key: 'pais', label: 'País', options: opts.pais },
    { key: 'zona', label: 'Zona', options: opts.zona },
    { key: 'sector', label: 'Sector', options: opts.sector },
    { key: 'pd', label: 'PD', options: opts.pd },
    { key: 'riesgo', label: 'Riesgo', options: opts.riesgo },
    { key: 'gestor', label: 'Gestor', options: opts.gestor }
  ];

  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      <Stack spacing={2}>
        {/* 1 · Encabezado + filtros */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
          <Box>
            <Typography sx={{ fontSize: 20, fontWeight: 800 }}>Centro de Inteligencia</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Período {data.periodo} · {data.dias.transcurridos}/{data.dias.total} días · {data.dias.restantes} restantes</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            {singlePais && (
              <TextField select size="small" label="Moneda" value={moneda} onChange={(e) => setMoneda(e.target.value as 'USD' | 'LOCAL')} sx={{ minWidth: 150 }}>
                <MenuItem value="USD">USD</MenuItem>
                <MenuItem value="LOCAL">Moneda Local ({monedaCode})</MenuItem>
              </TextField>
            )}
            <Button variant="outlined" startIcon={<DescriptionOutlinedIcon />} onClick={() => setOnePageOpen(true)} sx={{ textTransform: 'none' }}>Generar OnePage</Button>
          </Box>
        </Box>

        <Paper sx={{ p: 1.5, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            {filtroSelects.map((fs) => (
              <TextField key={fs.key as string} select size="small" label={fs.label} value={(filtros[fs.key] as string[]) ?? []} sx={{ minWidth: 150 }}
                SelectProps={{ multiple: true, renderValue: (v) => ((v as string[]).length ? (v as string[]).join(', ') : 'Todos') }}
                onChange={(e) => setF(fs.key, multiVal(e))}>
                {fs.options.length === 0 ? <MenuItem value="" disabled>Sin datos</MenuItem> : fs.options.map((o) => <MenuItem key={o} value={o}>{o}</MenuItem>)}
              </TextField>
            ))}
            <Button size="small" onClick={() => setFiltros({})} sx={{ textTransform: 'none' }}>Limpiar</Button>
          </Stack>
        </Paper>

        {/* 2 · KPIs principales */}
        <KpiCards kpis={kpisDisplay} moneda={codeMostrar} />
        <Grid container spacing={1.5}>
          <Grid item xs={6} sm={4} md={2}><Mini l="Meta" v={data.meta.definida ? money(data.meta.montoUsd) : 'No definida'} /></Grid>
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

      <InteligenciaOnePage open={onePageOpen} onClose={() => setOnePageOpen(false)} data={data} />
    </Box>
  );
};

export default InteligenciaPage;
