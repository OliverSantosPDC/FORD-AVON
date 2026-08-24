import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Grid, Stack, Typography } from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import type { DashboardKpi, DashboardMultiFilterParams, ZonaSectorSummary, ResumenPdItem } from '../../types/cartera';

interface Props {
  open: boolean;
  onClose: () => void;
  filters: DashboardMultiFilterParams;
  kpis: DashboardKpi;
  moneda: string;
  calidad: { nota: number; evaluaciones: number } | null;
  puedeCalidad: boolean;
  zonaSector: ZonaSectorSummary[];
  resumenPD: ResumenPdItem[];
}

const money = (v: number, moneda: string) =>
  moneda === 'USD' ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `${v.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${moneda}`;

const clasifCalidad = (n: number) => (n >= 90 ? 'Excelente' : n >= 75 ? 'Bueno' : n >= 60 ? 'Aceptable' : 'Requiere mejora');

const filtroChips = (f: DashboardMultiFilterParams) => {
  const out: string[] = [];
  (['pais', 'zona', 'gestor', 'gerente', 'pd', 'campania'] as const).forEach((k) => {
    if (f[k]?.length) out.push(`${k}: ${f[k].join(', ')}`);
  });
  return out.length ? out : ['Sin filtros (alcance completo del usuario)'];
};

/** Resumen ejecutivo (OnePage) del Dashboard. Estructura reutilizable e imprimible a PDF (window.print). */
const DashboardOnePage = ({ open, onClose, filters, kpis, moneda, calidad, puedeCalidad, zonaSector, resumenPD }: Props) => {
  const topZonas = [...zonaSector].sort((a, b) => b.saldoActualUsd - a.saldoActualUsd).slice(0, 8);
  const val = (z: ZonaSectorSummary) => (moneda === 'USD' ? z.saldoActualUsd : z.saldoActualLocal);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <style>{`@media print { body * { visibility: hidden !important; } #dash-onepage, #dash-onepage * { visibility: visible !important; } #dash-onepage { position: absolute; left: 0; top: 0; width: 100%; padding: 16px; } .no-print { display: none !important; } }`}</style>
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} className="no-print">
        Resumen Ejecutivo (OnePage)
        <Button startIcon={<PrintIcon />} variant="contained" onClick={() => window.print()} sx={{ textTransform: 'none' }}>Imprimir / PDF</Button>
      </DialogTitle>
      <DialogContent dividers>
        <Box id="dash-onepage">
          <Typography sx={{ fontSize: 20, fontWeight: 800 }}>FORD-AVON · Resumen Ejecutivo del Dashboard</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>Generado: {new Date().toLocaleString('es')} · Moneda: {moneda}</Typography>

          <Typography sx={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary' }}>Filtros aplicados</Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
            {filtroChips(filters).map((c) => <Chip key={c} size="small" label={c} />)}
          </Stack>

          <Divider sx={{ my: 1 }} />
          <Grid container spacing={1.5}>
            {[
              ['Saldo Asignado', money(kpis.saldoAsignado, moneda)],
              ['Saldo Actual', money(kpis.saldoActual, moneda)],
              ['Recuperado', money(kpis.recuperado, moneda)],
              ['% Recuperación (avance)', `${kpis.porcentajeRecuperacion.toFixed(2)}%`],
              ['Total Cuentas', kpis.totalCuentas.toLocaleString()],
              ['Meta', 'No definida']
            ].map(([l, v]) => (
              <Grid item xs={6} sm={4} key={l}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary' }}>{l}</Typography>
                <Typography sx={{ fontSize: 17, fontWeight: 800 }}>{v}</Typography>
              </Grid>
            ))}
            {puedeCalidad && (
              <Grid item xs={6} sm={4}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary' }}>Calidad de llamada global</Typography>
                <Typography sx={{ fontSize: 17, fontWeight: 800 }}>
                  {calidad && calidad.evaluaciones > 0 ? `${calidad.nota} · ${clasifCalidad(calidad.nota)}` : 'Sin evaluaciones disponibles'}
                </Typography>
              </Grid>
            )}
          </Grid>

          <Divider sx={{ my: 1.5 }} />
          <Typography sx={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary', mb: 0.5 }}>Principales zonas por saldo</Typography>
          {topZonas.length === 0 ? (
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Sin datos de zona/sector.</Typography>
          ) : (
            <Stack spacing={0.25} sx={{ mb: 1.5 }}>
              {topZonas.map((z) => (
                <Box key={z.zona} sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span>{z.zona}</span><span><strong>{money(val(z), moneda)}</strong> · {z.cuentas} cuentas</span>
                </Box>
              ))}
            </Stack>
          )}

          <Typography sx={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary', mb: 0.5 }}>Resumen por PD</Typography>
          <Stack spacing={0.25}>
            {resumenPD.slice(0, 10).map((p) => (
              <Box key={p.pd} sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span>{p.pd}</span>
                <span>{money(moneda === 'USD' ? p.saldoActualUsd : p.saldoActualLocal, moneda)} · {p.cuentas} · {(moneda === 'USD' ? p.porcentajeRecuperacionUsd : p.porcentajeRecuperacionLocal).toFixed(1)}%</span>
              </Box>
            ))}
          </Stack>
        </Box>
      </DialogContent>
      <DialogActions className="no-print">
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cerrar</Button>
      </DialogActions>
    </Dialog>
  );
};

export default DashboardOnePage;
