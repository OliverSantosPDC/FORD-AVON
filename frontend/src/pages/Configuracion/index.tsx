import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Collapse, Divider, FormControlLabel, Grid, IconButton,
  MenuItem, Paper, Snackbar, Stack, Switch, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Tabs, TextField, Typography
} from '@mui/material';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { TablePagination } from '@mui/material';
import { useAuth } from '../../context/AuthContext';
import { exportRowsToCsv, exportRowsToExcel } from '../../utils/tableExport';
import { MODULES } from '../../config/modules';
import {
  getGeneral, putGeneral, getCatalogos, crearCatalogo, actualizarCatalogo,
  getVariables, crearVariable, actualizarVariable, getRoles, putRolPermisos, getPlantillas, subirPlantilla, descargarPlantilla, subirAsset,
  getAuditoria,
  type Catalogo, type Variable, type Plantilla, type RolesData, type AuditoriaRow
} from '../../services/configuracionService';

const CATALOGOS_FIJOS = [
  'tipificaciones', 'tipos_contacto', 'canales', 'estados_promesa', 'estados_carta',
  'tipos_evento', 'tipos_adjunto', 'motivos_aprobacion', 'motivos_rechazo'
];
const CAT_LABEL: Record<string, string> = {
  tipificaciones: 'Tipificaciones', tipos_contacto: 'Tipos de contacto', canales: 'Canales',
  estados_promesa: 'Estados de promesa', estados_carta: 'Estados de cartas', tipos_evento: 'Tipos de eventos',
  tipos_adjunto: 'Tipos de adjuntos', motivos_aprobacion: 'Motivos de aprobación', motivos_rechazo: 'Motivos de rechazo'
};
const VAR_TIPOS = ['texto', 'numero', 'booleano', 'fecha', 'json'];

