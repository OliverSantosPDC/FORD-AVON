import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
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
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import LockResetIcon from '@mui/icons-material/LockReset';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useAuth } from '../../context/AuthContext';
import {
  listUsuarios,
  getCatalogos,
  getUsuario,
  createUsuario,
  updateUsuario,
  deleteUsuario,
  resetPasswordUsuario,
  getPasswordRequests,
  resolvePasswordRequest,
  deletePasswordRequests,
  getResumenAlcance,
  type UsuarioListItem,
  type Catalogos,
  type UsuarioPayload,
  type PasswordRequest,
  type AlcanceResumenItem
} from '../../services/usuariosService';
import { getRoles, putRolPermisos, type RolesData } from '../../services/configuracionService';

/** Clave compuesta para las opciones de País/Zona (una misma zona/código puede
 *  repetirse en más de un país en cartera, así que zonaId por sí solo no es
 *  una clave única de opción). */
const pzKey = (zonaId: string, pais: string) => `${zonaId}__${pais}`;
const pzFromKey = (key: string): { zonaId: string; pais: string } => {
  const [zonaId, pais] = key.split('__');
  return { zonaId: zonaId ?? '', pais: pais ?? '' };
};

const NIVEL_LABEL: Record<number, string> = {
  1: 'Nivel 1 · Administrador',
  2: 'Nivel 2 · Liderazgo',
  3: 'Nivel 3 · Supervisor',
  4: 'Nivel 4 · Gestor',
  5: 'Nivel 5 · Gerente de zona'
};

interface FormState {
  id: string | null;
  email: string;
  nombre: string;
  apellido: string;
  roleId: string;
  activo: boolean;
  gestorIds: string[];
  gerenteZonaIds: string[];
  supervisorIds: string[];
  paisZonaKeys: string[];
  gestorPaisZonaKeys: string[];
  password: string;
  passwordConfirm: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  email: '',
  nombre: '',
  apellido: '',
  roleId: '',
  activo: true,
  gestorIds: [],
  gerenteZonaIds: [],
  supervisorIds: [],
  paisZonaKeys: [],
  gestorPaisZonaKeys: [],
  password: '',
  passwordConfirm: ''
};

const TAB_GESTION = 0;
const TAB_GRUPOS_NIVELES = 1;
const TAB_ROLES = 2;

/** Orden de agrupación por rol (Sección 11-B): respeta el Nivel jerárquico
 *  Nivel 1 -> Nivel 5. Cualquier rol no contemplado cae en "Otros" (un solo
 *  grupo, no uno por cada rol extra). El rol se lee SIEMPRE de `role.clave`
 *  (el dato real de Supabase); nunca se infiere por nombre ni por Asignación. */
const ROLE_ORDER = ['administrador', 'liderazgo', 'supervisor', 'gestor', 'gerente_zona'] as const;
const ROLE_GROUP_LABEL: Record<string, string> = {
  administrador: 'Administrador', liderazgo: 'Liderazgo', supervisor: 'Supervisor',
  gestor: 'Gestor', gerente_zona: 'Gerente de zona', otros: 'Otros'
};
type UsuarioOrden = 'AZ' | 'ZA' | 'MAYOR_MENOR';

