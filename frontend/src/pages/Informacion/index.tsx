import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, CircularProgress, Divider, Grid, Link,
  Paper, Snackbar, Stack, Tab, Tabs, TextField, Typography
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import { useAuth } from '../../context/AuthContext';
import { getInformacion, guardarContenido, type InfoData } from '../../services/informacionService';

const IDENTIDAD: Array<{ key: string; label: string; multiline?: boolean }> = [
  { key: 'empresa_nombre', label: 'Nombre de la empresa' },
  { key: 'empresa_descripcion', label: 'Descripción', multiline: true },
  { key: 'empresa_mision', label: 'Misión', multiline: true },
  { key: 'empresa_vision', label: 'Visión', multiline: true },
  { key: 'empresa_valores', label: 'Valores', multiline: true },
  { key: 'empresa_politicas', label: 'Políticas', multiline: true }
];
const CVD: Array<{ key: string; label: string; multiline?: boolean }> = [
  { key: 'cvd_titulo', label: 'Título' },
  { key: 'cvd_filosofia', label: 'Filosofía', multiline: true },
  { key: 'cvd_descripcion', label: 'Descripción', multiline: true },
  { key: 'cvd_principios', label: 'Principios', multiline: true },
  { key: 'cvd_objetivos', label: 'Objetivos', multiline: true }
];

const InformacionPage = () => {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('informacion.editar');
  const [data, setData] = useState<InfoData | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const d = await getInformacion();
      setData(d); setDraft(d.contenido);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible cargar la información.');
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const val = (k: string) => draft[k] ?? '';
  const setVal = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const guardar = async (campos: Array<{ key: string }>) => {
    setSaving(true);
    try {
      const patch: Record<string, string> = {};
      campos.forEach((c) => (patch[c.key] = val(c.key)));
      await guardarContenido(patch);
      setEditing(false);
      setToast('Información guardada.');
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally { setSaving(false); }
  };

  const enlaces = useMemo(() => data?.enlaces ?? [], [data]);

  if (loading) return <Box sx={{ display: 'flex', gap: 1.5, p: 3, alignItems: 'center' }}><CircularProgress size={22} /><Typography sx={{ fontSize: 14 }}>Cargando información...</Typography></Box>;
  if (error) return <Box sx={{ p: 2 }}><Alert severity="error">{error}</Alert></Box>;

  const seccionEditable = (titulo: string, campos: typeof IDENTIDAD) => (
    <Paper sx={{ p: 3, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography sx={{ fontSize: 16, fontWeight: 700 }}>{titulo}</Typography>
        {canEdit && !editing && <Button startIcon={<EditOutlinedIcon />} onClick={() => setEditing(true)} sx={{ textTransform: 'none' }}>Editar</Button>}
        {canEdit && editing && <Button variant="contained" startIcon={<SaveOutlinedIcon />} disabled={saving} onClick={() => guardar(campos)} sx={{ textTransform: 'none' }}>{saving ? <CircularProgress size={18} color="inherit" /> : 'Guardar'}</Button>}
      </Box>
      <Stack spacing={2}>
        {campos.map((c) => editing && canEdit ? (
          <TextField key={c.key} label={c.label} value={val(c.key)} onChange={(e) => setVal(c.key, e.target.value)} size="small" fullWidth multiline={c.multiline} minRows={c.multiline ? 2 : 1} />
        ) : (
          <Box key={c.key}>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase' }}>{c.label}</Typography>
            <Typography sx={{ whiteSpace: 'pre-wrap' }}>{val(c.key) || '—'}</Typography>
          </Box>
        ))}
      </Stack>
    </Paper>
  );

  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      <Tabs value={tab} onChange={(_e, v) => { setTab(v); setEditing(false); }} sx={{ mb: 2 }}>
        <Tab label="Identidad de la empresa" sx={{ textTransform: 'none' }} />
        <Tab label="Cobros Venta Directa" sx={{ textTransform: 'none' }} />
        <Tab label="Herramientas y Sistemas" sx={{ textTransform: 'none' }} />
      </Tabs>

      {tab === 0 && seccionEditable('Identidad de la empresa', IDENTIDAD)}
      {tab === 1 && seccionEditable('Cobros Venta Directa', CVD)}

      {tab === 2 && (
        <Box>
          <Grid container spacing={2}>
            {enlaces.map((l) => (
              <Grid item xs={12} sm={6} md={4} key={l.id ?? l.url}>
                <Card sx={{ height: '100%', borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
                  <CardContent>
                    <Typography sx={{ fontWeight: 700 }}>{l.nombre}</Typography>
                    <Typography sx={{ fontSize: 13, color: 'text.secondary', my: 1, minHeight: 40 }}>{l.descripcion}</Typography>
                    <Button component={Link} href={l.url} target="_blank" rel="noopener" variant="outlined" size="small" endIcon={<OpenInNewIcon />} sx={{ textTransform: 'none' }}>Abrir</Button>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
          <Divider sx={{ my: 2 }} />
          <Alert severity="info">En el futuro, esta funcionalidad será migrada progresivamente al portal FORD-AVON.</Alert>
        </Box>
      )}

      <Snackbar open={Boolean(toast)} autoHideDuration={3500} onClose={() => setToast(null)} message={toast ?? ''} />
    </Box>
  );
};

export default InformacionPage;
