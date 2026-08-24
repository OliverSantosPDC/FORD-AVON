import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AddIcon from '@mui/icons-material/Add';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import { useAuth } from '../../context/AuthContext';
import CalendarOnePage from '../../components/Calendario/CalendarOnePage';
import {
  getTiposEvento,
  getEventos,
  crearEvento,
  actualizarEvento,
  eliminarEvento,
  type EventType,
  type CalendarEvent,
  type CalendarEventInput
} from '../../services/calendarService';
import { getCatalogos, listUsuarios, type Catalogos, type UsuarioListItem } from '../../services/usuariosService';

const PAISES = ['El Salvador', 'Guatemala', 'Honduras', 'Nicaragua', 'Panamá', 'República Dominicana'];
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const monthLabel = (d: Date) => d.toLocaleDateString('es', { month: 'long', year: 'numeric' });

interface FormState extends CalendarEventInput {
  id: string | null;
}
const emptyForm = (fecha: string): FormState => ({
  id: null,
  titulo: '',
  descripcion: '',
  tipoEventoId: '',
  fechaInicio: fecha,
  fechaFin: fecha,
  horaInicio: '',
  horaFin: '',
  pais: '',
  zonaId: '',
  usuarioId: '',
  todoElDia: true
});

const VistaMensual = () => {
  const { user, hasPermission } = useAuth();
  const isAdmin = hasPermission('usuarios.administrar_global');
  const canCrear = hasPermission('calendario.crear');
  const canEditar = hasPermission('calendario.editar');
  const canEliminar = hasPermission('calendario.eliminar');

  const [cursor, setCursor] = useState(() => new Date());
  const [tipos, setTipos] = useState<EventType[]>([]);
  const [eventos, setEventos] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroPaises, setFiltroPaises] = useState<string[]>([]);
  const [onePageOpen, setOnePageOpen] = useState(false);
  const [detalleEvento, setDetalleEvento] = useState<CalendarEvent | null>(null);
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [usuarios, setUsuarios] = useState<UsuarioListItem[]>([]);

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const monthStart = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1), [cursor]);
  const monthEnd = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0), [cursor]);

  const cargar = async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, ev] = await Promise.all([
        getTiposEvento(),
        getEventos({ desde: ymd(monthStart), hasta: ymd(monthEnd) })
      ]);
      setTipos(t);
      setEventos(ev);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible cargar la información. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStart.getTime()]);

  useEffect(() => {
    if (!isAdmin) return;
    getCatalogos().then(setCatalogos).catch(() => undefined);
    listUsuarios().then(setUsuarios).catch(() => undefined);
  }, [isAdmin]);

  // Eventos filtrados (tipo + país). Los eventos sin país (Global) siempre se muestran.
  // Se filtra sobre los datos ya cargados y con alcance aplicado por el backend (sin refetch).
  const eventosFiltrados = useMemo(() => eventos.filter((e) =>
    (!filtroTipo || e.tipo_evento_id === filtroTipo) &&
    (filtroPaises.length === 0 || !e.pais || filtroPaises.includes(e.pais))
  ), [eventos, filtroTipo, filtroPaises]);

  // Totales por tipo de evento (solo tipos presentes), reactivos a filtros y mes cargado.
  const totalesPorTipo = useMemo(() => {
    const m = new Map<string, { nombre: string; color: string | null; eventos: CalendarEvent[] }>();
    eventosFiltrados.forEach((e) => {
      const t = tipos.find((x) => x.id === e.tipo_evento_id);
      const nombre = e.event_types?.nombre ?? t?.nombre ?? 'Otro';
      const color = e.event_types?.color ?? t?.color ?? null;
      const it = m.get(nombre) ?? { nombre, color, eventos: [] };
      it.eventos.push(e);
      m.set(nombre, it);
    });
    return [...m.values()].sort((a, b) => b.eventos.length - a.eventos.length);
  }, [eventosFiltrados, tipos]);

  // Mapa fecha -> eventos (expandiendo el rango de cada evento).
  const eventosPorDia = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    const filtered = eventosFiltrados;
    for (const ev of filtered) {
      const ini = new Date(`${ev.fecha_inicio}T00:00:00`);
      const fin = new Date(`${ev.fecha_fin || ev.fecha_inicio}T00:00:00`);
      for (let d = new Date(ini); d <= fin; d.setDate(d.getDate() + 1)) {
        const key = ymd(d);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(ev);
      }
    }
    return map;
  }, [eventosFiltrados]);

  // Celdas del mes (semana inicia lunes).
  const celdas = useMemo(() => {
    const offset = (monthStart.getDay() + 6) % 7;
    const total = offset + monthEnd.getDate();
    const filas = Math.ceil(total / 7) * 7;
    const cells: Array<Date | null> = [];
    for (let i = 0; i < filas; i += 1) {
      const dayNum = i - offset + 1;
      cells.push(dayNum >= 1 && dayNum <= monthEnd.getDate() ? new Date(cursor.getFullYear(), cursor.getMonth(), dayNum) : null);
    }
    return cells;
  }, [monthStart, monthEnd, cursor]);

  const abrirCrear = (fecha: string) => {
    if (!canCrear) return;
    setFormError(null);
    setDetalleEvento(null);
    setForm({ ...emptyForm(fecha), usuarioId: isAdmin ? '' : user?.id ?? '' });
  };

  const abrirEditar = (ev: CalendarEvent) => {
    setFormError(null);
    setDetalleEvento(ev);
    setForm({
      id: ev.id,
      titulo: ev.titulo,
      descripcion: ev.descripcion ?? '',
      tipoEventoId: ev.tipo_evento_id ?? '',
      fechaInicio: ev.fecha_inicio,
      fechaFin: ev.fecha_fin,
      horaInicio: ev.hora_inicio ?? '',
      horaFin: ev.hora_fin ?? '',
      pais: ev.pais ?? '',
      zonaId: ev.zona_id ?? '',
      usuarioId: ev.usuario_id ?? '',
      todoElDia: ev.todo_el_dia
    });
  };

  const guardar = async () => {
    if (!form) return;
    setFormError(null);
    if (!form.titulo.trim() || !form.tipoEventoId || !form.fechaInicio) {
      setFormError('Título, tipo y fecha de inicio son obligatorios.');
      return;
    }
    setSaving(true);
    const payload: CalendarEventInput = {
      titulo: form.titulo.trim(),
      descripcion: form.descripcion || null,
      tipoEventoId: form.tipoEventoId,
      fechaInicio: form.fechaInicio,
      fechaFin: form.fechaFin || form.fechaInicio,
      horaInicio: form.todoElDia ? null : form.horaInicio || null,
      horaFin: form.todoElDia ? null : form.horaFin || null,
      pais: form.pais || null,
      zonaId: form.zonaId || null,
      usuarioId: form.usuarioId || null,
      todoElDia: form.todoElDia
    };
    try {
      if (form.id) {
        await actualizarEvento(form.id, payload);
        setToast('Evento actualizado.');
      } else {
        await crearEvento(payload);
        setToast('Evento creado.');
      }
      setForm(null);
      await cargar();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo guardar el evento.');
    } finally {
      setSaving(false);
    }
  };

  const borrar = async () => {
    if (!form?.id) return;
    setSaving(true);
    try {
      await eliminarEvento(form.id);
      setForm(null);
      setToast('Evento eliminado.');
      await cargar();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo eliminar el evento.');
    } finally {
      setSaving(false);
    }
  };

  const colorTipo = (ev: CalendarEvent) => ev.event_types?.color ?? '#64748B';
  const hoy = ymd(new Date());

  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <IconButton onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeftIcon /></IconButton>
          <Typography sx={{ fontSize: 18, fontWeight: 700, minWidth: 170, textTransform: 'capitalize', textAlign: 'center' }}>{monthLabel(cursor)}</Typography>
          <IconButton onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRightIcon /></IconButton>
          <Button size="small" onClick={() => setCursor(new Date())} sx={{ textTransform: 'none' }}>Hoy</Button>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField select size="small" label="Tipo" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} sx={{ minWidth: 150 }}>
            <MenuItem value="">Todos</MenuItem>
            {tipos.map((t) => <MenuItem key={t.id} value={t.id}>{t.nombre}</MenuItem>)}
          </TextField>
          <TextField
            select size="small" label="País" value={filtroPaises} sx={{ minWidth: 180 }}
            SelectProps={{ multiple: true, renderValue: (v) => ((v as string[]).length ? (v as string[]).join(', ') : 'Todos') }}
            onChange={(e) => setFiltroPaises(typeof e.target.value === 'string' ? e.target.value.split(',') : (e.target.value as unknown as string[]))}
          >
            {PAISES.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
          </TextField>
          <Button variant="outlined" startIcon={<DescriptionOutlinedIcon />} onClick={() => setOnePageOpen(true)} sx={{ textTransform: 'none' }}>OnePage</Button>
          {canCrear && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => abrirCrear(hoy)} sx={{ textTransform: 'none', borderRadius: 2 }}>
              Nuevo evento
            </Button>
          )}
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 3 }}>
          <CircularProgress size={22} /><Typography sx={{ fontSize: 14 }}>Cargando calendario...</Typography>
        </Box>
      ) : (
        <Paper sx={{ borderRadius: 2.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {DIAS.map((d) => (
              <Box key={d} sx={{ p: 1, textAlign: 'center', fontSize: 12, fontWeight: 700, color: 'text.secondary', borderBottom: '1px solid', borderColor: 'divider' }}>{d}</Box>
            ))}
            {celdas.map((date, i) => {
              const key = date ? ymd(date) : `x${i}`;
              const evs = date ? eventosPorDia.get(key) ?? [] : [];
              return (
                <Box
                  key={key}
                  onClick={() => date && abrirCrear(key)}
                  sx={{
                    minHeight: 96,
                    p: 0.75,
                    border: '1px solid',
                    borderColor: 'divider',
                    bgcolor: date ? 'transparent' : 'action.hover',
                    cursor: date && canCrear ? 'pointer' : 'default',
                    '&:hover': { bgcolor: date ? 'action.hover' : undefined }
                  }}
                >
                  {date && (
                    <>
                      <Typography sx={{ fontSize: 12, fontWeight: key === hoy ? 800 : 500, color: key === hoy ? 'primary.main' : 'text.secondary' }}>
                        {date.getDate()}
                      </Typography>
                      <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                        {evs.slice(0, 3).map((ev) => (
                          <Tooltip
                            key={ev.id}
                            arrow
                            title={
                              <Box sx={{ fontSize: 11 }}>
                                <strong>{ev.titulo}</strong><br />
                                {ev.event_types?.nombre ?? 'Evento'}<br />
                                {(ev.fecha_fin && ev.fecha_fin !== ev.fecha_inicio) ? `${ev.fecha_inicio} → ${ev.fecha_fin}` : ev.fecha_inicio}<br />
                                {`País: ${ev.pais ?? 'Global'}`}{ev.gestor_nombre ? <><br />{`Gestor: ${ev.gestor_nombre}`}</> : null}
                              </Box>
                            }
                          >
                            <Chip
                              label={ev.titulo}
                              size="small"
                              onClick={(e) => { e.stopPropagation(); abrirEditar(ev); }}
                              sx={{ height: 18, fontSize: 10, justifyContent: 'flex-start', bgcolor: colorTipo(ev), color: '#fff', '& .MuiChip-label': { px: 0.75 } }}
                            />
                          </Tooltip>
                        ))}
                        {evs.length > 3 && <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>+{evs.length - 3} más</Typography>}
                      </Stack>
                    </>
                  )}
                </Box>
              );
            })}
          </Box>
        </Paper>
      )}

      {/* Resumen: Totales por tipo de evento (reaccionan a filtros y mes). Hover = detalle. */}
      {!loading && (
        <Paper sx={{ mt: 2, p: 1.5, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
          <Typography sx={{ fontWeight: 700, mb: 1 }}>Totales por tipo de evento <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>· {monthLabel(cursor)}</Typography></Typography>
          {totalesPorTipo.length === 0 ? (
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>No hay eventos para los filtros seleccionados.</Typography>
          ) : (
            <Grid container spacing={1.5}>
              {totalesPorTipo.map((t) => (
                <Grid item xs={6} sm={4} md={3} lg={2} key={t.nombre}>
                  <Tooltip arrow placement="top" title={
                    <Box sx={{ maxHeight: 220, overflowY: 'auto', py: 0.5 }}>
                      {t.eventos.slice(0, 30).map((e) => (
                        <Box key={e.id} sx={{ fontSize: 11, mb: 0.5 }}>
                          <strong>{e.titulo}</strong><br />
                          {(e.fecha_fin && e.fecha_fin !== e.fecha_inicio) ? `${e.fecha_inicio} → ${e.fecha_fin}` : e.fecha_inicio}
                          {` · ${e.pais ?? 'Global'}`}{e.gestor_nombre ? ` · ${e.gestor_nombre}` : ''}
                        </Box>
                      ))}
                      {t.eventos.length > 30 && <Box sx={{ fontSize: 11, color: 'grey.300' }}>+{t.eventos.length - 30} más…</Box>}
                    </Box>
                  }>
                    <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, cursor: 'default', borderLeft: '4px solid', borderLeftColor: t.color ?? '#1E3A8A' }}>
                      <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.nombre}</Typography>
                      <Typography sx={{ fontSize: 22, fontWeight: 800 }}>{t.eventos.length}</Typography>
                    </Paper>
                  </Tooltip>
                </Grid>
              ))}
            </Grid>
          )}
        </Paper>
      )}

      <CalendarOnePage
        open={onePageOpen}
        onClose={() => setOnePageOpen(false)}
        periodo={monthLabel(cursor)}
        paises={filtroPaises}
        eventos={eventosFiltrados}
        totales={totalesPorTipo}
      />

      {/* Formulario crear/editar */}
      <Dialog open={Boolean(form)} onClose={() => setForm(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{form?.id ? 'Editar evento' : 'Nuevo evento'}</DialogTitle>
        <DialogContent dividers>
          {form && (
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              {formError && <Alert severity="error">{formError}</Alert>}
              {form.id && detalleEvento && (
                <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary', mb: 0.5 }}>Detalle del evento</Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip size="small" label={`Tipo: ${detalleEvento.event_types?.nombre ?? tipos.find((t) => t.id === detalleEvento.tipo_evento_id)?.nombre ?? 'Otro'}`} />
                    <Chip size="small" variant="outlined" label={`País: ${detalleEvento.pais ?? 'Global'}`} />
                    <Chip size="small" variant="outlined" color={detalleEvento.gestor_nombre ? 'primary' : 'default'} label={`Gestor: ${detalleEvento.gestor_nombre ?? 'No especificado'}`} />
                  </Stack>
                </Paper>
              )}
              <TextField label="Título" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} size="small" fullWidth />
              <TextField label="Descripción" value={form.descripcion ?? ''} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} size="small" fullWidth multiline minRows={2} />
              <TextField select label="Tipo de evento" value={form.tipoEventoId} onChange={(e) => setForm({ ...form, tipoEventoId: e.target.value })} size="small" fullWidth>
                {tipos.map((t) => <MenuItem key={t.id} value={t.id}>{t.nombre}</MenuItem>)}
              </TextField>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Fecha inicio" type="date" value={form.fechaInicio} onChange={(e) => setForm({ ...form, fechaInicio: e.target.value })} size="small" fullWidth InputLabelProps={{ shrink: true }} />
                <TextField label="Fecha fin" type="date" value={form.fechaFin} onChange={(e) => setForm({ ...form, fechaFin: e.target.value })} size="small" fullWidth InputLabelProps={{ shrink: true }} />
              </Stack>
              <FormControlLabel control={<Switch checked={form.todoElDia} onChange={(e) => setForm({ ...form, todoElDia: e.target.checked })} />} label="Todo el día" />
              {!form.todoElDia && (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField label="Hora inicio" type="time" value={form.horaInicio ?? ''} onChange={(e) => setForm({ ...form, horaInicio: e.target.value })} size="small" fullWidth InputLabelProps={{ shrink: true }} />
                  <TextField label="Hora fin" type="time" value={form.horaFin ?? ''} onChange={(e) => setForm({ ...form, horaFin: e.target.value })} size="small" fullWidth InputLabelProps={{ shrink: true }} />
                </Stack>
              )}
              <TextField select label="País (opcional)" value={form.pais ?? ''} onChange={(e) => setForm({ ...form, pais: e.target.value })} size="small" fullWidth>
                <MenuItem value="">Global / sin país</MenuItem>
                {PAISES.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
              </TextField>
              {isAdmin && (
                <>
                  <TextField select label="Zona (opcional)" value={form.zonaId ?? ''} onChange={(e) => setForm({ ...form, zonaId: e.target.value })} size="small" fullWidth>
                    <MenuItem value="">Sin zona</MenuItem>
                    {(catalogos?.zonas ?? []).map((z) => <MenuItem key={z.id} value={z.id}>{z.nombre}</MenuItem>)}
                  </TextField>
                  <TextField select label="Usuario (opcional)" value={form.usuarioId ?? ''} onChange={(e) => setForm({ ...form, usuarioId: e.target.value })} size="small" fullWidth>
                    <MenuItem value="">Sin usuario</MenuItem>
                    {usuarios.map((u) => <MenuItem key={u.id} value={u.id}>{[u.nombre, u.apellido].filter(Boolean).join(' ') || u.email}</MenuItem>)}
                  </TextField>
                </>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between' }}>
          {form?.id && canEliminar ? (
            <Button color="error" onClick={borrar} disabled={saving} sx={{ textTransform: 'none' }}>Eliminar</Button>
          ) : <span />}
          <Box>
            <Button onClick={() => setForm(null)} sx={{ textTransform: 'none' }}>Cancelar</Button>
            <Button onClick={guardar} variant="contained" disabled={saving || (Boolean(form?.id) && !canEditar)} sx={{ textTransform: 'none' }}>
              {saving ? <CircularProgress size={20} color="inherit" /> : 'Guardar'}
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(toast)} autoHideDuration={3500} onClose={() => setToast(null)} message={toast ?? ''} />
    </Box>
  );
};

const CalendarioPage = () => <VistaMensual />;

export default CalendarioPage;