const UsuariosPage = () => {
  const { hasPermission } = useAuth();
  const canAdminGlobal = hasPermission('usuarios.administrar_global');
  const canEditRoles = hasPermission('configuracion.editar');

  const [tab, setTab] = useState(TAB_GESTION);

  const [usuarios, setUsuarios] = useState<UsuarioListItem[]>([]);
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [resumen, setResumen] = useState<{ totalUsuarios: number; items: AlcanceResumenItem[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [createdCreds, setCreatedCreds] = useState<{ email: string; password: string } | null>(null);
  const [showCreds, setShowCreds] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetUser, setResetUser] = useState<{ id: string; email: string } | null>(null);
  const [resetPw, setResetPw] = useState({ password: '', confirm: '' });
  const [resetBusy, setResetBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pwReqs, setPwReqs] = useState<PasswordRequest[]>([]);
  const [pwTemp, setPwTemp] = useState<{ email: string; password: string } | null>(null);
  // Borrado del historial (Sección 3-4): solo COMPLETADA/RECHAZADA son "historial";
  // una PENDIENTE nunca se selecciona ni se elimina.
  const [pwSel, setPwSel] = useState<Set<string>>(new Set());
  const [confirmDeletePw, setConfirmDeletePw] = useState<string[] | null>(null);
  const [deletingPw, setDeletingPw] = useState(false);

  // Agrupación por rol de "Gestión de usuarios" (Sección 11-B): búsqueda + orden
  // + grupos expandibles, todo dentro del rol real (role.clave) de cada usuario.
  const [usuarioSearch, setUsuarioSearch] = useState('');
  const [usuarioOrden, setUsuarioOrden] = useState<UsuarioOrden>('AZ');
  const [gruposAbiertos, setGruposAbiertos] = useState<Set<string>>(new Set([...ROLE_ORDER, 'otros']));
  const toggleGrupo = (clave: string) => setGruposAbiertos((s) => { const n = new Set(s); n.has(clave) ? n.delete(clave) : n.add(clave); return n; });

  // ===== Roles y Permisos (movido desde Configuración; misma lógica/tablas) =====
  const [rolesData, setRolesData] = useState<RolesData | null>(null);
  const [roleSel, setRoleSel] = useState('');
  const [permSel, setPermSel] = useState<Set<string>>(new Set());
  const [permSearch, setPermSearch] = useState('');
  const [grpOpen, setGrpOpen] = useState<Set<string>>(new Set());

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
  const pwHistoricas = pwReqs.filter((r) => r.estado !== 'PENDIENTE');
  const togglePwSel = (id: string) => setPwSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAllPwSel = () => setPwSel((s) => (s.size === pwHistoricas.length ? new Set() : new Set(pwHistoricas.map((r) => r.id))));
  const confirmarEliminarPwHistorial = async () => {
    if (!confirmDeletePw || confirmDeletePw.length === 0) return;
    setDeletingPw(true);
    try {
      const { eliminadas, omitidas } = await deletePasswordRequests(confirmDeletePw);
      setToast(omitidas > 0 ? `${eliminadas} eliminada(s), ${omitidas} omitida(s) (activas).` : `${eliminadas} solicitud(es) eliminada(s) del historial.`);
      setPwSel(new Set());
      setConfirmDeletePw(null);
      await loadPwReqs();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudo eliminar el historial.');
    } finally {
      setDeletingPw(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, c, r] = await Promise.all([listUsuarios(), getCatalogos(), getResumenAlcance()]);
      setUsuarios(u);
      setCatalogos(c);
      setResumen(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible cargar la información. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  const loadRoles = async () => {
    try {
      const r = await getRoles();
      setRolesData(r);
      if (!roleSel && r.roles[0]) setRoleSel(r.roles[0].id);
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudieron cargar los roles.');
    }
  };

  useEffect(() => {
    void load();
    void loadPwReqs();
    void loadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!rolesData || !roleSel) return;
    setPermSel(new Set(rolesData.asignaciones.filter((a) => a.role_id === roleSel).map((a) => a.permission_id)));
  }, [roleSel, rolesData]);

  const permisosGrupos = useMemo(() => {
    const m = new Map<string, Array<{ id: string; clave: string; descripcion: string | null }>>();
    (rolesData?.permisos ?? [])
      .filter((p) => p.clave.toLowerCase().includes(permSearch.toLowerCase()) || (p.descripcion ?? '').toLowerCase().includes(permSearch.toLowerCase()))
      .forEach((p) => { const g = p.clave.split('.')[0]; if (!m.has(g)) m.set(g, []); m.get(g)!.push(p); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rolesData, permSearch]);

  const togglePerm = (id: string) => setPermSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const guardarPermisos = async () => {
    try { await putRolPermisos(roleSel, [...permSel]); setToast('Permisos guardados.'); setRolesData(await getRoles()); }
    catch (err) { setToast(err instanceof Error ? err.message : 'No se pudo guardar.'); }
  };
  const allPermIds = () => (rolesData?.permisos ?? []).map((p) => p.id);
  const restaurarPermisos = () => { if (rolesData) setPermSel(new Set(rolesData.asignaciones.filter((a) => a.role_id === roleSel).map((a) => a.permission_id))); };

  const roleClaveById = useMemo(() => {
    const map = new Map<string, string>();
    catalogos?.roles.forEach((r) => map.set(r.id, r.clave));
    return map;
  }, [catalogos]);

  const selectedRoleClave = roleClaveById.get(form.roleId) ?? '';

  const resumenPorUsuario = useMemo(() => {
    const map = new Map<string, AlcanceResumenItem>();
    (resumen?.items ?? []).forEach((it) => map.set(it.userId, it));
    return map;
  }, [resumen]);

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
        gestorIds: u.gestorIds ?? [],
        gerenteZonaIds: u.gerenteZonaIds ?? [],
        supervisorIds: u.supervisorIds ?? [],
        paisZonaKeys: (u.paisZona ?? []).map((p) => pzKey(p.zonaId, p.pais)),
        gestorPaisZonaKeys: (u.gestorPaisZona ?? []).map((p) => pzKey(p.zonaId, p.pais)),
        password: '',
        passwordConfirm: ''
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
    if (!form.id) {
      payload.email = form.email.trim();
      if (form.password) payload.password = form.password;
    }
    // La asignación de cartera es semimanual (módulo Asignación); Usuarios ya no define
    // nombre_cartera. Grupos y Niveles SÍ define las relaciones de alcance por rol.
    if (selectedRoleClave === 'supervisor') { payload.gestorIds = form.gestorIds; payload.gerenteZonaIds = form.gerenteZonaIds; }
    if (selectedRoleClave === 'liderazgo') payload.supervisorIds = form.supervisorIds;
    if (selectedRoleClave === 'gerente_zona') payload.paisZona = form.paisZonaKeys.map(pzFromKey);
    if (selectedRoleClave === 'gestor') payload.gestorPaisZona = form.gestorPaisZonaKeys.map(pzFromKey);
    return payload;
  };

  const handleSave = async () => {
    setFormError(null);
    if (!form.nombre.trim() || !form.roleId || (!form.id && !form.email.trim())) {
      setFormError('Correo, nombre y rol son obligatorios.');
      return;
    }
    if (!form.id) {
      if (!form.password || form.password.length < 8) {
        setFormError('La contraseña debe tener al menos 8 caracteres.');
        return;
      }
      if (form.password !== form.passwordConfirm) {
        setFormError('Las contraseñas no coinciden.');
        return;
      }
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

  const doResetPassword = async () => {
    if (!resetUser) return;
    if (!resetPw.password || resetPw.password.length < 8) { setToast('La contraseña debe tener al menos 8 caracteres.'); return; }
    if (resetPw.password !== resetPw.confirm) { setToast('Las contraseñas no coinciden.'); return; }
    setResetBusy(true);
    try {
      await resetPasswordUsuario(resetUser.id, resetPw.password);
      setToast('Contraseña restablecida.');
      setResetUser(null);
      setResetPw({ password: '', confirm: '' });
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudo restablecer la contraseña.');
    } finally {
      setResetBusy(false);
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

  /** Texto de "Alcance" para la tabla principal y para Grupos y Niveles: SIEMPRE
   *  calculado desde las relaciones reales configuradas (nunca desde ASIGNACION). */
  const alcanceTexto = (u: UsuarioListItem): string => {
    const clave = u.role?.clave ?? '';
    const r = resumenPorUsuario.get(u.id);
    if (!r) return '—';
    if (clave === 'liderazgo') return `${r.totalSupervisores ?? 0} supervisor(es) · ${r.paises.length} país(es) · ${r.zonas.length} zona(s)`;
    if (clave === 'supervisor') return `${r.totalGestores ?? 0} gestor(es) · ${r.paises.length} país(es) · ${r.zonas.length} zona(s)`;
    if (clave === 'gestor') return r.totalZonas ? `${r.totalZonas} zona(s) asignada(s)` : 'Sin restricción adicional';
    if (clave === 'gerente_zona') return `${r.totalZonas ?? 0} zona(s) · ${r.totalSectores ?? 0} sector(es)`;
    if (clave === 'administrador') return 'Alcance global';
    return '—';
  };

  /** Magnitud numérica del alcance de un usuario, para el orden "Mayor a Menor". */
  const alcanceNumero = (u: UsuarioListItem): number => {
    const r = resumenPorUsuario.get(u.id);
    if (!r) return 0;
    return (r.totalSupervisores ?? 0) + (r.totalGestores ?? 0) + (r.totalZonas ?? 0) + (r.totalSectores ?? 0);
  };

  /** Usuarios agrupados por rol REAL (role.clave, de Supabase), en orden de Nivel
   *  jerárquico, con búsqueda y orden ya aplicados. Un grupo sin resultados tras
   *  filtrar simplemente no se incluye (no se muestra vacío). */
  const gruposUsuarios = useMemo(() => {
    const term = usuarioSearch.trim().toLowerCase();
    const filtrados = term
      ? usuarios.filter((u) => {
          const nombreCompleto = [u.nombre, u.apellido].filter(Boolean).join(' ').toLowerCase();
          return nombreCompleto.includes(term) || u.email.toLowerCase().includes(term);
        })
      : usuarios;

    const porClave = new Map<string, UsuarioListItem[]>();
    filtrados.forEach((u) => {
      const clave = u.role?.clave && (ROLE_ORDER as readonly string[]).includes(u.role.clave) ? u.role.clave : 'otros';
      const list = porClave.get(clave) ?? [];
      list.push(u);
      porClave.set(clave, list);
    });

    const comparador = (a: UsuarioListItem, b: UsuarioListItem): number => {
      if (usuarioOrden === 'MAYOR_MENOR') return alcanceNumero(b) - alcanceNumero(a);
      const nombreA = [a.nombre, a.apellido].filter(Boolean).join(' ');
      const nombreB = [b.nombre, b.apellido].filter(Boolean).join(' ');
      return usuarioOrden === 'ZA' ? nombreB.localeCompare(nombreA, 'es') : nombreA.localeCompare(nombreB, 'es');
    };

    return [...ROLE_ORDER, 'otros']
      .map((clave) => ({ clave, label: ROLE_GROUP_LABEL[clave], usuarios: (porClave.get(clave) ?? []).slice().sort(comparador) }))
      .filter((g) => g.usuarios.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuarios, usuarioSearch, usuarioOrden, resumenPorUsuario]);

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
      <Box sx={{ mb: 1 }}>
        <Typography sx={{ fontSize: 20, fontWeight: 700 }}>Usuarios</Typography>
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
          Gestión de usuarios, Grupos y Niveles (jerarquía de alcance) y Roles y Permisos.
        </Typography>
      </Box>

      <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" sx={{ mb: 2 }}>
        <Tab value={TAB_GESTION} label="Gestión de usuarios" sx={{ textTransform: 'none' }} />
        <Tab value={TAB_GRUPOS_NIVELES} label="Grupos y Niveles" sx={{ textTransform: 'none' }} />
        <Tab value={TAB_ROLES} label="Roles y Permisos" sx={{ textTransform: 'none' }} />
      </Tabs>

      {/* ===== GESTIÓN DE USUARIOS ===== */}
      {tab === TAB_GESTION && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              {usuarios.length.toLocaleString('es')} usuario(s).
            </Typography>
            {canAdminGlobal && (
              <Button variant="contained" startIcon={<PersonAddIcon />} onClick={openCreate} sx={{ textTransform: 'none', borderRadius: 2 }}>
                Nuevo usuario
              </Button>
            )}
          </Box>

          {usuarios.length === 0 ? (
            <Paper sx={{ p: 6, textAlign: 'center', borderRadius: 3 }}>
              <Typography sx={{ fontWeight: 600 }}>No hay usuarios registrados todavía.</Typography>
            </Paper>
          ) : (
            <Stack spacing={1.5}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <TextField
                  size="small"
                  label="Buscar por nombre o correo"
                  value={usuarioSearch}
                  onChange={(e) => setUsuarioSearch(e.target.value)}
                  sx={{ minWidth: 240 }}
                />
                <TextField
                  select
                  size="small"
                  label="Ordenar"
                  value={usuarioOrden}
                  onChange={(e) => setUsuarioOrden(e.target.value as UsuarioOrden)}
                  sx={{ minWidth: 170 }}
                >
                  <MenuItem value="AZ">Nombre A-Z</MenuItem>
                  <MenuItem value="ZA">Nombre Z-A</MenuItem>
                  <MenuItem value="MAYOR_MENOR">Alcance: mayor a menor</MenuItem>
                </TextField>
                <Button size="small" onClick={() => setGruposAbiertos(new Set(gruposUsuarios.map((g) => g.clave)))} sx={{ textTransform: 'none' }}>Expandir todo</Button>
                <Button size="small" onClick={() => setGruposAbiertos(new Set())} sx={{ textTransform: 'none' }}>Contraer todo</Button>
              </Box>

              {gruposUsuarios.length === 0 ? (
                <Paper sx={{ p: 4, textAlign: 'center', borderRadius: 3 }}>
                  <Typography sx={{ color: 'text.secondary' }}>Sin resultados para "{usuarioSearch}".</Typography>
                </Paper>
              ) : gruposUsuarios.map((grupo) => (
                <Paper key={grupo.clave} sx={{ borderRadius: 2.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
                  <Box
                    onClick={() => toggleGrupo(grupo.clave)}
                    data-testid={`grupo-usuarios-${grupo.clave}`}
                    sx={{ p: 1.25, display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', bgcolor: 'action.hover' }}
                  >
                    <IconButton size="small">
                      {gruposAbiertos.has(grupo.clave) ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
                    </IconButton>
                    <Typography sx={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 13, letterSpacing: 0.4 }}>{grupo.label}</Typography>
                    <Chip size="small" label={grupo.usuarios.length} />
                  </Box>
                  <Collapse in={gruposAbiertos.has(grupo.clave)} unmountOnExit>
                    <TableContainer sx={{ maxHeight: '50vh' }}>
                      <Table stickyHeader size="small">
                        <TableHead>
                          <TableRow>
                            {['Nombre', 'Correo', 'Rol / Nivel', 'Alcance', 'Estado', 'Acciones'].map((h) => (
                              <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</TableCell>
                            ))}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {grupo.usuarios.map((u) => (
                            <TableRow key={u.id} hover>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>{[u.nombre, u.apellido].filter(Boolean).join(' ') || '—'}</TableCell>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>{u.email}</TableCell>
                              <TableCell>
                                {u.role ? <Chip size="small" label={u.role.nivel ? `${u.role.nombre} (N${u.role.nivel})` : u.role.nombre} /> : <Chip size="small" label="Sin rol" variant="outlined" />}
                              </TableCell>
                              <TableCell sx={{ fontSize: 12, whiteSpace: 'nowrap' }}>{alcanceTexto(u)}</TableCell>
                              <TableCell>
                                <FormControlLabel
                                  control={<Switch checked={u.activo} onChange={() => toggleActivo(u)} size="small" disabled={!canAdminGlobal} />}
                                  label={u.activo ? 'Activo' : 'Inactivo'}
                                  sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: 12 } }}
                                />
                              </TableCell>
                              <TableCell>
                                {canAdminGlobal ? (
                                  <>
                                    <Button size="small" startIcon={<EditOutlinedIcon fontSize="small" />} onClick={() => openEdit(u.id)} sx={{ textTransform: 'none' }}>
                                      Editar
                                    </Button>
                                    <Button size="small" startIcon={<LockResetIcon fontSize="small" />} onClick={() => { setResetUser({ id: u.id, email: u.email }); setResetPw({ password: '', confirm: '' }); }} sx={{ textTransform: 'none' }}>
                                      Contraseña
                                    </Button>
                                  </>
                                ) : '—'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Collapse>
                </Paper>
              ))}
            </Stack>
          )}

          {canAdminGlobal && (
            <Paper sx={{ mt: 2, borderRadius: 2.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ p: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                <Typography sx={{ fontWeight: 700 }}>Solicitudes de cambio de contraseña</Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip size="small" label={`${pwReqs.filter((r) => r.estado === 'PENDIENTE').length} pendientes`} />
                  <Chip size="small" variant="outlined" label={`${pwHistoricas.length} en historial`} />
                  {pwSel.size > 0 && (
                    <Button size="small" color="error" variant="outlined" startIcon={<DeleteOutlineIcon fontSize="small" />}
                      onClick={() => setConfirmDeletePw([...pwSel])} sx={{ textTransform: 'none' }}>
                      Eliminar seleccionadas ({pwSel.size})
                    </Button>
                  )}
                </Stack>
              </Box>
              <TableContainer sx={{ maxHeight: '45vh' }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox">
                        <Checkbox size="small" indeterminate={pwSel.size > 0 && pwSel.size < pwHistoricas.length}
                          checked={pwHistoricas.length > 0 && pwSel.size === pwHistoricas.length}
                          disabled={pwHistoricas.length === 0} onChange={toggleAllPwSel} />
                      </TableCell>
                      {['Correo', 'Fecha solicitud', 'Estado', 'Motivo', 'Resolución', 'Acciones'].map((h) => (
                        <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pwReqs.length === 0 ? (
                      <TableRow><TableCell colSpan={7} align="center" sx={{ py: 2, color: 'text.secondary' }}>Sin solicitudes.</TableCell></TableRow>
                    ) : pwReqs.map((r) => {
                      const esHistorial = r.estado !== 'PENDIENTE';
                      return (
                      <TableRow key={r.id} hover selected={pwSel.has(r.id)}>
                        <TableCell padding="checkbox">
                          {esHistorial && <Checkbox size="small" checked={pwSel.has(r.id)} onChange={() => togglePwSel(r.id)} />}
                        </TableCell>
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
                          ) : (
                            <IconButton size="small" color="error" title="Eliminar del historial" onClick={() => setConfirmDeletePw([r.id])}>
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          )}
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}

          <Dialog open={confirmDeletePw !== null} onClose={() => setConfirmDeletePw(null)} maxWidth="xs" fullWidth>
            <DialogTitle>Eliminar historial</DialogTitle>
            <DialogContent>
              <Typography sx={{ fontSize: 14 }}>
                ¿Deseas eliminar {confirmDeletePw?.length ?? 0} solicitud{(confirmDeletePw?.length ?? 0) === 1 ? '' : 'es'} del historial?
              </Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>
                Esta acción no afecta solicitudes pendientes ni la contraseña, el usuario, su rol o sus permisos.
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirmDeletePw(null)} sx={{ textTransform: 'none' }}>Cancelar</Button>
              <Button color="error" variant="contained" onClick={confirmarEliminarPwHistorial} disabled={deletingPw} sx={{ textTransform: 'none' }}>
                {deletingPw ? <CircularProgress size={18} color="inherit" /> : 'Eliminar'}
              </Button>
            </DialogActions>
          </Dialog>
        </>
      )}

      {/* ===== GRUPOS Y NIVELES ===== */}
      {tab === TAB_GRUPOS_NIVELES && (
        <Stack spacing={2}>
          <Paper sx={{ p: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
            <Typography sx={{ fontWeight: 700, mb: 0.5 }}>Jerarquía oficial</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              Administrador (N1) → Liderazgo (N2) → Supervisor (N3) → Gestor (N4) → Gerente de zona (N5) → Zona (dato de cartera, no es un rol).
              Cada usuario dependiente queda asociado a su Grupo/Nivel mediante las relaciones configuradas abajo (nunca mediante Asignación).
            </Typography>
          </Paper>

          <Grid container spacing={1.5}>
            <Grid item xs={12} sm={4} md={2.4}>
              <Paper sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase' }}>Nivel 1 · Administrador</Typography>
                <Typography sx={{ fontSize: 20, fontWeight: 800 }}>{resumen?.totalUsuarios ?? 0}</Typography>
                <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>usuarios totales en el sistema</Typography>
              </Paper>
            </Grid>
          </Grid>

          {[2, 3, 4, 5].map((nivel) => {
            const usuariosNivel = usuarios.filter((u) => u.role?.nivel === nivel);
            return (
              <Paper key={nivel} sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
                <Box sx={{ p: 1.5 }}>
                  <Typography sx={{ fontWeight: 700 }}>{NIVEL_LABEL[nivel]}</Typography>
                  <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{usuariosNivel.length} usuario(s) en este nivel</Typography>
                </Box>
                <TableContainer sx={{ maxHeight: 320 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        {['Usuario', 'Dependencia', 'Alcance calculado'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {usuariosNivel.length === 0 ? (
                        <TableRow><TableCell colSpan={3} align="center" sx={{ py: 2, color: 'text.secondary', fontSize: 12 }}>Sin usuarios en este nivel.</TableCell></TableRow>
                      ) : usuariosNivel.map((u) => (
                        <TableRow key={u.id} hover>
                          <TableCell sx={{ fontSize: 12 }}>{[u.nombre, u.apellido].filter(Boolean).join(' ')}</TableCell>
                          <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>
                            {nivel === 2 ? 'Administrador' : nivel === 3 ? 'Liderazgo' : nivel === 4 ? 'Supervisor' : 'Supervisor'}
                          </TableCell>
                          <TableCell sx={{ fontSize: 12 }}>{alcanceTexto(u)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            );
          })}
        </Stack>
      )}

      {/* ===== ROLES Y PERMISOS (movido desde Configuración) ===== */}
      {tab === TAB_ROLES && rolesData && (
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <Paper sx={{ p: 1.5, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
              <Typography sx={{ fontWeight: 700, mb: 1 }}>Roles</Typography>
              <Stack>
                {rolesData.roles.map((r) => (
                  <Button key={r.id} onClick={() => setRoleSel(r.id)} variant={roleSel === r.id ? 'contained' : 'text'} sx={{ justifyContent: 'flex-start', textTransform: 'none' }}>{r.nombre}</Button>
                ))}
              </Stack>
            </Paper>
          </Grid>
          <Grid item xs={12} md={9}>
            <Paper sx={{ p: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5, flexWrap: 'wrap' }}>
                <TextField size="small" label="Buscar permiso" value={permSearch} onChange={(e) => setPermSearch(e.target.value)} />
                <Button size="small" onClick={() => setGrpOpen(new Set(permisosGrupos.map((g) => g[0])))} sx={{ textTransform: 'none' }}>Expandir todo</Button>
                <Button size="small" onClick={() => setGrpOpen(new Set())} sx={{ textTransform: 'none' }}>Contraer todo</Button>
                {canEditRoles && <Button size="small" onClick={() => setPermSel(new Set(allPermIds()))} sx={{ textTransform: 'none' }}>Seleccionar todo</Button>}
                {canEditRoles && <Button size="small" onClick={() => setPermSel(new Set())} sx={{ textTransform: 'none' }}>Deseleccionar todo</Button>}
                {canEditRoles && <Button size="small" onClick={restaurarPermisos} sx={{ textTransform: 'none' }}>Restaurar</Button>}
                <Box sx={{ flex: 1 }} />
                {canEditRoles && <Button variant="contained" size="small" onClick={guardarPermisos} sx={{ textTransform: 'none' }}>Guardar cambios</Button>}
              </Box>
              <Box sx={{ maxHeight: '60vh', overflowY: 'auto' }}>
                {permisosGrupos.map(([grupo, permisos]) => (
                  <Box key={grupo}>
                    <Box sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={() => setGrpOpen((s) => { const n = new Set(s); n.has(grupo) ? n.delete(grupo) : n.add(grupo); return n; })}>
                      <IconButton size="small">{grpOpen.has(grupo) ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}</IconButton>
                      <Typography sx={{ fontWeight: 700, textTransform: 'capitalize' }}>{grupo}</Typography>
                      <Chip size="small" label={permisos.filter((p) => permSel.has(p.id)).length + '/' + permisos.length} sx={{ ml: 1 }} />
                    </Box>
                    <Collapse in={grpOpen.has(grupo)} unmountOnExit>
                      <Stack sx={{ pl: 5 }}>
                        {permisos.map((p) => (
                          <FormControlLabel key={p.id} control={<Checkbox size="small" checked={permSel.has(p.id)} disabled={!canEditRoles} onChange={() => togglePerm(p.id)} />} label={<Typography sx={{ fontSize: 13 }}>{p.clave} <Typography component="span" sx={{ color: 'text.secondary', fontSize: 12 }}>· {p.descripcion}</Typography></Typography>} />
                        ))}
                      </Stack>
                    </Collapse>
                  </Box>
                ))}
              </Box>
            </Paper>
          </Grid>
        </Grid>
      )}

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
              label="Rol / Nivel"
              value={form.roleId}
              onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value, gestorIds: [], gerenteZonaIds: [], supervisorIds: [], paisZonaKeys: [], gestorPaisZonaKeys: [] }))}
              size="small"
              fullWidth
            >
              {(catalogos?.roles ?? []).map((r) => (
                <MenuItem key={r.id} value={r.id}>{r.nivel ? `${r.nombre} (Nivel ${r.nivel})` : r.nombre}</MenuItem>
              ))}
            </TextField>

            {/* Contraseña inicial (solo al crear). La asignación de cartera es semimanual. */}
            {!form.id && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Contraseña inicial"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  size="small" fullWidth
                  helperText="Mínimo 8 caracteres."
                  InputProps={{ endAdornment: (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={() => setShowPassword((v) => !v)} edge="end">
                        {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                      </IconButton>
                    </InputAdornment>
                  ) }}
                />
                <TextField
                  label="Confirmar contraseña"
                  type={showPassword ? 'text' : 'password'}
                  value={form.passwordConfirm}
                  onChange={(e) => setForm((f) => ({ ...f, passwordConfirm: e.target.value }))}
                  size="small" fullWidth
                  error={Boolean(form.passwordConfirm) && form.password !== form.passwordConfirm}
                  helperText={Boolean(form.passwordConfirm) && form.password !== form.passwordConfirm ? 'No coincide.' : ' '}
                />
              </Stack>
            )}

            {selectedRoleClave === 'liderazgo' && (
              <FormControl size="small" fullWidth>
                <InputLabel id="lid-supervisores">Supervisores asignados</InputLabel>
                <Select
                  labelId="lid-supervisores"
                  multiple
                  value={form.supervisorIds}
                  onChange={(e) => setForm((f) => ({ ...f, supervisorIds: e.target.value as string[] }))}
                  input={<OutlinedInput label="Supervisores asignados" />}
                  renderValue={(sel) =>
                    (catalogos?.supervisores ?? [])
                      .filter((s) => (sel as string[]).includes(s.id))
                      .map((s) => [s.nombre, s.apellido].filter(Boolean).join(' '))
                      .join(', ')
                  }
                >
                  {(catalogos?.supervisores ?? []).map((s) => (
                    <MenuItem key={s.id} value={s.id}>
                      <Checkbox checked={form.supervisorIds.includes(s.id)} size="small" />
                      <ListItemText primary={[s.nombre, s.apellido].filter(Boolean).join(' ')} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
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

            {selectedRoleClave === 'supervisor' && (
              <FormControl size="small" fullWidth>
                <InputLabel id="sup-gerentes-zona">Gerentes de zona supervisados</InputLabel>
                <Select
                  labelId="sup-gerentes-zona"
                  multiple
                  value={form.gerenteZonaIds}
                  onChange={(e) => setForm((f) => ({ ...f, gerenteZonaIds: e.target.value as string[] }))}
                  input={<OutlinedInput label="Gerentes de zona supervisados" />}
                  renderValue={(sel) =>
                    (catalogos?.gerentesZona ?? [])
                      .filter((g) => (sel as string[]).includes(g.id))
                      .map((g) => [g.nombre, g.apellido].filter(Boolean).join(' '))
                      .join(', ')
                  }
                >
                  {(catalogos?.gerentesZona ?? []).map((g) => (
                    <MenuItem key={g.id} value={g.id}>
                      <Checkbox checked={form.gerenteZonaIds.includes(g.id)} size="small" />
                      <ListItemText primary={[g.nombre, g.apellido].filter(Boolean).join(' ')} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {selectedRoleClave === 'gerente_zona' && (
              <FormControl size="small" fullWidth>
                <InputLabel id="ger-paiszona">País - Zona asignados</InputLabel>
                <Select
                  labelId="ger-paiszona"
                  multiple
                  value={form.paisZonaKeys}
                  onChange={(e) => setForm((f) => ({ ...f, paisZonaKeys: e.target.value as string[] }))}
                  input={<OutlinedInput label="País - Zona asignados" />}
                  renderValue={(sel) => (sel as string[]).length + ' seleccionada(s)'}
                >
                  {(catalogos?.carteraPaisZona ?? []).map((pz) => {
                    const key = pzKey(pz.zonaId, pz.pais);
                    return (
                      <MenuItem key={key} value={key}>
                        <Checkbox checked={form.paisZonaKeys.includes(key)} size="small" />
                        <ListItemText primary={`${pz.pais} — ${pz.zona}`} />
                      </MenuItem>
                    );
                  })}
                </Select>
              </FormControl>
            )}

            {selectedRoleClave === 'gestor' && (
              <FormControl size="small" fullWidth>
                <InputLabel id="ges-paiszona">País - Zona asignados (opcional)</InputLabel>
                <Select
                  labelId="ges-paiszona"
                  multiple
                  value={form.gestorPaisZonaKeys}
                  onChange={(e) => setForm((f) => ({ ...f, gestorPaisZonaKeys: e.target.value as string[] }))}
                  input={<OutlinedInput label="País - Zona asignados (opcional)" />}
                  renderValue={(sel) => (sel as string[]).length ? (sel as string[]).length + ' seleccionada(s)' : 'Sin restricción adicional'}
                >
                  {(catalogos?.carteraPaisZona ?? []).map((pz) => {
                    const key = pzKey(pz.zonaId, pz.pais);
                    return (
                      <MenuItem key={key} value={key}>
                        <Checkbox checked={form.gestorPaisZonaKeys.includes(key)} size="small" />
                        <ListItemText primary={`${pz.pais} — ${pz.zona}`} />
                      </MenuItem>
                    );
                  })}
                </Select>
                <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.5 }}>
                  Opcional: si no seleccionas ninguno, el gestor conserva su alcance actual (por nombre en cartera).
                </Typography>
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

      {/* Restablecer contraseña */}
      <Dialog open={Boolean(resetUser)} onClose={resetBusy ? undefined : () => setResetUser(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Restablecer contraseña</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Usuario: <strong>{resetUser?.email}</strong>. No se muestra la contraseña actual.</Typography>
            <TextField
              label="Nueva contraseña" type={showPassword ? 'text' : 'password'} value={resetPw.password}
              onChange={(e) => setResetPw((p) => ({ ...p, password: e.target.value }))} size="small" fullWidth
              helperText="Mínimo 8 caracteres."
              InputProps={{ endAdornment: (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setShowPassword((v) => !v)} edge="end">
                    {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                  </IconButton>
                </InputAdornment>
              ) }}
            />
            <TextField
              label="Confirmar contraseña" type={showPassword ? 'text' : 'password'} value={resetPw.confirm}
              onChange={(e) => setResetPw((p) => ({ ...p, confirm: e.target.value }))} size="small" fullWidth
              error={Boolean(resetPw.confirm) && resetPw.password !== resetPw.confirm}
              helperText={Boolean(resetPw.confirm) && resetPw.password !== resetPw.confirm ? 'No coincide.' : ' '}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetUser(null)} disabled={resetBusy} sx={{ textTransform: 'none' }}>Cancelar</Button>
          <Button variant="contained" onClick={doResetPassword} disabled={resetBusy} sx={{ textTransform: 'none' }}>
            {resetBusy ? <CircularProgress size={18} color="inherit" /> : 'Restablecer'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} message={toast ?? ''} />
    </Box>
  );
};

export default UsuariosPage;
