import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
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
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
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
import LockClockIcon from '@mui/icons-material/LockClock';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined';
import AddIcon from '@mui/icons-material/Add';
import { useAuth } from '../../context/AuthContext';
import { downloadBlob, exportRowsToExcel } from '../../utils/tableExport';
import {
  listUsuarios,
  getCatalogos,
  getUsuario,
  createUsuario,
  updateUsuario,
  deleteUsuario,
  resetPasswordUsuario,
  resetPasswordTemporalUsuario,
  getPasswordRequests,
  resolvePasswordRequest,
  deletePasswordRequests,
  getResumenAlcance,
  validarEliminacionMasivaUsuarios,
  eliminarUsuariosMasivo,
  descargarPlantillaAdministrativa,
  descargarPlantillaComercial,
  validarImportacionUsuarios,
  aplicarImportacionUsuarios,
  type UsuarioListItem,
  type Catalogos,
  type UsuarioPayload,
  type PasswordRequest,
  type AlcanceResumenItem,
  type ValidacionEliminacionMasiva,
  type GerenteZonaAsignacion,
  type PreviewItem,
  type ResumenImport,
  type ResultadoAplicarItem
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

interface FormState {
  id: string | null;
  email: string;
  nombre: string;
  apellido: string;
  /** Nombre completo: sincronizado automáticamente con nombre+apellido salvo
   *  que `nombreCompletoTocado` esté activo (edición manual explícita). */
  nombreCompleto: string;
  nombreCompletoTocado: boolean;
  contacto: string;
  /** País de identidad de la persona (columna PAIS de la plantilla) —
   *  distinto de las asignaciones de territorio de Gestor/Gerente de zona. */
  pais: string;
  roleId: string;
  activo: boolean;
  gestorIds: string[];
  gerenteZonaIds: string[];
  supervisorIds: string[];
  /** Gerente de zona -> asignaciones País/División/Zona (reemplaza por completo al guardar). */
  gerenteZonaAsignaciones: GerenteZonaAsignacion[];
  gestorPaisZonaKeys: string[];
  /** Filtro de País (solo UI) para acotar las opciones de Zona del selector del Gestor. */
  gestorPaisFiltro: string;
  password: string;
  passwordConfirm: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  email: '',
  nombre: '',
  apellido: '',
  nombreCompleto: '',
  nombreCompletoTocado: false,
  contacto: '',
  pais: '',
  roleId: '',
  activo: true,
  gestorIds: [],
  gerenteZonaIds: [],
  supervisorIds: [],
  gerenteZonaAsignaciones: [],
  gestorPaisZonaKeys: [],
  gestorPaisFiltro: '',
  password: '',
  passwordConfirm: ''
};

const TAB_GESTION = 0;
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
  // Constructor de asignaciones País/División/Zona para Gerente de zona
  // (Sección 5): se arma una combinación y se "agrega" a la lista final del
  // formulario — nunca se envía directamente, evita duplicados.
  const [nuevaAsigPais, setNuevaAsigPais] = useState('');
  const [nuevaAsigDivision, setNuevaAsigDivision] = useState('');
  const [nuevaAsigZonas, setNuevaAsigZonas] = useState<Array<{ zonaId: string; zona: string }>>([]);

  // Importación masiva (plantillas Administrativa/Comercial) — Configuración > Usuarios.
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<{ items: PreviewItem[]; resumen: ResumenImport } | null>(null);
  const [importResult, setImportResult] = useState<{ resultados: ResultadoAplicarItem[]; resumen: ResumenImport } | null>(null);
  const [importSoloErrores, setImportSoloErrores] = useState(false);
  const importItemsMostrados = useMemo(
    () => (importPreview ? (importSoloErrores ? importPreview.items.filter((it) => it.estado === 'ERROR') : importPreview.items) : []),
    [importPreview, importSoloErrores]
  );

  const onDescargarPlantillaAdministrativa = async () => {
    setImportError(null);
    try { downloadBlob(await descargarPlantillaAdministrativa(), 'plantilla_usuarios_administrativo.xlsx'); }
    catch (err) { setImportError(err instanceof Error ? err.message : 'No se pudo descargar la plantilla.'); }
  };
  const onDescargarPlantillaComercial = async () => {
    setImportError(null);
    try { downloadBlob(await descargarPlantillaComercial(), 'plantilla_usuarios_comercial.xlsx'); }
    catch (err) { setImportError(err instanceof Error ? err.message : 'No se pudo descargar la plantilla.'); }
  };
  const onSeleccionarArchivoImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setImportFile(f);
    setImportPreview(null);
    setImportResult(null);
    setImportError(null);
  };
  const onValidarImportacion = async () => {
    if (!importFile) return;
    setImportBusy(true); setImportError(null); setImportResult(null);
    try { setImportPreview(await validarImportacionUsuarios(importFile)); }
    catch (err) { setImportError(err instanceof Error ? err.message : 'No se pudo validar el archivo.'); }
    finally { setImportBusy(false); }
  };
  const onAplicarImportacion = async (soloValidas: boolean) => {
    if (!importFile) return;
    setImportBusy(true); setImportError(null);
    try {
      const res = await aplicarImportacionUsuarios(importFile, soloValidas);
      setImportResult(res);
      setImportPreview(null);
      await load();
    } catch (err) { setImportError(err instanceof Error ? err.message : 'No se pudo procesar el archivo.'); }
    finally { setImportBusy(false); }
  };
  const onDescargarReporteImportacion = () => {
    if (!importResult) return;
    const headers = ['HOJA', 'FILA', 'ACCION', 'EMAIL', 'NOMBRE', 'APELLIDO', 'ROL', 'RESULTADO', 'CONTRASEÑA_TEMPORAL', 'MENSAJE'];
    const rows = importResult.resultados.map((r) => [r.hoja, r.fila, r.accion, r.email, r.nombre ?? '', r.apellido ?? '', r.rol, r.resultado, r.password ?? '', r.mensaje]);
    exportRowsToExcel('resultado_importacion_usuarios.xlsx', 'Resultado', headers, rows);
  };
  const importHayPasswords = Boolean(importResult?.resultados.some((r) => r.password));
  const importTieneErrores = (importPreview?.resumen.errores ?? 0) > 0;
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [createdCreds, setCreatedCreds] = useState<{ email: string; password: string } | null>(null);
  const [showCreds, setShowCreds] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetUser, setResetUser] = useState<{ id: string; email: string } | null>(null);
  const [resetPw, setResetPw] = useState({ password: '', confirm: '' });
  const [resetBusy, setResetBusy] = useState(false);
  // "Restablecer contraseña" (política Avon2026, 15 días) — distinta del reset de
  // contraseña libre de arriba. Solo elegible para usuarios NO administradores
  // (el botón ya no aparece para administradores; el backend lo re-valida igual).
  const [resetTemporalUser, setResetTemporalUser] = useState<{ id: string; email: string } | null>(null);
  const [resetTemporalBusy, setResetTemporalBusy] = useState(false);
  const [resetTemporalResult, setResetTemporalResult] = useState<{ email: string; expiresAt: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pwReqs, setPwReqs] = useState<PasswordRequest[]>([]);
  const [pwTemp, setPwTemp] = useState<{ email: string; password: string } | null>(null);
  // Borrado del historial (Sección 3-4): solo COMPLETADA/RECHAZADA son "historial";
  // una PENDIENTE nunca se selecciona ni se elimina.
  const [pwSel, setPwSel] = useState<Set<string>>(new Set());
  const [confirmDeletePw, setConfirmDeletePw] = useState<string[] | null>(null);
  const [deletingPw, setDeletingPw] = useState(false);

  // Selección múltiple + eliminación masiva (Secciones 1-9): "Gestión de
  // usuarios" alimenta el diálogo/lógica de confirmación — reutiliza
  // exactamente los mismos endpoints (validarEliminacionMasivaUsuarios/
  // eliminarUsuariosMasivo), sin duplicar backend ni el flujo de confirmación.
  type BulkDeleteSource = { kind: 'gestion' };

  // Selección de "Gestión de usuarios" (Sección 1-3): UNA selección global,
  // independiente de los grupos por rol (un usuario aparece en un solo grupo,
  // pero la selección/el botón "Eliminar seleccionados" es único para la tabla).
  const [selUsuarios, setSelUsuarios] = useState<Set<string>>(new Set());
  const toggleSelUsuario = (id: string) => setSelUsuarios((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelGrupoUsuarios = (ids: string[]) => setSelUsuarios((s) => {
    const n = new Set(s);
    const todos = ids.length > 0 && ids.every((id) => n.has(id));
    ids.forEach((id) => (todos ? n.delete(id) : n.add(id)));
    return n;
  });

  const [bulkDeleteTarget, setBulkDeleteTarget] = useState<{ source: BulkDeleteSource; ids: string[] } | null>(null);
  const [bulkValidando, setBulkValidando] = useState(false);
  const [bulkValidacion, setBulkValidacion] = useState<ValidacionEliminacionMasiva | null>(null);
  const [bulkEjecutando, setBulkEjecutando] = useState(false);
  const abrirConfirmBulkDelete = async (source: BulkDeleteSource, ids: string[]) => {
    if (ids.length === 0) return;
    setBulkDeleteTarget({ source, ids });
    setBulkValidacion(null);
    setBulkValidando(true);
    try {
      setBulkValidacion(await validarEliminacionMasivaUsuarios(ids));
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudo validar la selección.');
      setBulkDeleteTarget(null);
    } finally {
      setBulkValidando(false);
    }
  };
  const cerrarBulkDelete = () => { setBulkDeleteTarget(null); setBulkValidacion(null); };
  const confirmarBulkDelete = async () => {
    if (!bulkDeleteTarget) return;
    setBulkEjecutando(true);
    try {
      const r = await eliminarUsuariosMasivo(bulkDeleteTarget.ids);
      const problemas = r.bloqueados.length + r.errores.length;
      setToast(problemas > 0
        ? `${r.eliminados.length} usuario(s) eliminado(s) correctamente; ${problemas} no se pudieron eliminar.`
        : `${r.eliminados.length} usuario(s) eliminado(s) correctamente.`);
      setSelUsuarios(new Set());
      cerrarBulkDelete();
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudo completar la eliminación masiva.');
    } finally {
      setBulkEjecutando(false);
    }
  };

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

  // Nombre completo: sincronizado automáticamente con Nombre+Apellido mientras
  // no se haya editado manualmente (Sección 3: "mantenlo sincronizado sin
  // impedir la corrección manual cuando corresponda").
  useEffect(() => {
    if (dialogOpen && !form.nombreCompletoTocado) {
      const auto = [form.nombre, form.apellido].filter(Boolean).join(' ');
      setForm((f) => (f.nombreCompletoTocado ? f : { ...f, nombreCompleto: auto }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.nombre, form.apellido, form.nombreCompletoTocado, dialogOpen]);

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

  // Países reales disponibles para los selectores de territorio (Gestor/Gerente
  // de zona): unión de los países con cartera real y los ya usados en
  // asignaciones de Gerente de zona — nunca una lista inventada.
  const paisesDisponibles = useMemo(() => {
    const s = new Set<string>();
    (catalogos?.carteraPaisZona ?? []).forEach((z) => s.add(z.pais));
    (catalogos?.gerenteZonaPaisDivisionZona ?? []).forEach((z) => s.add(z.pais));
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'es'));
  }, [catalogos]);

  const zonasPorPais = (pais: string): Array<{ zonaId: string; zona: string }> => {
    const mapa = new Map<string, { zonaId: string; zona: string }>();
    (catalogos?.carteraPaisZona ?? []).filter((z) => z.pais === pais).forEach((z) => mapa.set(z.zonaId, { zonaId: z.zonaId, zona: z.zona }));
    (catalogos?.gerenteZonaPaisDivisionZona ?? []).filter((z) => z.pais === pais).forEach((z) => mapa.set(z.zonaId, { zonaId: z.zonaId, zona: z.zona }));
    return Array.from(mapa.values()).sort((a, b) => a.zona.localeCompare(b.zona, 'es', { numeric: true }));
  };

  const divisionesPorPais = (pais: string): string[] =>
    Array.from(new Set((catalogos?.gerenteZonaPaisDivisionZona ?? [])
      .filter((z) => z.pais === pais && z.division)
      .map((z) => z.division as string)))
      .sort((a, b) => a.localeCompare(b, 'es'));

  /** Zonas "conocidas" (vigentes) de un País/División — misma fuente que el
   *  backend usa para expandir el marcador ZONA="GV" al importar (ver
   *  construirMapaZonasPorDivision en UsuariosService): nunca inventa una
   *  zona, solo reutiliza las ya registradas en gerente_zona_zona para esa
   *  combinación exacta de país + división. */
  const zonasConocidasPorPaisDivision = (pais: string, division: string): Array<{ zonaId: string; zona: string }> => {
    const divisionNorm = division.trim().toLowerCase();
    const mapa = new Map<string, { zonaId: string; zona: string }>();
    (catalogos?.gerenteZonaPaisDivisionZona ?? [])
      .filter((z) => z.pais === pais && (z.division ?? '').trim().toLowerCase() === divisionNorm)
      .forEach((z) => mapa.set(z.zonaId, { zonaId: z.zonaId, zona: z.zona }));
    return Array.from(mapa.values()).sort((a, b) => a.zona.localeCompare(b.zona, 'es', { numeric: true }));
  };

  const seleccionarTodasZonasGV = () => {
    if (!nuevaAsigPais || !nuevaAsigDivision.trim()) return;
    const zonas = zonasConocidasPorPaisDivision(nuevaAsigPais, nuevaAsigDivision);
    if (zonas.length === 0) {
      setFormError(`No se encontraron zonas conocidas para la división "${nuevaAsigDivision.trim()}" en ${nuevaAsigPais}. Agrega primero al menos una zona manualmente para esa división.`);
      return;
    }
    setFormError(null);
    setNuevaAsigZonas(zonas);
  };

  const agregarAsignacionGerente = () => {
    if (!nuevaAsigPais || !nuevaAsigDivision.trim() || nuevaAsigZonas.length === 0) return;
    setForm((f) => {
      const existentes = new Set(f.gerenteZonaAsignaciones.map((a) => `${a.pais}||${a.zonaId}`));
      const nuevas: GerenteZonaAsignacion[] = nuevaAsigZonas
        .filter((z) => !existentes.has(`${nuevaAsigPais}||${z.zonaId}`))
        .map((z) => ({ zonaId: z.zonaId, zona: z.zona, pais: nuevaAsigPais, division: nuevaAsigDivision.trim() }));
      return { ...f, gerenteZonaAsignaciones: [...f.gerenteZonaAsignaciones, ...nuevas] };
    });
    setNuevaAsigZonas([]);
  };

  const quitarAsignacionGerente = (zonaId: string, pais: string) => {
    setForm((f) => ({ ...f, gerenteZonaAsignaciones: f.gerenteZonaAsignaciones.filter((a) => !(a.zonaId === zonaId && a.pais === pais)) }));
  };

  const resumenPorUsuario = useMemo(() => {
    const map = new Map<string, AlcanceResumenItem>();
    (resumen?.items ?? []).forEach((it) => map.set(it.userId, it));
    return map;
  }, [resumen]);

  const resetConstructorAsignacion = () => {
    setNuevaAsigPais('');
    setNuevaAsigDivision('');
    setNuevaAsigZonas([]);
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    resetConstructorAsignacion();
    setDialogOpen(true);
  };

  const openEdit = async (id: string) => {
    setFormError(null);
    resetConstructorAsignacion();
    try {
      const u = await getUsuario(id);
      setForm({
        id: u.id,
        email: u.email,
        nombre: u.nombre,
        apellido: u.apellido ?? '',
        // Si ya tiene un nombre completo guardado, se trata como "tocado"
        // (no se recalcula automáticamente al editar nombre/apellido) —
        // evita sobrescribir un valor que un administrador ya personalizó.
        nombreCompleto: u.nombreCompleto ?? [u.nombre, u.apellido].filter(Boolean).join(' '),
        nombreCompletoTocado: Boolean((u.nombreCompleto ?? '').trim()),
        contacto: u.contacto ?? '',
        pais: u.pais ?? '',
        roleId: u.roleId ?? '',
        activo: u.activo,
        gestorIds: u.gestorIds ?? [],
        gerenteZonaIds: u.gerenteZonaIds ?? [],
        supervisorIds: u.supervisorIds ?? [],
        gerenteZonaAsignaciones: u.paisZona ?? [],
        gestorPaisZonaKeys: (u.gestorPaisZona ?? []).map((p) => pzKey(p.zonaId, p.pais)),
        gestorPaisFiltro: '',
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
      activo: form.activo,
      contacto: form.contacto.trim() || null,
      pais: form.pais.trim() || null,
      nombreCompleto: form.nombreCompleto.trim() || null,
      // Email editable también al editar (Sección 3): el backend valida
      // formato/duplicados y actualiza Supabase Auth antes de aplicar el
      // cambio; si no cambió, es un no-op seguro (mismo valor que ya tenía).
      email: form.email.trim()
    };
    if (!form.id) {
      if (form.password) payload.password = form.password;
    }
    // La asignación de cartera es semimanual (módulo Asignación); Usuarios ya no define
    // nombre_cartera. Grupos y Niveles SÍ define las relaciones de alcance por rol.
    if (selectedRoleClave === 'supervisor') { payload.gestorIds = form.gestorIds; payload.gerenteZonaIds = form.gerenteZonaIds; }
    if (selectedRoleClave === 'liderazgo') payload.supervisorIds = form.supervisorIds;
    if (selectedRoleClave === 'gerente_zona') {
      payload.paisZona = form.gerenteZonaAsignaciones.map((a) => ({ zonaId: a.zonaId, pais: a.pais, division: a.division || null }));
    }
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

  const doResetPasswordTemporal = async () => {
    if (!resetTemporalUser) return;
    setResetTemporalBusy(true);
    try {
      const result = await resetPasswordTemporalUsuario(resetTemporalUser.id);
      setResetTemporalUser(null);
      setResetTemporalResult(result);
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudo restablecer la contraseña temporal.');
      setResetTemporalUser(null);
    } finally {
      setResetTemporalBusy(false);
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

  // Todos los ids REALMENTE filtrados (búsqueda aplicada, sin paginación): es
  // exactamente lo que "Seleccionar todos" debe seleccionar (Sección 3).
  const idsUsuariosFiltrados = useMemo(() => gruposUsuarios.flatMap((g) => g.usuarios.map((u) => u.id)), [gruposUsuarios]);
  const todosFiltradosSeleccionados = idsUsuariosFiltrados.length > 0 && idsUsuariosFiltrados.every((id) => selUsuarios.has(id));

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
          Gestión de usuarios y Roles y Permisos.
        </Typography>
      </Box>

      <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" sx={{ mb: 2 }}>
        <Tab value={TAB_GESTION} label="Gestión de usuarios" sx={{ textTransform: 'none' }} />
        <Tab value={TAB_ROLES} label="Roles y Permisos" sx={{ textTransform: 'none' }} />
      </Tabs>

      {/* ===== GESTIÓN DE USUARIOS ===== */}
      {tab === TAB_GESTION && (
        <>
          {canAdminGlobal && (
            <Accordion sx={{ mb: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider', '&:before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography sx={{ fontWeight: 700, fontSize: 14 }}>Importar usuarios (plantillas Administrativa / Comercial)</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={2}>
                  <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                    Descarga la plantilla correspondiente, complétala y súbela (puedes subir un archivo con ambas hojas o solo una).
                    Primero se valida (sin cambios en la base de datos) y luego confirmas la aplicación.
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Button variant="outlined" startIcon={<DownloadOutlinedIcon />} onClick={onDescargarPlantillaAdministrativa} sx={{ textTransform: 'none', borderRadius: 2 }}>
                      Plantilla Administrativa
                    </Button>
                    <Button variant="outlined" startIcon={<DownloadOutlinedIcon />} onClick={onDescargarPlantillaComercial} sx={{ textTransform: 'none', borderRadius: 2 }}>
                      Plantilla Comercial
                    </Button>
                    <input ref={importInputRef} type="file" accept=".xlsx" onChange={onSeleccionarArchivoImport} style={{ display: 'none' }} />
                    <Button variant="outlined" startIcon={<UploadFileOutlinedIcon />} onClick={() => importInputRef.current?.click()} sx={{ textTransform: 'none', borderRadius: 2 }}>
                      Seleccionar archivo
                    </Button>
                    <Typography sx={{ fontSize: 13, color: importFile ? 'text.primary' : 'text.secondary' }}>
                      {importFile ? importFile.name : 'Ningún archivo seleccionado'}
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <Button variant="contained" startIcon={<PlayArrowOutlinedIcon />} onClick={onValidarImportacion} disabled={!importFile || importBusy} sx={{ textTransform: 'none', borderRadius: 2 }}>
                      {importBusy && !importResult ? <CircularProgress size={20} color="inherit" /> : 'Validar archivo'}
                    </Button>
                  </Box>

                  {importError && <Alert severity="error">{importError}</Alert>}

                  {importPreview && (
                    <>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Chip label={`Total: ${importPreview.resumen.total}`} />
                        <Chip color="success" variant="outlined" label={`Válidas: ${importPreview.resumen.validas}`} />
                        <Chip color="error" variant="outlined" label={`Errores: ${importPreview.resumen.errores}`} />
                        <Chip variant="outlined" label={`Crear: ${importPreview.resumen.creaciones}`} />
                        <Chip variant="outlined" label={`Actualizar: ${importPreview.resumen.actualizaciones}`} />
                        <Chip color="info" variant="outlined" label={`Zonas a asignar: ${importPreview.resumen.relacionesAsignadas}`} />
                      </Stack>
                      <FormControlLabel
                        control={<Checkbox size="small" checked={importSoloErrores} onChange={(e) => setImportSoloErrores(e.target.checked)} disabled={importPreview.resumen.errores === 0} />}
                        label={<Typography sx={{ fontSize: 13 }}>Mostrar solo errores ({importPreview.resumen.errores})</Typography>}
                      />
                      <TableContainer sx={{ maxHeight: 360 }}>
                        <Table stickyHeader size="small">
                          <TableHead>
                            <TableRow>
                              {['Hoja', 'Fila', 'Estado', 'Error / Motivo', 'Acción', 'Correo', 'Rol', 'Columna'].map((h) => (
                                <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>
                              ))}
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {importItemsMostrados.length === 0 ? (
                              <TableRow><TableCell colSpan={8}><Typography sx={{ fontSize: 13, color: 'text.secondary', textAlign: 'center', py: 2 }}>Sin errores para mostrar.</Typography></TableCell></TableRow>
                            ) : importItemsMostrados.map((it) => (
                              <TableRow key={`${it.hoja}-${it.fila}`} hover sx={it.estado === 'ERROR' ? { bgcolor: (t) => t.palette.mode === 'dark' ? 'rgba(244,67,54,0.16)' : 'rgba(244,67,54,0.07)' } : undefined}>
                                <TableCell sx={{ whiteSpace: 'nowrap' }}>{it.hoja}</TableCell>
                                <TableCell>{it.fila}</TableCell>
                                <TableCell><Chip size="small" label={it.estado} color={it.estado === 'VALIDO' ? 'success' : 'error'} variant="outlined" /></TableCell>
                                <TableCell sx={{ fontSize: 12, fontWeight: it.estado === 'ERROR' ? 600 : 400, minWidth: 260 }}>{it.estado === 'ERROR' ? it.mensaje : '—'}</TableCell>
                                <TableCell>{it.accion || '—'}</TableCell>
                                <TableCell sx={{ whiteSpace: 'nowrap' }}>{it.email}</TableCell>
                                <TableCell>{it.rol || '—'}</TableCell>
                                <TableCell sx={{ whiteSpace: 'nowrap' }}>{it.columna || '—'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                      <Stack direction="row" spacing={1.5} justifyContent="flex-end">
                        <Button onClick={() => { setImportPreview(null); setImportFile(null); }} sx={{ textTransform: 'none' }}>Cancelar</Button>
                        {importTieneErrores ? (
                          <Button variant="contained" color="warning" disabled={importBusy || importPreview.resumen.validas === 0} onClick={() => onAplicarImportacion(true)} sx={{ textTransform: 'none' }}>
                            Procesar solo válidas ({importPreview.resumen.validas})
                          </Button>
                        ) : (
                          <Button variant="contained" disabled={importBusy || importPreview.resumen.validas === 0} onClick={() => onAplicarImportacion(false)} sx={{ textTransform: 'none' }}>
                            Aplicar cambios
                          </Button>
                        )}
                      </Stack>
                    </>
                  )}

                  {importResult && (
                    <>
                      <Alert severity="success">Proceso completado.</Alert>
                      {importHayPasswords && (
                        <Alert severity="warning">
                          El reporte contiene contraseñas temporales de usuarios recién creados. Descárgalo, guárdalo de forma segura y elimínalo tras compartir las credenciales.
                        </Alert>
                      )}
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Chip label={`Total: ${importResult.resumen.total}`} />
                        <Chip color="success" variant="outlined" label={`Válidas: ${importResult.resumen.validas}`} />
                        <Chip color="error" variant="outlined" label={`Errores: ${importResult.resumen.errores}`} />
                        <Chip variant="outlined" label={`Creados: ${importResult.resumen.creaciones}`} />
                        <Chip variant="outlined" label={`Actualizados: ${importResult.resumen.actualizaciones}`} />
                        <Chip color="info" variant="outlined" label={`Zonas asignadas: ${importResult.resumen.relacionesAsignadas}`} />
                      </Stack>
                      <TableContainer sx={{ maxHeight: 320 }}>
                        <Table stickyHeader size="small">
                          <TableHead>
                            <TableRow>
                              {['Hoja', 'Fila', 'Acción', 'Correo', 'Rol', 'Resultado', 'Mensaje'].map((h) => (
                                <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>
                              ))}
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {importResult.resultados.map((r) => (
                              <TableRow key={`${r.hoja}-${r.fila}`} hover>
                                <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.hoja}</TableCell>
                                <TableCell>{r.fila}</TableCell>
                                <TableCell>{r.accion || '—'}</TableCell>
                                <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.email}</TableCell>
                                <TableCell>{r.rol || '—'}</TableCell>
                                <TableCell><Chip size="small" label={r.resultado} color={r.resultado === 'OK' ? 'success' : 'error'} variant="outlined" /></TableCell>
                                <TableCell sx={{ fontSize: 12 }}>{r.mensaje}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                      <Stack direction="row" justifyContent="flex-end">
                        <Button variant="outlined" startIcon={<DownloadOutlinedIcon />} onClick={onDescargarReporteImportacion} sx={{ textTransform: 'none' }}>
                          Descargar reporte
                        </Button>
                      </Stack>
                    </>
                  )}
                </Stack>
              </AccordionDetails>
            </Accordion>
          )}

          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              {usuarios.length.toLocaleString('en-US')} usuario(s).
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
                {canAdminGlobal && (
                  <FormControlLabel
                    sx={{ ml: 'auto', mr: 0 }}
                    control={
                      <Checkbox
                        size="small"
                        indeterminate={selUsuarios.size > 0 && !todosFiltradosSeleccionados}
                        checked={todosFiltradosSeleccionados}
                        disabled={idsUsuariosFiltrados.length === 0}
                        onChange={() => setSelUsuarios(todosFiltradosSeleccionados ? new Set() : new Set(idsUsuariosFiltrados))}
                      />
                    }
                    label={<Typography sx={{ fontSize: 13 }}>Seleccionar todos los filtrados ({idsUsuariosFiltrados.length})</Typography>}
                  />
                )}
                {canAdminGlobal && selUsuarios.size > 0 && (
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip size="small" label={`${selUsuarios.size} seleccionado(s)`} />
                    <Button size="small" color="error" variant="outlined" startIcon={<DeleteOutlineIcon fontSize="small" />}
                      onClick={() => abrirConfirmBulkDelete({ kind: 'gestion' }, [...selUsuarios])} sx={{ textTransform: 'none' }}>
                      Eliminar seleccionados
                    </Button>
                  </Stack>
                )}
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
                    {canAdminGlobal && (
                      <Checkbox
                        size="small"
                        onClick={(e) => e.stopPropagation()}
                        indeterminate={grupo.usuarios.some((u) => selUsuarios.has(u.id)) && !grupo.usuarios.every((u) => selUsuarios.has(u.id))}
                        checked={grupo.usuarios.every((u) => selUsuarios.has(u.id))}
                        onChange={() => toggleSelGrupoUsuarios(grupo.usuarios.map((u) => u.id))}
                      />
                    )}
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
                            {canAdminGlobal && <TableCell padding="checkbox" />}
                            {['Nombre', 'Correo', 'Rol / Nivel', 'Alcance', 'Estado', 'Acciones'].map((h) => (
                              <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</TableCell>
                            ))}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {grupo.usuarios.map((u) => (
                            <TableRow key={u.id} hover selected={selUsuarios.has(u.id)}>
                              {canAdminGlobal && (
                                <TableCell padding="checkbox">
                                  <Checkbox size="small" checked={selUsuarios.has(u.id)} onChange={() => toggleSelUsuario(u.id)} />
                                </TableCell>
                              )}
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
                                    {u.role?.clave !== 'administrador' && (
                                      <Button size="small" startIcon={<LockClockIcon fontSize="small" />} onClick={() => setResetTemporalUser({ id: u.id, email: u.email })} sx={{ textTransform: 'none' }}>
                                        Restablecer contraseña
                                      </Button>
                                    )}
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

      <Dialog open={bulkDeleteTarget !== null} onClose={cerrarBulkDelete} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Eliminar usuarios seleccionados</DialogTitle>
        <DialogContent dividers>
          {bulkValidando ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} /></Box>
          ) : bulkValidacion && (
            <Stack spacing={1.5}>
              <Typography sx={{ fontSize: 14 }}>
                ¿Deseas eliminar {bulkValidacion.permitidos.length} usuario{bulkValidacion.permitidos.length === 1 ? '' : 's'}?
              </Typography>
              {bulkValidacion.permitidos.length > 0 && (
                <Box sx={{ maxHeight: 160, overflowY: 'auto' }}>
                  {bulkValidacion.permitidos.map((p) => (
                    <Typography key={p.id} sx={{ fontSize: 12, color: 'text.secondary' }}>• {p.email} ({p.rol})</Typography>
                  ))}
                </Box>
              )}
              {bulkValidacion.bloqueados.length > 0 && (
                <Alert severity="warning">
                  <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 0.5 }}>
                    {bulkValidacion.bloqueados.length} usuario{bulkValidacion.bloqueados.length === 1 ? '' : 's'} no se puede{bulkValidacion.bloqueados.length === 1 ? '' : 'n'} eliminar:
                  </Typography>
                  {bulkValidacion.bloqueados.map((b) => (
                    <Typography key={b.id} sx={{ fontSize: 12 }}>• {b.email || b.id}: {b.motivo}</Typography>
                  ))}
                </Alert>
              )}
              {bulkValidacion.permitidos.length === 0 && (
                <Alert severity="error">Ningún usuario de la selección puede eliminarse.</Alert>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={cerrarBulkDelete} sx={{ textTransform: 'none' }}>Cancelar</Button>
          <Button
            color="error" variant="contained" onClick={confirmarBulkDelete}
            disabled={bulkValidando || bulkEjecutando || !bulkValidacion || bulkValidacion.permitidos.length === 0}
            sx={{ textTransform: 'none' }}
          >
            {bulkEjecutando ? <CircularProgress size={18} color="inherit" /> : 'Eliminar'}
          </Button>
        </DialogActions>
      </Dialog>

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
              helperText="Se valida que tenga formato correcto y que no esté en uso por otra cuenta antes de guardar."
              size="small"
              fullWidth
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Nombre" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} size="small" fullWidth />
              <TextField label="Apellido" value={form.apellido} onChange={(e) => setForm((f) => ({ ...f, apellido: e.target.value }))} size="small" fullWidth />
            </Stack>
            <TextField
              label="Nombre completo"
              value={form.nombreCompleto}
              onChange={(e) => setForm((f) => ({ ...f, nombreCompleto: e.target.value, nombreCompletoTocado: true }))}
              size="small"
              fullWidth
              helperText={
                form.nombreCompletoTocado
                  ? 'Editado manualmente. '
                  : 'Se arma automáticamente con Nombre + Apellido. '
              }
              InputProps={form.nombreCompletoTocado ? {
                endAdornment: (
                  <InputAdornment position="end">
                    <Button
                      size="small"
                      onClick={() => setForm((f) => ({ ...f, nombreCompletoTocado: false, nombreCompleto: [f.nombre, f.apellido].filter(Boolean).join(' ') }))}
                      sx={{ textTransform: 'none', fontSize: 11 }}
                    >
                      Auto
                    </Button>
                  </InputAdornment>
                )
              } : undefined}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Contacto" value={form.contacto} onChange={(e) => setForm((f) => ({ ...f, contacto: e.target.value }))} size="small" fullWidth />
              <Autocomplete
                freeSolo
                size="small"
                fullWidth
                options={paisesDisponibles}
                value={form.pais}
                inputValue={form.pais}
                onInputChange={(_e, val) => setForm((f) => ({ ...f, pais: val }))}
                renderInput={(params) => <TextField {...params} label="País" />}
              />
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                label="Rol"
                value={form.roleId}
                onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value, gestorIds: [], gerenteZonaIds: [], supervisorIds: [], gerenteZonaAsignaciones: [], gestorPaisZonaKeys: [], gestorPaisFiltro: '' }))}
                size="small"
                fullWidth
              >
                {(catalogos?.roles ?? []).map((r) => (
                  <MenuItem key={r.id} value={r.id}>{r.nombre}</MenuItem>
                ))}
              </TextField>
              <TextField
                label="Nivel"
                value={catalogos?.roles.find((r) => r.id === form.roleId)?.nivel ?? ''}
                size="small"
                sx={{ maxWidth: { sm: 140 } }}
                fullWidth
                disabled
                helperText="Determinado por el Rol."
              />
            </Stack>

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
              <Autocomplete
                multiple
                size="small"
                options={catalogos?.supervisores ?? []}
                getOptionLabel={(o) => [o.nombre, o.apellido].filter(Boolean).join(' ')}
                isOptionEqualToValue={(o, v) => o.id === v.id}
                value={(catalogos?.supervisores ?? []).filter((s) => form.supervisorIds.includes(s.id))}
                onChange={(_e, val) => setForm((f) => ({ ...f, supervisorIds: val.map((v) => v.id) }))}
                renderInput={(params) => <TextField {...params} label="Supervisores asignados" placeholder="Buscar por nombre..." />}
                renderTags={(value, getTagProps) => value.map((option, index) => {
                  const { key, ...tagProps } = getTagProps({ index });
                  return <Chip key={key} size="small" label={[option.nombre, option.apellido].filter(Boolean).join(' ')} {...tagProps} />;
                })}
              />
            )}

            {selectedRoleClave === 'supervisor' && (
              <Autocomplete
                multiple
                size="small"
                options={catalogos?.gestores ?? []}
                getOptionLabel={(o) => o.nombreCartera ?? o.id}
                isOptionEqualToValue={(o, v) => o.id === v.id}
                value={(catalogos?.gestores ?? []).filter((g) => form.gestorIds.includes(g.id))}
                onChange={(_e, val) => setForm((f) => ({ ...f, gestorIds: val.map((v) => v.id) }))}
                renderInput={(params) => <TextField {...params} label="Gestores supervisados" placeholder="Buscar por nombre de cartera..." />}
                renderTags={(value, getTagProps) => value.map((option, index) => {
                  const { key, ...tagProps } = getTagProps({ index });
                  return <Chip key={key} size="small" label={option.nombreCartera ?? option.id} {...tagProps} />;
                })}
              />
            )}

            {selectedRoleClave === 'supervisor' && (
              <Autocomplete
                multiple
                size="small"
                options={catalogos?.gerentesZona ?? []}
                getOptionLabel={(o) => [o.nombre, o.apellido].filter(Boolean).join(' ')}
                isOptionEqualToValue={(o, v) => o.id === v.id}
                value={(catalogos?.gerentesZona ?? []).filter((g) => form.gerenteZonaIds.includes(g.id))}
                onChange={(_e, val) => setForm((f) => ({ ...f, gerenteZonaIds: val.map((v) => v.id) }))}
                renderInput={(params) => <TextField {...params} label="Gerentes de zona supervisados" placeholder="Buscar por nombre..." />}
                renderTags={(value, getTagProps) => value.map((option, index) => {
                  const { key, ...tagProps } = getTagProps({ index });
                  return <Chip key={key} size="small" label={[option.nombre, option.apellido].filter(Boolean).join(' ')} {...tagProps} />;
                })}
              />
            )}

            {selectedRoleClave === 'gerente_zona' && (
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 1 }}>Asignaciones de territorio (País / División / Zona)</Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1 }}>
                  <Autocomplete
                    size="small"
                    sx={{ minWidth: 160, flex: 1 }}
                    options={paisesDisponibles}
                    value={nuevaAsigPais || null}
                    onChange={(_e, val) => { setNuevaAsigPais(val ?? ''); setNuevaAsigZonas([]); }}
                    renderInput={(params) => <TextField {...params} label="País" />}
                  />
                  <Autocomplete
                    freeSolo
                    size="small"
                    sx={{ minWidth: 160, flex: 1 }}
                    options={divisionesPorPais(nuevaAsigPais)}
                    value={nuevaAsigDivision}
                    inputValue={nuevaAsigDivision}
                    onInputChange={(_e, val) => setNuevaAsigDivision(val)}
                    disabled={!nuevaAsigPais}
                    renderInput={(params) => <TextField {...params} label="División" placeholder="Ej. CONACASTE" />}
                  />
                  <Autocomplete
                    multiple
                    size="small"
                    sx={{ minWidth: 220, flex: 1.4 }}
                    options={zonasPorPais(nuevaAsigPais)}
                    getOptionLabel={(o) => o.zona}
                    isOptionEqualToValue={(o, v) => o.zonaId === v.zonaId}
                    value={nuevaAsigZonas}
                    onChange={(_e, val) => setNuevaAsigZonas(val)}
                    disabled={!nuevaAsigPais}
                    renderInput={(params) => <TextField {...params} label="Zona(s)" placeholder="Buscar código..." />}
                  />
                  <Button
                    variant="text" onClick={seleccionarTodasZonasGV}
                    disabled={!nuevaAsigPais || !nuevaAsigDivision.trim()}
                    sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
                    title="Selecciona automáticamente todas las zonas conocidas de esta división (equivalente al marcador GV de la plantilla Comercial)."
                  >
                    GV: todas las zonas
                  </Button>
                  <Button
                    variant="outlined" startIcon={<AddIcon />} onClick={agregarAsignacionGerente}
                    disabled={!nuevaAsigPais || !nuevaAsigDivision.trim() || nuevaAsigZonas.length === 0}
                    sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
                  >
                    Agregar
                  </Button>
                </Stack>

                <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 0.5 }}>
                  Alcance final ({form.gerenteZonaAsignaciones.length} zona(s) asignada(s)):
                </Typography>
                {form.gerenteZonaAsignaciones.length === 0 ? (
                  <Alert severity="warning" sx={{ fontSize: 12 }}>
                    Sin asignaciones: este Gerente de zona no verá ninguna cuenta hasta que agregues al menos una.
                  </Alert>
                ) : (
                  <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1}>
                    {form.gerenteZonaAsignaciones.map((a) => (
                      <Chip
                        key={`${a.pais}__${a.zonaId}`}
                        size="small"
                        label={`${a.pais} · ${a.division ?? '—'} · Zona ${a.zona}`}
                        onDelete={() => quitarAsignacionGerente(a.zonaId, a.pais)}
                      />
                    ))}
                  </Stack>
                )}
              </Paper>
            )}

            {selectedRoleClave === 'gestor' && (
              <Stack spacing={1}>
                <Autocomplete
                  size="small"
                  options={paisesDisponibles}
                  value={form.gestorPaisFiltro || null}
                  onChange={(_e, val) => setForm((f) => ({ ...f, gestorPaisFiltro: val ?? '' }))}
                  renderInput={(params) => <TextField {...params} label="Filtrar zonas por país" placeholder="(opcional, acota la lista de abajo)" />}
                />
                <Autocomplete
                  multiple
                  size="small"
                  options={(form.gestorPaisFiltro ? (catalogos?.carteraPaisZona ?? []).filter((pz) => pz.pais === form.gestorPaisFiltro) : (catalogos?.carteraPaisZona ?? []))}
                  getOptionLabel={(o) => `${o.pais} — ${o.zona}`}
                  isOptionEqualToValue={(o, v) => o.zonaId === v.zonaId && o.pais === v.pais}
                  value={(catalogos?.carteraPaisZona ?? []).filter((pz) => form.gestorPaisZonaKeys.includes(pzKey(pz.zonaId, pz.pais)))}
                  onChange={(_e, val) => setForm((f) => ({ ...f, gestorPaisZonaKeys: val.map((v) => pzKey(v.zonaId, v.pais)) }))}
                  renderInput={(params) => <TextField {...params} label="País - Zona asignados (opcional)" placeholder="Buscar..." />}
                  renderTags={(value, getTagProps) => value.map((option, index) => {
                    const { key, ...tagProps } = getTagProps({ index });
                    return <Chip key={key} size="small" label={`${option.pais} — ${option.zona}`} {...tagProps} />;
                  })}
                />
                <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                  Opcional: si no seleccionas ninguno, no se aplica ninguna restricción adicional de zona (el
                  alcance dependerá únicamente de su cartera vinculada, si la tiene; un Gestor creado
                  manualmente sin cartera no verá cuentas hasta que le asignes País/Zona aquí).
                </Typography>
              </Stack>
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

      {/* Restablecer contraseña (política Avon2026, 15 días) — confirmación */}
      <Dialog open={Boolean(resetTemporalUser)} onClose={resetTemporalBusy ? undefined : () => setResetTemporalUser(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Restablecer contraseña</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            <Typography sx={{ fontSize: 13 }}>
              Se establecerá la contraseña temporal predeterminada para <strong>{resetTemporalUser?.email}</strong>.
              Será válida por 15 días; el usuario deberá cambiarla antes de que venza.
            </Typography>
            <Alert severity="info" sx={{ fontSize: 12 }}>La contraseña no se muestra aquí ni queda visible en ningún listado.</Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetTemporalUser(null)} disabled={resetTemporalBusy} sx={{ textTransform: 'none' }}>Cancelar</Button>
          <Button variant="contained" onClick={doResetPasswordTemporal} disabled={resetTemporalBusy} sx={{ textTransform: 'none' }}>
            {resetTemporalBusy ? <CircularProgress size={18} color="inherit" /> : 'Restablecer'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Restablecer contraseña (política Avon2026, 15 días) — resultado */}
      <Dialog open={Boolean(resetTemporalResult)} onClose={() => setResetTemporalResult(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Contraseña restablecida correctamente</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            <Typography sx={{ fontSize: 13 }}>Usuario: <strong>{resetTemporalResult?.email}</strong></Typography>
            <Typography sx={{ fontSize: 13 }}>
              El usuario debe cambiarla antes de{' '}
              <strong>{resetTemporalResult ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(resetTemporalResult.expiresAt)) : ''}</strong>.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setResetTemporalResult(null)} sx={{ textTransform: 'none' }}>Entendido</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} message={toast ?? ''} />
    </Box>
  );
};

export default UsuariosPage;