const ConfiguracionPage = () => {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('configuracion.editar');
  const [tab, setTab] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  // General
  const [general, setGeneral2] = useState<Record<string, string>>({});
  // Catálogos
  const [catalogos, setCatalogos] = useState<Catalogo[]>([]);
  const [catSel, setCatSel] = useState('tipificaciones');
  const [catSearch, setCatSearch] = useState('');
  const [nuevoCat, setNuevoCat] = useState('');
  // Roles
  const [rolesData, setRolesData] = useState<RolesData | null>(null);
  const [roleSel, setRoleSel] = useState('');
  const [permSel, setPermSel] = useState<Set<string>>(new Set());
  const [permSearch, setPermSearch] = useState('');
  const [grpOpen, setGrpOpen] = useState<Set<string>>(new Set());
  // Variables
  const [variables, setVariables] = useState<Variable[]>([]);
  const [nuevaVar, setNuevaVar] = useState({ nombre: '', valor: '', tipo: 'texto', descripcion: '' });
  // Plantillas
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  // Variables
  const [varSearch, setVarSearch] = useState('');
  // Menú (orden)
  const [orden, setOrden] = useState<string[]>([]);
  // Auditoría
  const [audItems, setAudItems] = useState<AuditoriaRow[]>([]);
  const [audTotal, setAudTotal] = useState(0);
  const [audF, setAudF] = useState({ usuario: '', entidad: '', accion: '', desde: '', hasta: '', search: '' });
  const [audPage, setAudPage] = useState(0);
  const [audRpp, setAudRpp] = useState(50);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [g, c, r, v, p] = await Promise.all([getGeneral(), getCatalogos(), getRoles(), getVariables(), getPlantillas()]);
        setGeneral2(g); setCatalogos(c); setRolesData(r); setVariables(v); setPlantillas(p);
        if (r.roles[0]) setRoleSel(r.roles[0].id);
        const guardado = (g.orden_modulos ?? '').split(',').map((x) => x.trim()).filter(Boolean);
        const keys = MODULES.map((m) => m.key);
        setOrden([...guardado.filter((k) => keys.includes(k)), ...keys.filter((k) => !guardado.includes(k))]);
      } catch (e) { setToast(e instanceof Error ? e.message : 'Error al cargar.'); }
      finally { setLoading(false); }
    })();
  }, []);

  // Selección de permisos al cambiar de rol
  useEffect(() => {
    if (!rolesData || !roleSel) return;
    setPermSel(new Set(rolesData.asignaciones.filter((a) => a.role_id === roleSel).map((a) => a.permission_id)));
  }, [roleSel, rolesData]);

  const gv = (k: string) => general[k] ?? '';
  const sgv = (k: string, v: string) => setGeneral2((s) => ({ ...s, [k]: v }));

  const guardarGeneral = async () => { try { await putGeneral(general); setToast('Guardado.'); } catch (e) { setToast(e instanceof Error ? e.message : 'Error.'); } };
  const uploadAsset = async (clave: string, file: File | null) => { if (!file) return; try { await subirAsset(clave, file); setGeneral2(await getGeneral()); setToast('Imagen subida.'); } catch (e) { setToast(e instanceof Error ? e.message : 'Error.'); } };

  const recargarCat = async () => setCatalogos(await getCatalogos());
  const catList = useMemo(() => catalogos.filter((c) => c.catalogo === catSel && c.nombre.toLowerCase().includes(catSearch.toLowerCase())), [catalogos, catSel, catSearch]);
  const catalogosDistintos = useMemo(() => [...new Set([...CATALOGOS_FIJOS, ...catalogos.map((c) => c.catalogo)])], [catalogos]);

  const permisosGrupos = useMemo(() => {
    const m = new Map<string, Array<{ id: string; clave: string; descripcion: string | null }>>();
    (rolesData?.permisos ?? []).filter((p) => p.clave.toLowerCase().includes(permSearch.toLowerCase()) || (p.descripcion ?? '').toLowerCase().includes(permSearch.toLowerCase()))
      .forEach((p) => { const g = p.clave.split('.')[0]; if (!m.has(g)) m.set(g, []); m.get(g)!.push(p); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rolesData, permSearch]);

  const togglePerm = (id: string) => setPermSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const guardarPermisos = async () => { try { await putRolPermisos(roleSel, [...permSel]); setToast('Permisos guardados.'); setRolesData(await getRoles()); } catch (e) { setToast(e instanceof Error ? e.message : 'Error.'); } };
  const allPermIds = () => (rolesData?.permisos ?? []).map((p) => p.id);
  const restaurarPermisos = () => { if (rolesData) setPermSel(new Set(rolesData.asignaciones.filter((a) => a.role_id === roleSel).map((a) => a.permission_id))); };

  const varList = useMemo(() => variables.filter((v) => v.nombre.toLowerCase().includes(varSearch.toLowerCase()) || (v.descripcion ?? '').toLowerCase().includes(varSearch.toLowerCase())), [variables, varSearch]);
  const exportVars = (excel: boolean) => {
    const head = ['Nombre', 'Valor', 'Tipo', 'Descripción', 'Activo'];
    const rows = varList.map((v) => [v.nombre, v.valor ?? '', v.tipo ?? 'texto', v.descripcion ?? '', v.activo ? 'Sí' : 'No']);
    excel ? exportRowsToExcel('variables.xlsx', 'Variables', head, rows) : exportRowsToCsv('variables.csv', head, rows);
  };

  const moverModulo = (i: number, d: -1 | 1) => setOrden((o) => { const n = [...o]; const j = i + d; if (j < 0 || j >= n.length) return o; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const guardarOrden = async () => { try { await putGeneral({ ...general, orden_modulos: orden.join(',') }); setToast('Orden guardado. Se aplicará al recargar el menú.'); } catch (e) { setToast(e instanceof Error ? e.message : 'Error.'); } };

  const cargarAuditoria = async () => {
    try {
      const params: Record<string, string> = { limit: String(audRpp), offset: String(audPage * audRpp) };
      Object.entries(audF).forEach(([k, v]) => { if (v) params[k] = v; });
      const r = await getAuditoria(params); setAudItems(r.items); setAudTotal(r.total);
    } catch (e) { setToast(e instanceof Error ? e.message : 'Error.'); }
  };
  useEffect(() => { if (tab === 6) void cargarAuditoria(); /* eslint-disable-next-line */ }, [tab, audPage, audRpp]);
  const exportAud = (excel: boolean) => {
    const head = ['Fecha', 'Usuario', 'Módulo', 'Acción', 'Entidad ID', 'Detalle'];
    const rows = audItems.map((a) => [String(a.created_at).slice(0, 19).replace('T', ' '), a.actor_id ?? '', a.entidad, a.accion, a.entidad_id ?? '', JSON.stringify(a.detalle ?? '')]);
    excel ? exportRowsToExcel('auditoria.xlsx', 'Auditoria', head, rows) : exportRowsToCsv('auditoria.csv', head, rows);
  };
  const descargarP = async (clave: string) => { try { const u = await descargarPlantilla(clave); window.open(u, '_blank'); } catch (e) { setToast(e instanceof Error ? e.message : 'Sin archivo.'); } };

  if (loading) return <Box sx={{ display: 'flex', gap: 1.5, p: 3, alignItems: 'center' }}><CircularProgress size={22} /><Typography sx={{ fontSize: 14 }}>Cargando configuración...</Typography></Box>;

  const AssetUpload = ({ label, clave }: { label: string; clave: string }) => (
    <Stack direction="row" spacing={1.5} alignItems="center">
      <Typography sx={{ fontSize: 13, minWidth: 130 }}>{label}</Typography>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 1 }}>{gv(clave) || 'No configurado'}</Typography>
      {canEdit && <Button variant="outlined" size="small" component="label" sx={{ textTransform: 'none' }}>Subir<input hidden type="file" accept="image/*" onChange={(e) => uploadAsset(clave, e.target.files?.[0] ?? null)} /></Button>}
    </Stack>
  );

  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" sx={{ mb: 2 }}>
        {['General', 'Catálogos', 'Roles y permisos', 'Apariencia', 'Plantillas', 'Variables', 'Auditoría'].map((t) => <Tab key={t} label={t} sx={{ textTransform: 'none' }} />)}
      </Tabs>

      {/* GENERAL */}
      {tab === 0 && (
        <Paper sx={{ p: 3, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
          <Stack spacing={2}>
            <Typography sx={{ fontWeight: 700 }}>Empresa</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}><TextField label="Nombre del sistema" value={gv('nombre_sistema')} onChange={(e) => sgv('nombre_sistema', e.target.value)} size="small" fullWidth disabled={!canEdit} /></Grid>
              <Grid item xs={12} sm={6}><TextField label="Nombre de la empresa" value={gv('nombre_empresa')} onChange={(e) => sgv('nombre_empresa', e.target.value)} size="small" fullWidth disabled={!canEdit} /></Grid>
              <Grid item xs={12}><TextField label="Descripción" value={gv('descripcion_sistema')} onChange={(e) => sgv('descripcion_sistema', e.target.value)} size="small" fullWidth multiline minRows={2} disabled={!canEdit} /></Grid>
            </Grid>
            <Divider /><Typography sx={{ fontWeight: 700 }}>Logos</Typography>
            <AssetUpload label="Logo principal" clave="logo_principal" />
            <AssetUpload label="Logo Login" clave="logo_login" />
            <AssetUpload label="Favicon" clave="favicon" />
            <Divider /><Typography sx={{ fontWeight: 700 }}>Configuración</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}><TextField label="Zona horaria" value={gv('zona_horaria')} onChange={(e) => sgv('zona_horaria', e.target.value)} size="small" fullWidth disabled={!canEdit} /></Grid>
              <Grid item xs={12} sm={6}><TextField select label="Idioma" value={gv('idioma') || 'es'} onChange={(e) => sgv('idioma', e.target.value)} size="small" fullWidth disabled={!canEdit}><MenuItem value="es">Español</MenuItem><MenuItem value="en">English</MenuItem></TextField></Grid>
            </Grid>
            <Divider /><Typography sx={{ fontWeight: 700 }}>Información del sistema</Typography>
            <Grid container spacing={1.5}>
              {[['Versión', gv('version')], ['Build', gv('build')], ['Fecha instalación', gv('fecha_instalacion')], ['Último despliegue', gv('ultimo_despliegue')], ['Última modificación', gv('ultima_actualizacion')]].map(([l, v]) => (
                <Grid item xs={6} sm={4} key={l}><Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase' }}>{l}</Typography><Typography sx={{ fontSize: 13 }}>{v || '—'}</Typography></Grid>
              ))}
            </Grid>
            {canEdit && <Box><Button variant="contained" onClick={guardarGeneral} sx={{ textTransform: 'none' }}>Guardar</Button></Box>}
          </Stack>
        </Paper>
      )}

      {/* CATÁLOGOS (ERP: lista izquierda + panel derecho) */}
      {tab === 1 && (
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <Paper sx={{ p: 1, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
              <Stack>
                {catalogosDistintos.map((c) => (
                  <Button key={c} onClick={() => setCatSel(c)} variant={catSel === c ? 'contained' : 'text'} sx={{ justifyContent: 'flex-start', textTransform: 'none' }}>{CAT_LABEL[c] ?? c}</Button>
                ))}
              </Stack>
            </Paper>
          </Grid>
          <Grid item xs={12} md={9}>
        <Paper sx={{ p: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
          <Stack spacing={2}>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
              <Typography sx={{ fontWeight: 700 }}>{CAT_LABEL[catSel] ?? catSel}</Typography>
              <TextField size="small" label="Buscar" value={catSearch} onChange={(e) => setCatSearch(e.target.value)} />
              <Box sx={{ flex: 1 }} />
              <Button size="small" startIcon={<FileDownloadOutlinedIcon />} onClick={() => exportRowsToCsv(`${catSel}.csv`, ['Nombre', 'Código', 'Activo', 'Orden'], catList.map((c) => [c.nombre, c.codigo ?? '', c.activo ? 'Sí' : 'No', c.orden]))} sx={{ textTransform: 'none' }}>CSV</Button>
              <Button size="small" startIcon={<FileDownloadOutlinedIcon />} onClick={() => exportRowsToExcel(`${catSel}.xlsx`, catSel, ['Nombre', 'Código', 'Activo', 'Orden'], catList.map((c) => [c.nombre, c.codigo ?? '', c.activo ? 'Sí' : 'No', c.orden]))} sx={{ textTransform: 'none' }}>Excel</Button>
            </Box>
            {canEdit && (
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField size="small" label="Nuevo valor" value={nuevoCat} onChange={(e) => setNuevoCat(e.target.value)} sx={{ minWidth: 240 }} />
                <Button variant="contained" disabled={!nuevoCat.trim()} onClick={async () => { await crearCatalogo({ catalogo: catSel, nombre: nuevoCat.trim() }); setNuevoCat(''); await recargarCat(); setToast('Creado.'); }} sx={{ textTransform: 'none' }}>Agregar</Button>
              </Box>
            )}
            <TableContainer sx={{ maxHeight: '60vh' }}>
              <Table stickyHeader size="small">
                <TableHead><TableRow>{['Nombre', 'Código', 'Activo'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
                <TableBody>
                  {catList.map((c) => (
                    <TableRow key={c.id} hover>
                      <TableCell>{canEdit ? <TextField variant="standard" defaultValue={c.nombre} onBlur={async (e) => { if (e.target.value !== c.nombre) { await actualizarCatalogo(c.id, { nombre: e.target.value }); await recargarCat(); } }} /> : c.nombre}</TableCell>
                      <TableCell>{c.codigo ?? '—'}</TableCell>
                      <TableCell><Switch size="small" checked={c.activo} disabled={!canEdit} onChange={async () => { await actualizarCatalogo(c.id, { activo: !c.activo }); await recargarCat(); }} /></TableCell>
                    </TableRow>
                  ))}
                  {catList.length === 0 && <TableRow><TableCell colSpan={3} align="center" sx={{ py: 3, color: 'text.secondary' }}>Sin registros.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </TableContainer>
          </Stack>
        </Paper>
          </Grid>
        </Grid>
      )}

      {/* ROLES Y PERMISOS */}
      {tab === 2 && rolesData && (
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
                {canEdit && <Button size="small" onClick={() => setPermSel(new Set(allPermIds()))} sx={{ textTransform: 'none' }}>Seleccionar todo</Button>}
                {canEdit && <Button size="small" onClick={() => setPermSel(new Set())} sx={{ textTransform: 'none' }}>Deseleccionar todo</Button>}
                {canEdit && <Button size="small" onClick={restaurarPermisos} sx={{ textTransform: 'none' }}>Restaurar</Button>}
                <Box sx={{ flex: 1 }} />
                {canEdit && <Button variant="contained" size="small" onClick={guardarPermisos} sx={{ textTransform: 'none' }}>Guardar cambios</Button>}
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
                          <FormControlLabel key={p.id} control={<Checkbox size="small" checked={permSel.has(p.id)} disabled={!canEdit} onChange={() => togglePerm(p.id)} />} label={<Typography sx={{ fontSize: 13 }}>{p.clave} <Typography component="span" sx={{ color: 'text.secondary', fontSize: 12 }}>· {p.descripcion}</Typography></Typography>} />
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

      {/* APARIENCIA */}
      {tab === 3 && (
        <Paper sx={{ p: 3, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
          <Stack spacing={2}>
            <Typography sx={{ fontWeight: 700 }}>Tema y densidad</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}><TextField select label="Tema" value={gv('tema') || 'claro'} onChange={(e) => sgv('tema', e.target.value)} size="small" fullWidth disabled={!canEdit}><MenuItem value="claro">Claro</MenuItem><MenuItem value="oscuro">Oscuro</MenuItem><MenuItem value="auto">Automático</MenuItem></TextField></Grid>
              <Grid item xs={12} sm={4}><TextField select label="Densidad de tabla" value={gv('densidad_tabla') || 'normal'} onChange={(e) => sgv('densidad_tabla', e.target.value)} size="small" fullWidth disabled={!canEdit}><MenuItem value="compacta">Compacta</MenuItem><MenuItem value="normal">Normal</MenuItem><MenuItem value="amplia">Amplia</MenuItem></TextField></Grid>
            </Grid>
            <Divider /><Typography sx={{ fontWeight: 700 }}>Colores</Typography>
            <Grid container spacing={2}>
              {[['color_sidebar', 'Sidebar'], ['color_encabezado', 'Encabezados'], ['color_boton', 'Botones'], ['color_kpi', 'Tarjetas KPI'], ['color_tabla', 'Tablas']].map(([k, l]) => (
                <Grid item xs={6} sm={2.4} key={k}><TextField label={l} type="color" value={gv(k) || '#1E3A8A'} onChange={(e) => sgv(k, e.target.value)} size="small" fullWidth disabled={!canEdit} InputLabelProps={{ shrink: true }} /></Grid>
              ))}
            </Grid>
            <Divider />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.5, borderRadius: 2, border: '1px dashed', borderColor: 'divider' }}>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Vista previa:</Typography>
              <Chip label="Sidebar" sx={{ bgcolor: gv('color_sidebar') || '#0F172A', color: '#fff' }} size="small" />
              <Chip label="Botón" sx={{ bgcolor: gv('color_boton') || '#1E3A8A', color: '#fff' }} size="small" />
              <Chip label="KPI" sx={{ bgcolor: gv('color_kpi') || '#E6007E', color: '#fff' }} size="small" />
              <Chip label={`Tema: ${gv('tema') || 'claro'} · ${gv('densidad_tabla') || 'normal'}`} size="small" variant="outlined" />
            </Box>
            <Divider /><Typography sx={{ fontWeight: 700 }}>Orden de módulos del menú lateral</Typography>
            <Stack spacing={0.5}>
              {orden.map((k, i) => {
                const m = MODULES.find((x) => x.key === k);
                return (
                  <Box key={k} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                    <Typography sx={{ flex: 1, fontSize: 13 }}>{m?.label ?? k}</Typography>
                    <IconButton size="small" disabled={!canEdit || i === 0} onClick={() => moverModulo(i, -1)}><ArrowUpwardIcon fontSize="small" /></IconButton>
                    <IconButton size="small" disabled={!canEdit || i === orden.length - 1} onClick={() => moverModulo(i, 1)}><ArrowDownwardIcon fontSize="small" /></IconButton>
                  </Box>
                );
              })}
            </Stack>
            {canEdit && <Box><Button variant="outlined" onClick={guardarOrden} sx={{ textTransform: 'none' }}>Guardar orden</Button></Box>}
            <Divider /><Typography sx={{ fontWeight: 700 }}>Fondos</Typography>
            <AssetUpload label="Fondo Login" clave="fondo_login" />
            <AssetUpload label="Fondo principal" clave="fondo_principal" />
            <AssetUpload label="Fondo Dashboard" clave="fondo_dashboard" />
            {canEdit && <Box><Button variant="contained" onClick={guardarGeneral} sx={{ textTransform: 'none' }}>Guardar apariencia</Button></Box>}
          </Stack>
        </Paper>
      )}

      {/* PLANTILLAS */}
      {tab === 4 && (
        <Paper sx={{ p: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
          <TableContainer sx={{ maxHeight: '65vh' }}>
            <Table stickyHeader size="small">
              <TableHead><TableRow>{['Plantilla', 'Versión', 'Fecha', 'Usuario', 'Estado', 'Acciones'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>
                {plantillas.map((p) => (
                  <TableRow key={p.id} hover>
                    <TableCell>{p.nombre}</TableCell>
                    <TableCell>{p.version ?? 1}</TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{p.updated_at ? String(p.updated_at).slice(0, 16).replace('T', ' ') : '—'}</TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{p.updated_by ?? '—'}</TableCell>
                    <TableCell><Chip size="small" label={p.url ? 'Configurada' : 'Sin archivo'} color={p.url ? 'success' : 'default'} variant="outlined" /></TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5}>
                        <Button size="small" disabled={!p.url} onClick={() => descargarP(p.clave)} sx={{ textTransform: 'none' }}>Descargar</Button>
                        {canEdit && <Button size="small" component="label" sx={{ textTransform: 'none' }}>Reemplazar / Nueva versión<input hidden type="file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { await subirPlantilla(p.clave, f); setPlantillas(await getPlantillas()); setToast('Plantilla actualizada.'); } }} /></Button>}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* VARIABLES */}
      {tab === 5 && (
        <Paper sx={{ p: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
          <Stack spacing={2}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField size="small" label="Buscar" value={varSearch} onChange={(e) => setVarSearch(e.target.value)} />
              <Box sx={{ flex: 1 }} />
              <Button size="small" startIcon={<FileDownloadOutlinedIcon />} onClick={() => exportVars(false)} sx={{ textTransform: 'none' }}>CSV</Button>
              <Button size="small" startIcon={<FileDownloadOutlinedIcon />} onClick={() => exportVars(true)} sx={{ textTransform: 'none' }}>Excel</Button>
            </Box>
            {canEdit && (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <TextField size="small" label="Nombre" value={nuevaVar.nombre} onChange={(e) => setNuevaVar({ ...nuevaVar, nombre: e.target.value })} />
                <TextField size="small" label="Valor" value={nuevaVar.valor} onChange={(e) => setNuevaVar({ ...nuevaVar, valor: e.target.value })} />
                <TextField select size="small" label="Tipo" value={nuevaVar.tipo} onChange={(e) => setNuevaVar({ ...nuevaVar, tipo: e.target.value })} sx={{ minWidth: 120 }}>{VAR_TIPOS.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}</TextField>
                <TextField size="small" label="Descripción" value={nuevaVar.descripcion} onChange={(e) => setNuevaVar({ ...nuevaVar, descripcion: e.target.value })} sx={{ flex: 1, minWidth: 180 }} />
                <Button variant="contained" disabled={!nuevaVar.nombre.trim()} onClick={async () => { await crearVariable(nuevaVar); setNuevaVar({ nombre: '', valor: '', tipo: 'texto', descripcion: '' }); setVariables(await getVariables()); setToast('Variable creada.'); }} sx={{ textTransform: 'none' }}>Agregar</Button>
              </Box>
            )}
            <TableContainer sx={{ maxHeight: '60vh' }}>
              <Table stickyHeader size="small">
                <TableHead><TableRow>{['Nombre', 'Valor', 'Tipo', 'Descripción', 'Activo'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
                <TableBody>
                  {varList.map((v) => (
                    <TableRow key={v.id} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{v.nombre}</TableCell>
                      <TableCell>{canEdit ? <TextField variant="standard" defaultValue={v.valor ?? ''} onBlur={async (e) => { if (e.target.value !== (v.valor ?? '')) { await actualizarVariable(v.id, { valor: e.target.value }); setVariables(await getVariables()); } }} /> : v.valor}</TableCell>
                      <TableCell>{canEdit ? <TextField select variant="standard" value={v.tipo ?? 'texto'} onChange={async (e) => { await actualizarVariable(v.id, { tipo: e.target.value }); setVariables(await getVariables()); }} sx={{ minWidth: 90 }}>{VAR_TIPOS.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}</TextField> : (v.tipo ?? 'texto')}</TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{v.descripcion}</TableCell>
                      <TableCell><Switch size="small" checked={v.activo} disabled={!canEdit} onChange={async () => { await actualizarVariable(v.id, { activo: !v.activo }); setVariables(await getVariables()); }} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Stack>
        </Paper>
      )}

      {/* AUDITORÍA */}
      {tab === 6 && (
        <Paper sx={{ p: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
          <Stack spacing={2}>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              <TextField size="small" label="Usuario (id)" value={audF.usuario} onChange={(e) => setAudF({ ...audF, usuario: e.target.value })} />
              <TextField size="small" label="Módulo" value={audF.entidad} onChange={(e) => setAudF({ ...audF, entidad: e.target.value })} />
              <TextField size="small" label="Acción" value={audF.accion} onChange={(e) => setAudF({ ...audF, accion: e.target.value })} />
              <TextField size="small" label="Desde" type="date" value={audF.desde} onChange={(e) => setAudF({ ...audF, desde: e.target.value })} InputLabelProps={{ shrink: true }} />
              <TextField size="small" label="Hasta" type="date" value={audF.hasta} onChange={(e) => setAudF({ ...audF, hasta: e.target.value })} InputLabelProps={{ shrink: true }} />
              <TextField size="small" label="Buscar acción" value={audF.search} onChange={(e) => setAudF({ ...audF, search: e.target.value })} />
              <Button variant="contained" size="small" onClick={() => { setAudPage(0); void cargarAuditoria(); }} sx={{ textTransform: 'none' }}>Buscar</Button>
              <Box sx={{ flex: 1 }} />
              <Button size="small" startIcon={<FileDownloadOutlinedIcon />} onClick={() => exportAud(false)} sx={{ textTransform: 'none' }}>CSV</Button>
              <Button size="small" startIcon={<FileDownloadOutlinedIcon />} onClick={() => exportAud(true)} sx={{ textTransform: 'none' }}>Excel</Button>
            </Box>
            <TableContainer sx={{ maxHeight: '58vh' }}>
              <Table stickyHeader size="small">
                <TableHead><TableRow>{['Fecha', 'Usuario', 'Módulo', 'Acción', 'Entidad', 'Detalle'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
                <TableBody>
                  {audItems.map((a) => (
                    <TableRow key={a.id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 12 }}>{String(a.created_at).slice(0, 19).replace('T', ' ')}</TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{a.actor_id ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{a.entidad}</TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{a.accion}</TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{a.entidad_id ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: 11, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.detalle ? JSON.stringify(a.detalle) : '—'}</TableCell>
                    </TableRow>
                  ))}
                  {audItems.length === 0 && <TableRow><TableCell colSpan={6} align="center" sx={{ py: 3, color: 'text.secondary' }}>Sin registros.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination component="div" count={audTotal} page={audPage} onPageChange={(_e, p) => setAudPage(p)} rowsPerPage={audRpp} onRowsPerPageChange={(e) => { setAudRpp(parseInt(e.target.value, 10)); setAudPage(0); }} rowsPerPageOptions={[25, 50, 100]} labelRowsPerPage="Filas" />
          </Stack>
        </Paper>
      )}

      <Snackbar open={Boolean(toast)} autoHideDuration={3500} onClose={() => setToast(null)} message={toast ?? ''} />
    </Box>
  );
};

export default ConfiguracionPage;
