import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Grid, Stack, Typography } from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import type { CentroInteligencia } from '../../services/inteligenciaService';

interface Props { open: boolean; onClose: () => void; data: CentroInteligencia; }

const usd = (v: number | null) => (v === null || v === undefined ? '—' : `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
const pctTxt = (v: number | null) => (v === null || v === undefined ? '—' : `${v}%`);

const InteligenciaOnePage = ({ open, onClose, data }: Props) => {
  const f = data.filtros;
  const filtroChips: string[] = [];
  (['pais', 'zona', 'sector', 'pd', 'riesgo', 'gestor'] as const).forEach((k) => { if (f[k]?.length) filtroChips.push(`${k}: ${(f[k] as string[]).join(', ')}`); });
  const criticos = data.hallazgos.filter((h) => h.nivel === 'Crítico' || h.nivel === 'Atención').slice(0, 8);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <style>{`@media print { body * { visibility: hidden !important; } #int-onepage, #int-onepage * { visibility: visible !important; } #int-onepage { position: absolute; left: 0; top: 0; width: 100%; padding: 16px; } .no-print { display: none !important; } }`}</style>
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} className="no-print">
        Resumen Ejecutivo · Centro de Inteligencia
        <Button startIcon={<PrintIcon />} variant="contained" onClick={() => window.print()} sx={{ textTransform: 'none' }}>Imprimir / PDF</Button>
      </DialogTitle>
      <DialogContent dividers>
        <Box id="int-onepage">
          <Typography sx={{ fontSize: 20, fontWeight: 800 }}>FORD-AVON · Centro de Inteligencia</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1 }}>Período: {data.periodo} · Generado: {new Date().toLocaleString('es')}</Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
            {(filtroChips.length ? filtroChips : ['Sin filtros (alcance del usuario)']).map((c) => <Chip key={c} size="small" label={c} />)}
          </Stack>

          <Divider sx={{ my: 1 }} />
          <Grid container spacing={1.5}>
            {[
              ['Meta', data.meta.definida ? usd(data.meta.montoUsd) : 'Meta no definida'],
              ['Saldo asignado', usd(data.kpis.saldoAsignadoUsd)],
              ['Saldo actual', usd(data.kpis.saldoActualUsd)],
              ['Recuperado', usd(data.kpis.recuperadoUsd)],
              ['% cumplimiento', data.cumplimiento.pct === null ? 'Meta no definida' : pctTxt(data.cumplimiento.pct)],
              ['Promesado', usd(data.promesas.totalUsd)],
              ['Proyección recuperación', usd(data.proyeccion.recuperacionProyectadaUsd)],
              ['Proyección cumplimiento', data.proyeccion.cumplimientoProyectadoPct === null ? 'Sin meta' : `${pctTxt(data.proyeccion.cumplimientoProyectadoPct)} · ${data.proyeccion.estado}`],
              ['Días (transc./rest.)', `${data.dias.transcurridos} / ${data.dias.restantes}`],
              ['Calidad global', data.calidad.notaGlobal !== null && data.calidad.evaluaciones > 0 ? `${data.calidad.notaGlobal} / 100` : 'Sin evaluaciones disponibles']
            ].map(([l, v]) => (
              <Grid item xs={6} sm={4} key={l}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary' }}>{l}</Typography>
                <Typography sx={{ fontSize: 15, fontWeight: 800 }}>{v}</Typography>
              </Grid>
            ))}
          </Grid>

          <Divider sx={{ my: 1.5 }} />
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Typography sx={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary', mb: 0.5 }}>Principales países (saldo actual)</Typography>
              {data.recuperacion.porPais.slice(0, 6).map((g) => (
                <Box key={g.clave} sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>{g.clave}</span><span>{usd(g.saldoActualUsd)} · {g.pctRecuperacion}%</span></Box>
              ))}
              {data.recuperacion.porPais.length === 0 && <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Sin datos disponibles.</Typography>}
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography sx={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary', mb: 0.5 }}>Principales PD (saldo actual)</Typography>
              {data.recuperacion.porPD.slice(0, 6).map((g) => (
                <Box key={g.clave} sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>{g.clave}</span><span>{usd(g.saldoActualUsd)} · {g.pctRecuperacion}%</span></Box>
              ))}
              {data.recuperacion.porPD.length === 0 && <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Sin datos disponibles.</Typography>}
            </Grid>
          </Grid>

          <Divider sx={{ my: 1.5 }} />
          <Typography sx={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary', mb: 0.5 }}>Hallazgos más importantes</Typography>
          {criticos.length === 0 ? <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Sin hallazgos críticos con los datos disponibles.</Typography> : (
            <Stack spacing={0.25} sx={{ mb: 1.5 }}>
              {criticos.map((h, i) => (
                <Box key={i} sx={{ fontSize: 12 }}><strong>[{h.nivel}] {h.titulo}</strong>{h.valor ? ` · ${h.valor}` : ''} — {h.detalle}</Box>
              ))}
            </Stack>
          )}

          <Typography sx={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary', mb: 0.5 }}>Histórico mensual</Typography>
          {data.historico.length === 0 ? <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Sin información histórica disponible.</Typography> : (
            <Stack spacing={0.25}>
              {data.historico.slice(-6).map((h) => (
                <Box key={h.periodo} sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span>{h.periodo}</span><span>Asig {usd(h.saldoAsignadoUsd)} · Rec {usd(h.recuperadoUsd)} · {h.pctRecuperacion}%</span>
                </Box>
              ))}
            </Stack>
          )}
        </Box>
      </DialogContent>
      <DialogActions className="no-print"><Button onClick={onClose} sx={{ textTransform: 'none' }}>Cerrar</Button></DialogActions>
    </Dialog>
  );
};

export default InteligenciaOnePage;
