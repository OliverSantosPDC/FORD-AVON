import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Grid, Stack, Typography } from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import type { CalendarEvent } from '../../services/calendarService';

interface TotalTipo { nombre: string; color: string | null; eventos: CalendarEvent[]; }

interface Props {
  open: boolean;
  onClose: () => void;
  periodo: string;
  paises: string[];
  eventos: CalendarEvent[];
  totales: TotalTipo[];
}

const tipoNombre = (e: CalendarEvent) => e.event_types?.nombre ?? 'Otro';
const fmtFecha = (e: CalendarEvent) => (e.fecha_fin && e.fecha_fin !== e.fecha_inicio ? `${e.fecha_inicio} → ${e.fecha_fin}` : e.fecha_inicio);

/** Resumen ejecutivo (OnePage) del Calendario. Respeta los filtros actuales (recibe eventos ya filtrados). */
const CalendarOnePage = ({ open, onClose, periodo, paises, eventos, totales }: Props) => {
  const hoy = new Date().toISOString().slice(0, 10);
  const ordenados = [...eventos].sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));
  const proximos = ordenados.filter((e) => (e.fecha_fin || e.fecha_inicio) >= hoy).slice(0, 10);
  const personales = ordenados.filter((e) => e.gestor_nombre);
  // Principales gestores por cantidad de eventos.
  const porGestor = new Map<string, number>();
  eventos.forEach((e) => { if (e.gestor_nombre) porGestor.set(e.gestor_nombre, (porGestor.get(e.gestor_nombre) ?? 0) + 1); });
  const topGestores = [...porGestor.entries()].map(([nombre, total]) => ({ nombre, total })).sort((a, b) => b.total - a.total).slice(0, 10);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <style>{`@media print { body * { visibility: hidden !important; } #cal-onepage, #cal-onepage * { visibility: visible !important; } #cal-onepage { position: absolute; left: 0; top: 0; width: 100%; padding: 16px; } .no-print { display: none !important; } }`}</style>
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} className="no-print">
        Resumen Ejecutivo · Calendario
        <Button startIcon={<PrintIcon />} variant="contained" onClick={() => window.print()} sx={{ textTransform: 'none' }}>Imprimir / PDF</Button>
      </DialogTitle>
      <DialogContent dividers>
        <Box id="cal-onepage">
          <Typography sx={{ fontSize: 20, fontWeight: 800 }}>FORD-AVON · Resumen del Calendario</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1 }}>Generado: {new Date().toLocaleString('es')}</Typography>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
            <Chip size="small" label={`Período: ${periodo}`} />
            <Chip size="small" label={`Países: ${paises.length ? paises.join(', ') : 'Todos (alcance del usuario)'}`} />
            <Chip size="small" color="primary" label={`Total eventos: ${eventos.length}`} />
          </Stack>

          <Divider sx={{ my: 1 }} />
          <Typography sx={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary', mb: 0.5 }}>Resumen por tipo de evento</Typography>
          {totales.length === 0 ? (
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Sin eventos en el período/filtros.</Typography>
          ) : (
            <Grid container spacing={1} sx={{ mb: 1.5 }}>
              {totales.map((t) => (
                <Grid item xs={6} sm={4} key={t.nombre}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span>{t.nombre}</span><strong>{t.eventos.length}</strong>
                  </Box>
                </Grid>
              ))}
            </Grid>
          )}

          {topGestores.length > 0 && (
            <>
              <Typography sx={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary', mb: 0.5 }}>Principales gestores con eventos</Typography>
              <Stack spacing={0.25} sx={{ mb: 1.5 }}>
                {topGestores.map((g) => (
                  <Box key={g.nombre} sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>{g.nombre}</span><strong>{g.total}</strong></Box>
                ))}
              </Stack>
            </>
          )}

          <Typography sx={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary', mb: 0.5 }}>Próximos eventos</Typography>
          {proximos.length === 0 ? <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>Sin próximos eventos en el período.</Typography> : (
            <Stack spacing={0.25} sx={{ mb: 1.5 }}>
              {proximos.map((e) => (
                <Box key={e.id} sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span>{fmtFecha(e)} · {e.titulo} <em style={{ color: '#64748B' }}>({tipoNombre(e)})</em></span>
                  <span>{e.pais ?? 'Global'}{e.gestor_nombre ? ` · ${e.gestor_nombre}` : ''}</span>
                </Box>
              ))}
            </Stack>
          )}

          <Typography sx={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary', mb: 0.5 }}>Ausencias / eventos personales</Typography>
          {personales.length === 0 ? <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Sin ausencias registradas en el período.</Typography> : (
            <Stack spacing={0.25}>
              {personales.slice(0, 20).map((e) => (
                <Box key={e.id} sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span>{e.gestor_nombre} · {tipoNombre(e)}</span><span>{fmtFecha(e)}{e.pais ? ` · ${e.pais}` : ''}</span>
                </Box>
              ))}
            </Stack>
          )}
        </Box>
      </DialogContent>
      <DialogActions className="no-print">
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cerrar</Button>
      </DialogActions>
    </Dialog>
  );
};

export default CalendarOnePage;
