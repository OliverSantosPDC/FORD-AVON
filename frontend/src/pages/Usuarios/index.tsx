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
  IconButton,
  InputAdornment,
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
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {
  listUsuarios,
  getCatalogos,
  getUsuario,
  createUsuario,
  updateUsuario,
  deleteUsuario,
  getPasswordRequests,
  resolvePasswordRequest,
  type UsuarioListItem,
  type Catalogos,
  type UsuarioPayload,
  type PasswordRequest
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
  const [createdCreds, setCreatedCreds] = useState<{ email: string; password: string } | null>(null);
  const [showCreds, setShowCreds] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pwReqs, setPwReqs] = useState<PasswordRequest[]>([]);
  const [pwTemp, setPwTemp] = useState<{ email: string; password: string } | null>(null);

  const loadPwReqs = async () => {
    try { setPwReqs(await getPasswordRequests()); } catch { /* no bloquea la vista */ }
  };
  const resolverPwReq = async (id: string, accion: 'aprobar' | 'rechazar', email: string) => {
    try {
      const r = await resolvePasswordRequest(id, accion);
      setToast(accion === 'aprobar' ? 'Solicitud aprobada; contraseña restablecida.' : 'Solicitud rechazada.');
      if (r.passwordTemporal) setPwTemp({ email, password: r.passwordTemporal });
      await loadPwReqs();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudo resolver la solicitud.');
    }
  };

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
    void loadPwReqs();
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
        const { password } = await createUsuario(buildPayload());
        setCreatedCreds({ email: form.email.trim(), password });
        setShowCreds(false);
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!form.id) return;
    setDeleting(true);
    try {
      await deleteUsuario(form.id);
      setConfirmDelete(false);
      setDialogOpen(false);
      setToast('Usuario eliminado.');
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo eliminar el usuario.');
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
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

      <Paper sx={{ mt: 2, borderRadius: 2.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ p: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography sx={{ fontWeight: 700 }}>Solicitudes de cambio de contraseña</Typography>
          <Chip size="small" label={`${pwReqs.filter((r) => r.estado === 'PENDIENTE').length} pendientes`} />
        </Box>
        <TableContainer sx={{ maxHeight: '45vh' }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                {['Correo', 'Fecha solicitud', 'Estado', 'Motivo', 'Resolución', 'Acciones'].map((h) => (
                  <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {pwReqs.length === 0 ? (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 2, color: 'text.secondary' }}>Sin solicitudes.</TableCell></TableRow>
              ) : pwReqs.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.email}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.created_at.slice(0, 16).replace('T', ' ')}</TableCell>
                  <TableCell>
                    <Chip size="small" variant={r.estado === 'PENDIENTE' ? 'filled' : 'outlined'}
                      color={r.estado === 'COMPLETADA' ? 'success' : r.estado === 'RECHAZADA' ? 'error' : r.estado === 'PENDIENTE' ? 'warning' : 'default'}
                      label={r.estado} />
                  </TableCell>
                  <TableCell sx={{ fontSize: 12, maxWidth: 200 }}>{r.motivo || '—'}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 12 }}>{r.resolved_at ? r.resolved_at.slice(0, 16).replace('T', ' ') : '—'}</TableCell>
                  <TableCell>
                    {r.estado === 'PENDIENTE' ? (
                      <Stack direction="row" spacing={0.5}>
                        <Button size="small" color="success" variant="outlined" onClick={() => resolverPwReq(r.id, 'aprobar', r.email)} sx={{ textTransform: 'none', minWidth: 0 }}>Aprobar</Button>
                        <Button size="small" color="error" variant="outlined" onClick={() => resolverPwReq(r.id, 'rechazar', r.email)} sx={{ textTransform: 'none', minWidth: 0 }}>Rechazar</Button>
                      </Stack>
                    ) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={Boolean(pwTemp)} onClose={() => setPwTemp(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Contraseña temporal generada</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 1 }}>
            Entrega esta contraseña al usuario <strong>{pwTemp?.email}</strong> por un canal seguro. No se volverá a mostrar.
          </Typography>
          <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <Typography sx={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700 }}>{pwTemp?.password}</Typography>
            <IconButton size="small" onClick={() => { if (pwTemp) navigator.clipboard?.writeText(pwTemp.password); setToast('Contraseña copiada.'); }}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Paper>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPwTemp(null)} sx={{ textTransform: 'none' }}>Cerrar</Button>
        </DialogActions>
      </Dialog>

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
        <DialogActions sx={{ justifyContent: 'space-between' }}>
          {form.id ? (
            <Button color="error" onClick={() => setConfirmDelete(true)} sx={{ textTransform: 'none' }}>
              Eliminar usuario
            </Button>
          ) : <span />}
          <Box>
            <Button onClick={() => setDialogOpen(false)} sx={{ textTransform: 'none' }}>Cancelar</Button>
            <Button onClick={handleSave} variant="contained" disabled={saving} sx={{ textTransform: 'none' }}>
              {saving ? <CircularProgress size={20} color="inherit" /> : form.id ? 'Guardar cambios' : 'Crear usuario'}
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      {/* Confirmación de eliminación */}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>¿Está seguro de eliminar este usuario?</DialogTitle>
        <DialogContent dividers>
          <Typography sx={{ fontSize: 14 }}>
            Esta acción eliminará el acceso del usuario a la plataforma y no podrá deshacerse.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)} sx={{ textTransform: 'none' }}>Cancelar</Button>
          <Button color="error" variant="contained" onClick={handleDelete} disabled={deleting} sx={{ textTransform: 'none' }}>
            {deleting ? <CircularProgress size={20} color="inherit" /> : 'Eliminar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Resultado de creación: contraseña temporal (solo se muestra aquí, una vez). */}
      <Dialog open={Boolean(createdCreds)} onClose={() => setCreatedCreds(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Usuario creado correctamente</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <TextField label="Email" value={createdCreds?.email ?? ''} size="small" fullWidth InputProps={{ readOnly: true }} />
            <TextField
              label="Contraseña temporal"
              value={createdCreds?.password ?? ''}
              type={showCreds ? 'text' : 'password'}
              size="small"
              fullWidth
              InputProps={{
                readOnly: true,
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setShowCreds((v) => !v)} aria-label="mostrar contraseña">
                      {showCreds ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => {
                        if (createdCreds?.password) {
                          navigator.clipboard?.writeText(createdCreds.password).catch(() => undefined);
                          setToast('Contraseña copiada.');
                        }
                      }}
                      aria-label="copiar contraseña"
                    >
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                )
              }}
            />
            <Alert severity="warning" sx={{ py: 0.5 }}>
              Comparte esta contraseña temporal de forma segura con el usuario. No se almacena en texto plano en la aplicación.
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreatedCreds(null)} variant="contained" sx={{ textTransform: 'none' }}>Entendido</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} message={toast ?? ''} />
    </Box>
  );
};

export default UsuariosPage;
