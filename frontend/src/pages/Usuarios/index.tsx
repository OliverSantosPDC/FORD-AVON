import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import {
  listUsuarios,
  getCatalogos,
  getUsuario,
  createUsuario,
  updateUsuario,
  type UsuarioListItem,
  type Catalogos,
  type UsuarioPayload
} from '../../services/usuariosService';

interface FormState {
  id: string | null;
  email: string;
  nombre: string;
  apellido: string;
  roleId: string;
  activo: boolean;
  nombreCartera: string;
  gestorIds: string[];
  zonaIds: string[];
}

const EMPTY_FORM: FormState = {
  id: null,
  email: '',
  nombre: '',
  apellido: '',
  roleId: '',
  activo: true,
  nombreCartera: '',
  gestorIds: [],
  zonaIds: []
};

const UsuariosPage = () => {
  const [usuarios, setUsuarios] = useState<UsuarioListItem[]>([]);
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, c] = await Promise.all([listUsuarios(), getCatalogos()]);
      setUsuarios(u);
      setCatalogos(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible cargar la información. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const roleClaveById = useMemo(() => {
    const map = new Map<string, string>();
    catalogos?.roles.forEach((r) => map.set(r.id, r.clave));
    return map;
  }, [catalogos]);

  const selectedRoleClave = roleClaveById.get(form.roleId) ?? '';

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = async (id: string) => {
    setFormError(null);
    try {
      const u = await getUsuario(id);
      setForm({
        id: u.id,
        email: u.email,
        nombre: u.nombre,
        apellido: u.apellido ?? '',
        roleId: u.roleId ?? '',
        activo: u.activo,
        nombreCartera: u.nombreCartera ?? '',
        gestorIds: u.gestorIds ?? [],
        zonaIds: u.zonaIds ?? []
      });
      setDialogOpen(true);
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudo cargar el usuario.');
    }
  };

  const toggleActivo = async (u: UsuarioListItem) => {
    try {
      await updateUsuario(u.id, { activo: !u.activo });
      setToast(`Usuario ${!u.activo ? 'activado' : 'desactivado'}.`);
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudo cambiar el estado.');
    }
  };

  const buildPayload = (): UsuarioPayload => {
    const payload: UsuarioPayload = {
      nombre: form.nombre.trim(),
      apellido: form.apellido.trim() || null,
      roleId: form.roleId,
      activo: form.activo
    };
    if (!form.id) payload.email = form.email.trim();
    if (selectedRoleClave === 'gestor') payload.nombreCartera = form.nombreCartera || null;
    if (selectedRoleClave === 'supervisor') payload.gestorIds = form.gestorIds;
    if (selectedRoleClave === 'gerente_zona') payload.zonaIds = form.zonaIds;
    return payload;
  };

  const handleSave = async () => {
    setFormError(null);
    if (!form.nombre.trim() || !form.roleId || (!form.id && !form.email.trim())) {
      setFormError('Correo, nombre y rol son obligatorios.');
      return;
    }
    if (selectedRoleClave === 'gestor' && !form.nombreCartera) {
      setFormError('Selecciona el gestor de cartera (nombre_cartera) para asignar el alcance.');
      return;
    }
    setSaving(true);
    try {
      if (form.id) {
        await updateUsuario(form.id, buildPayload());
        setToast('Usuario actualizado.');
      } else {
        await createUsuario(buildPayload());
        setToast('Invitación enviada por correo. El usuario se creó correctamente.');
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 3 }}>
        <CircularProgress size={22} />
        <Typography sx={{ fontSize: 14 }}>Cargando usuarios...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
        <Box>
          <Typography sx={{ fontSize: 20, fontWeight: 700 }}>Usuarios</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            {usuarios.length.toLocaleString('es')} usuario(s). Crea usuarios de prueba y asigna su alcance.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<PersonAddIcon />} onClick={openCreate} sx={{ textTransform: 'none', borderRadius: 2 }}>
          Nuevo usuario
        </Button>
      </Box>

      {usuarios.length === 0 ? (
        <Paper sx={{ p: 6, textAlign: 'center', borderRadius: 3 }}>
          <Typography sx={{ fontWeight: 600 }}>No hay usuarios registrados todavía.</Typography>
        </Paper>
      ) : (
        <Paper sx={{ borderRadius: 2.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
          <TableContainer sx={{ maxHeight: '65vh' }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  {['Nombre', 'Correo', 'Rol', 'Estado', 'Acciones'].map((h) => (
                    <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {usuarios.map((u) => (
                  <TableRow key={u.id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{[u.nombre, u.apellido].filter(Boolean).join(' ') || '—'}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{u.email}</TableCell>
                    <TableCell>{u.role ? <Chip size="small" label={u.role.nombre} /> : <Chip size="small" label="Sin rol" variant="outlined" />}</TableCell>
                    <TableCell>
                      <FormControlLabel
                        control={<Switch checked={u.activo} onChange={() => toggleActivo(u)} size="small" />}
                        label={u.activo ? 'Activo' : 'Inactivo'}
                        sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: 12 } }}
                      />
                    </TableCell>
                    <TableCell>
                      <Button size="small" startIcon={<EditOutlinedIcon fontSize="small" />} onClick={() => openEdit(u.id)} sx={{ textTransform: 'none' }}>
                        Editar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{form.id ? 'Editar usuario' : 'Nuevo usuario'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            {formError && <Alert severity="error">{formError}</Alert>}

            <TextField
              label="Correo electrónico"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              disabled={Boolean(form.id)}
              helperText={form.id ? 'El correo no se modifica en esta versión.' : 'Se enviará una invitación a este correo.'}
              size="small"
              fullWidth
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Nombre" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} size="small" fullWidth />
              <TextField label="Apellido" value={form.apellido} onChange={(e) => setForm((f) => ({ ...f, apellido: e.target.value }))} size="small" fullWidth />
            </Stack>

            <TextField
              select
              label="Rol"
              value={form.roleId}
              onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value, nombreCartera: '', gestorIds: [], zonaIds: [] }))}
              size="small"
              fullWidth
            >
              {(catalogos?.roles ?? []).map((r) => (
                <MenuItem key={r.id} value={r.id}>{r.nombre}</MenuItem>
              ))}
            </TextField>

            {/* Relación por rol */}
            {selectedRoleClave === 'gestor' && (
              <TextField
                select
                label="Gestor de cartera (nombre_cartera)"
                value={form.nombreCartera}
                onChange={(e) => setForm((f) => ({ ...f, nombreCartera: e.target.value }))}
                helperText="Debe coincidir con cartera.gestor; define el alcance del gestor."
                size="small"
                fullWidth
              >
                {(catalogos?.carteraGestores ?? []).map((g) => (
                  <MenuItem key={g} value={g}>{g}</MenuItem>
                ))}
              </TextField>
            )}

            {selectedRoleClave === 'supervisor' && (
              <FormControl size="small" fullWidth>
                <InputLabel id="sup-gestores">Gestores supervisados</InputLabel>
                <Select
                  labelId="sup-gestores"
                  multiple
                  value={form.gestorIds}
                  onChange={(e) => setForm((f) => ({ ...f, gestorIds: e.target.value as string[] }))}
                  input={<OutlinedInput label="Gestores supervisados" />}
                  renderValue={(sel) =>
                    (catalogos?.gestores ?? [])
                      .filter((g) => (sel as string[]).includes(g.id))
                      .map((g) => g.nombreCartera ?? g.id)
                      .join(', ')
                  }
                >
                  {(catalogos?.gestores ?? []).map((g) => (
                    <MenuItem key={g.id} value={g.id}>
                      <Checkbox checked={form.gestorIds.includes(g.id)} size="small" />
                      <ListItemText primary={g.nombreCartera ?? g.id} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {selectedRoleClave === 'gerente_zona' && (
              <FormControl size="small" fullWidth>
                <InputLabel id="ger-zonas">Zonas asignadas</InputLabel>
                <Select
                  labelId="ger-zonas"
                  multiple
                  value={form.zonaIds}
                  onChange={(e) => setForm((f) => ({ ...f, zonaIds: e.target.value as string[] }))}
                  input={<OutlinedInput label="Zonas asignadas" />}
                  renderValue={(sel) =>
                    (catalogos?.zonas ?? [])
                      .filter((z) => (sel as string[]).includes(z.id))
                      .map((z) => z.nombre)
                      .join(', ')
                  }
                >
                  {(catalogos?.zonas ?? []).map((z) => (
                    <MenuItem key={z.id} value={z.id}>
                      <Checkbox checked={form.zonaIds.includes(z.id)} size="small" />
                      <ListItemText primary={z.nombre} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            <FormControlLabel
              control={<Switch checked={form.activo} onChange={(e) => setForm((f) => ({ ...f, activo: e.target.checked }))} />}
              label={form.activo ? 'Usuario activo' : 'Usuario inactivo'}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} sx={{ textTransform: 'none' }}>Cancelar</Button>
          <Button onClick={handleSave} variant="contained" disabled={saving} sx={{ textTransform: 'none' }}>
            {saving ? <CircularProgress size={20} color="inherit" /> : form.id ? 'Guardar cambios' : 'Crear e invitar'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} message={toast ?? ''} />
    </Box>
  );
};

export default UsuariosPage;
