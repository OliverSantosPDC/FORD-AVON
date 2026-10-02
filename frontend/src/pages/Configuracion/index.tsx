import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, Grid,
  MenuItem, Paper, Snackbar, Stack, Switch, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Tabs, TextField, Typography
} from '@mui/material';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import { useAuth } from '../../context/AuthContext';
import { useBranding } from '../../context/BrandingContext';
import { exportRowsToCsv, exportRowsToExcel } from '../../utils/tableExport';
import UsuariosPage from '../Usuarios';
import {
  getGeneral, putGeneral, getCatalogos, crearCatalogo, actualizarCatalogo,
  getPlantillas, subirPlantilla, descargarPlantilla, subirAsset, obtenerUrlAsset,
  getTasasConversion, actualizarTasaConversion, getMetaGlobal, guardarMetaGlobal,
  getPlantillasCarta, actualizarPlantillaCarta, previsualizarPlantillaCarta, previsualizarBorradorPlantillaCarta,
  type Catalogo, type Plantilla, type TasaConversion, type MetaGlobal,
  type PlantillaCarta, type VariableCarta, type CartaPreviewAdmin
} from '../../services/configuracionService';
import { simboloMoneda } from '../../utils/monedaOptions';
import CartaRenderer from '../../components/common/CartaRenderer';

const DIRECCIONES_PAIS: Array<{ clave: string; label: string }> = [
  { clave: 'direccion_pais_guatemala', label: 'Guatemala' },
  { clave: 'direccion_pais_el_salvador', label: 'El Salvador' },
  { clave: 'direccion_pais_honduras', label: 'Honduras' },
  { clave: 'direccion_pais_nicaragua', label: 'Nicaragua' },
  { clave: 'direccion_pais_panama', label: 'Panamá' },
  { clave: 'direccion_pais_republica_dominicana', label: 'República Dominicana' }
];

const CATALOGOS_FIJOS = [
  'tipificaciones', 'tipos_contacto', 'canales', 'estados_promesa', 'estados_carta',
  'tipos_evento', 'tipos_adjunto', 'motivos_aprobacion', 'motivos_rechazo'
];
const CAT_LABEL: Record<string, string> = {
  tipificaciones: 'Tipificaciones', tipos_contacto: 'Tipos de contacto', canales: 'Canales',
  estados_promesa: 'Estados de promesa', estados_carta: 'Estados de cartas', tipos_evento: 'Tipos de eventos',
  tipos_adjunto: 'Tipos de adjuntos', motivos_aprobacion: 'Motivos de aprobación', motivos_rechazo: 'Motivos de rechazo'
};
/** Claves resueltas por BrandingContext (Sidebar/Header/Login/favicon/fondos): ver uploadAsset(). */
const BRANDING_CLAVES = new Set(['logo_principal', 'logo_login', 'favicon', 'fondo_login', 'fondo_principal', 'fondo_dashboard']);

/**
 * Subida + previsualización real de un asset de imagen (logo/favicon/fondo).
 * Definido FUERA de ConfiguracionPage (a diferencia de la versión anterior,
 * declarada dentro del render): así no se remonta —y no se destruye el
 * <input type="file">— en cada cambio de estado de la página.
 *
 * La previsualización se resuelve con una URL FIRMADA (el bucket `config-assets`
 * es privado — nunca se expone una URL pública): se pide de nuevo cada vez que
 * `value` cambia, así que tras subir una imagen nueva (o al recargar la página,
 * que vuelve a montar este componente con el `value` ya persistido) siempre
 * apunta al archivo vigente, nunca a uno cacheado en el estado de React.
 */
const AssetUpload = ({ label, clave, value, canEdit, onUpload }: {
  label: string; clave: string; value: string; canEdit: boolean; onUpload: (clave: string, file: File) => void;
}) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setPreviewUrl(null);
    if (!value) return undefined;
    obtenerUrlAsset(clave).then((url) => { if (active) setPreviewUrl(url); });
    return () => { active = false; };
  }, [clave, value]);

  return (
    <Stack direction="row" spacing={1.5} alignItems="center">
      <Typography sx={{ fontSize: 13, minWidth: 130 }}>{label}</Typography>
      {previewUrl ? (
        <Box
          component="img"
          src={previewUrl}
          alt={label}
          onError={() => setPreviewUrl(null)}
          sx={{ height: 36, width: 36, objectFit: 'contain', borderRadius: 1, border: '1px solid', borderColor: 'divider', bgcolor: 'action.hover', p: 0.25 }}
        />
      ) : (
        <Box sx={{ height: 36, width: 36, borderRadius: 1, border: '1px dashed', borderColor: 'divider', flexShrink: 0 }} />
      )}
      <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 1 }}>{value || 'No configurado'}</Typography>
      {canEdit && (
        <Button variant="outlined" size="small" component="label" sx={{ textTransform: 'none' }}>
          Subir
          <input
            hidden
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              e.target.value = '';
              if (file) onUpload(clave, file);
            }}
          />
        </Button>
      )}
    </Stack>
  );
};

const ConfiguracionPage = () => {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('configuracion.editar');
  const canUsuarios = hasPermission('modulo.usuarios');
  const { refresh: refreshBranding } = useBranding();
  const [tab, setTab] = useState(0);
  // Deep-link de pestaña desde la navegación (?tab=N). Compatibilidad con la ruta actual.
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const raw = searchParams.get('tab');
    if (raw === null) return;
    const n = Number(raw);
    const maxTab = 9;
    if (Number.isInteger(n) && n >= 0 && n <= maxTab) setTab(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, canUsuarios]);
  // Pestañas "Usuarios" y "Metas" usan un índice NUMÉRICO FIJO (prop `value` explícita en
  // cada <Tab>, no la posición en el arreglo de etiquetas) para que su índice nunca cambie
  // según si "Usuarios" está presente o no (canUsuarios es condicional; Metas siempre existe).
  const TAB_USUARIOS = 8;
  const TAB_METAS = 9;
  const [toast, setToast] = useState<string | null>(null);

  // General
  const [general, setGeneral2] = useState<Record<string, string>>({});
  // Catálogos
  const [catalogos, setCatalogos] = useState<Catalogo[]>([]);
  const [catSel, setCatSel] = useState('tipificaciones');
  const [catSearch, setCatSearch] = useState('');
  const [nuevoCat, setNuevoCat] = useState('');
  // Plantillas
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  // Plantillas de carta de cobro por PD (PD1-PD3 comparten una; PD0 no tiene carta)
  const [plantillasCarta, setPlantillasCarta] = useState<PlantillaCarta[]>([]);
  const [variablesCarta, setVariablesCarta] = useState<VariableCarta[]>([]);
  const [cartaEditClave, setCartaEditClave] = useState<string | null>(null);
  const [cartaEditContenido, setCartaEditContenido] = useState('');
  const [cartaEditAsunto, setCartaEditAsunto] = useState('');
  const [cartaEditActivo, setCartaEditActivo] = useState(true);
  // Solo relevante al editar carta_pd7 — reutiliza la MISMA clave general
  // 'plazo_pd7_dias' (nunca un campo paralelo); se guarda junto con la
  // plantilla en un solo "Guardar" para que se sienta una sola edición.
  const [cartaEditPlazo, setCartaEditPlazo] = useState('');
  const [cartaEditBusy, setCartaEditBusy] = useState(false);
  // Pestañas Editor/Vista previa DENTRO del editor: el botón "Vista previa"
  // renderiza el BORRADOR (texto aún sin guardar) con el mismo CartaRenderer
  // de siempre, sin tocar lo guardado — volver a "Editor" nunca pierde lo
  // escrito, porque es el mismo estado local, solo cambia qué pestaña se ve.
  const [cartaEditTab, setCartaEditTab] = useState(0);
  const [cartaEditPreview, setCartaEditPreview] = useState<CartaPreviewAdmin | null>(null);
  const [cartaEditPreviewBusy, setCartaEditPreviewBusy] = useState(false);
  const [cartaPrevClave, setCartaPrevClave] = useState<string | null>(null);
  const [cartaPrevCodigo, setCartaPrevCodigo] = useState('');
  const [cartaPrevResult, setCartaPrevResult] = useState<CartaPreviewAdmin | null>(null);
  const [cartaPrevLogoUrl, setCartaPrevLogoUrl] = useState<string | null>(null);
  const [cartaPrevFirmaUrl, setCartaPrevFirmaUrl] = useState<string | null>(null);
  const [cartaPrevBusy, setCartaPrevBusy] = useState(false);
  // Tasas de conversión
  const [tasas, setTasas] = useState<TasaConversion[]>([]);
  const [tasaDrafts, setTasaDrafts] = useState<Record<string, string>>({});
  // Metas (configuración global única: % o monto, mutuamente excluyentes)
  const [metaCfg, setMetaCfg] = useState<MetaGlobal | null>(null);
  const [metaTipo, setMetaTipo] = useState<'PORCENTAJE' | 'MONTO'>('MONTO');
  const [metaDraft, setMetaDraft] = useState('');
  const [metaGuardando, setMetaGuardando] = useState(false);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [g, c, p, tc, mc, pc] = await Promise.all([getGeneral(), getCatalogos(), getPlantillas(), getTasasConversion(), getMetaGlobal(), getPlantillasCarta()]);
        setGeneral2(g); setCatalogos(c); setPlantillas(p); setTasas(tc);
        setPlantillasCarta(pc.items); setVariablesCarta(pc.variables);
        setMetaCfg(mc);
        setMetaTipo(mc.tipo ?? 'MONTO');
        setMetaDraft(mc.tipo === 'PORCENTAJE' ? String(Math.round((mc.porcentaje ?? 0) * 1e6) / 1e4) : mc.tipo === 'MONTO' ? String(Math.round((mc.montoUsdGlobal ?? 0) * 100) / 100) : '');
      } catch (e) { setToast(e instanceof Error ? e.message : 'Error al cargar.'); }
      finally { setLoading(false); }
    })();
  }, []);

  const gv = (k: string) => general[k] ?? '';
  const sgv = (k: string, v: string) => setGeneral2((s) => ({ ...s, [k]: v }));

  const guardarGeneral = async () => { try { await putGeneral(general); setToast('Guardado.'); } catch (e) { setToast(e instanceof Error ? e.message : 'Error.'); } };
  const uploadAsset = async (clave: string, file: File | null) => {
    if (!file) return;
    // Validación rápida en el cliente (MIME reportado por el navegador, image/*
    // genérico — no solo png/jpg): el backend vuelve a validar el contentType
    // real del archivo, esta es solo una respuesta inmediata sin ida y vuelta.
    if (!file.type.startsWith('image/')) { setToast('El archivo debe ser una imagen (PNG, JPG, GIF, WEBP, SVG, etc.).'); return; }
    try {
      await subirAsset(clave, file);
      setGeneral2(await getGeneral());
      // logo_principal/logo_login/favicon/fondo_login/fondo_principal/fondo_dashboard
      // alimentan Sidebar/Header/Login/favicon/fondos globalmente (BrandingContext):
      // refrescar ahí también, no solo el estado local de esta página, para que el
      // resto de la app use el nuevo asset sin esperar a un F5.
      if (BRANDING_CLAVES.has(clave)) refreshBranding();
      setToast('Imagen subida.');
    } catch (e) { setToast(e instanceof Error ? e.message : 'Error.'); }
  };

  const recargarCat = async () => setCatalogos(await getCatalogos());
  const catList = useMemo(() => catalogos.filter((c) => c.catalogo === catSel && c.nombre.toLowerCase().includes(catSearch.toLowerCase())), [catalogos, catSel, catSearch]);
  const catalogosDistintos = useMemo(() => [...new Set([...CATALOGOS_FIJOS, ...catalogos.map((c) => c.catalogo)])], [catalogos]);

  const descargarP = async (clave: string) => { try { const u = await descargarPlantilla(clave); window.open(u, '_blank'); } catch (e) { setToast(e instanceof Error ? e.message : 'Sin archivo.'); } };

  // Clave de la plantilla de PD7, derivada de las bandas que manda el backend
  // (nunca una clave fija asumida): el plazo configurable solo aplica a ella.
  const cartaPd7Clave = useMemo(() => plantillasCarta.find((p) => p.bandas.includes('PD7'))?.clave ?? null, [plantillasCarta]);

  const abrirEdicionCarta = (p: PlantillaCarta) => {
    setCartaEditClave(p.clave);
    setCartaEditContenido(p.contenido ?? '');
    setCartaEditAsunto(p.asunto ?? '');
    setCartaEditActivo(p.activo);
    setCartaEditPlazo(gv('plazo_pd7_dias'));
    setCartaEditTab(0);
    setCartaEditPreview(null);
    obtenerUrlAsset('logo_principal').then(setCartaPrevLogoUrl);
    obtenerUrlAsset('firma').then(setCartaPrevFirmaUrl);
  };
  /** Previsualiza el BORRADOR actual del editor (contenido/asunto tal como
   *  están en el textarea, aún sin guardar) — nunca toca lo persistido. */
  const previsualizarBorradorActual = async () => {
    if (!cartaEditClave || !cartaEditContenido.trim()) return;
    setCartaEditPreviewBusy(true);
    try {
      const r = await previsualizarBorradorPlantillaCarta(cartaEditClave, { contenido: cartaEditContenido, asunto: cartaEditAsunto });
      setCartaEditPreview(r);
    } catch (e) { setToast(e instanceof Error ? e.message : 'No se pudo previsualizar.'); }
    finally { setCartaEditPreviewBusy(false); }
  };
  const cambiarTabEditor = (tab: number) => {
    setCartaEditTab(tab);
    if (tab === 1) void previsualizarBorradorActual();
  };
  const guardarPlantillaCarta = async () => {
    if (!cartaEditClave) return;
    setCartaEditBusy(true);
    try {
      await actualizarPlantillaCarta(cartaEditClave, { contenido: cartaEditContenido, asunto: cartaEditAsunto, activo: cartaEditActivo });
      // Plazo (solo PD7): se persiste aquí mismo, en config_general, EXACTAMENTE
      // la misma clave 'plazo_pd7_dias' que usa el resto del sistema — nunca
      // un valor paralelo.
      if (cartaEditClave === cartaPd7Clave && cartaEditPlazo.trim() && cartaEditPlazo !== gv('plazo_pd7_dias')) {
        await putGeneral({ plazo_pd7_dias: cartaEditPlazo });
      }
      // Re-fetch desde el servidor (NUNCA solo el estado local recién editado)
      // para confirmar que lo guardado realmente persistió.
      const [pc, g] = await Promise.all([getPlantillasCarta(), getGeneral()]);
      setPlantillasCarta(pc.items);
      setGeneral2(g);
      setToast('Plantilla de carta actualizada y confirmada en el servidor.');
      setCartaEditClave(null);
    } catch (e) { setToast(e instanceof Error ? e.message : 'No se pudo guardar.'); }
    finally { setCartaEditBusy(false); }
  };

  const abrirPreviewCarta = (clave: string) => {
    setCartaPrevClave(clave); setCartaPrevCodigo(''); setCartaPrevResult(null);
    obtenerUrlAsset('logo_principal').then(setCartaPrevLogoUrl);
    obtenerUrlAsset('firma').then(setCartaPrevFirmaUrl);
    setCartaPrevBusy(true);
    previsualizarPlantillaCarta(clave, {}).then(setCartaPrevResult).catch((e) => setToast(e instanceof Error ? e.message : 'No se pudo previsualizar.')).finally(() => setCartaPrevBusy(false));
  };
  const ejecutarPreviewCarta = async () => {
    if (!cartaPrevClave) return;
    setCartaPrevBusy(true);
    try {
      const r = await previsualizarPlantillaCarta(cartaPrevClave, cartaPrevCodigo.trim() ? { codigo: cartaPrevCodigo.trim() } : {});
      setCartaPrevResult(r);
    } catch (e) { setToast(e instanceof Error ? e.message : 'No se pudo previsualizar.'); }
    finally { setCartaPrevBusy(false); }
  };

  const metaDraftNum = Number(metaDraft);
  const metaDraftValido = metaDraft.trim() !== '' && Number.isFinite(metaDraftNum) && metaDraftNum > 0;
  const guardarMeta = async () => {
    if (!metaDraftValido) return;
    setMetaGuardando(true);
    try {
      await guardarMetaGlobal(
        metaTipo === 'PORCENTAJE' ? { tipo: 'PORCENTAJE', porcentaje: metaDraftNum / 100 } : { tipo: 'MONTO', montoUsd: metaDraftNum }
      );
      const mc = await getMetaGlobal();
      setMetaCfg(mc);
      setMetaTipo(mc.tipo ?? 'MONTO');
      setMetaDraft(mc.tipo === 'PORCENTAJE' ? String(Math.round((mc.porcentaje ?? 0) * 1e6) / 1e4) : String(Math.round((mc.montoUsdGlobal ?? 0) * 100) / 100));
      setToast('Meta guardada.');
    } catch (e) { setToast(e instanceof Error ? e.message : 'No se pudo guardar la meta.'); }
    finally { setMetaGuardando(false); }
  };

  if (loading) return <Box sx={{ display: 'flex', gap: 1.5, p: 3, alignItems: 'center' }}><CircularProgress size={22} /><Typography sx={{ fontSize: 14 }}>Cargando configuración...</Typography></Box>;

  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" sx={{ mb: 2 }}>
        {([[0, 'General'], [1, 'Catálogos'], [4, 'Plantillas'], [7, 'Tasas de Conversión']] as Array<[number, string]>).map(([v, t]) => <Tab key={t} value={v} label={t} sx={{ textTransform: 'none' }} />)}
        {canUsuarios && <Tab key="Usuarios" value={TAB_USUARIOS} label="Usuarios" sx={{ textTransform: 'none' }} />}
        <Tab key="Metas" value={TAB_METAS} label="Metas" sx={{ textTransform: 'none' }} />
      </Tabs>

      {/* GENERAL (incluye las opciones que antes vivían en la pestaña Apariencia,
          salvo "Orden de módulos del menú lateral", eliminada por completo) */}
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
            <AssetUpload label="Logo principal" clave="logo_principal" value={gv('logo_principal')} canEdit={canEdit} onUpload={uploadAsset} />
            <AssetUpload label="Logo Login" clave="logo_login" value={gv('logo_login')} canEdit={canEdit} onUpload={uploadAsset} />
            <AssetUpload label="Favicon" clave="favicon" value={gv('favicon')} canEdit={canEdit} onUpload={uploadAsset} />
            <AssetUpload label="Firma (cartas de cobro)" clave="firma" value={gv('firma')} canEdit={canEdit} onUpload={uploadAsset} />
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
            <Divider /><Typography sx={{ fontWeight: 700 }}>Tema y densidad</Typography>
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
            <Divider /><Typography sx={{ fontWeight: 700 }}>Fondos</Typography>
            <AssetUpload label="Fondo Login" clave="fondo_login" value={gv('fondo_login')} canEdit={canEdit} onUpload={uploadAsset} />
            <AssetUpload label="Fondo principal" clave="fondo_principal" value={gv('fondo_principal')} canEdit={canEdit} onUpload={uploadAsset} />
            <AssetUpload label="Fondo Dashboard" clave="fondo_dashboard" value={gv('fondo_dashboard')} canEdit={canEdit} onUpload={uploadAsset} />
            {canEdit && <Box><Button variant="contained" onClick={guardarGeneral} sx={{ textTransform: 'none' }}>Guardar apariencia</Button></Box>}
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

      {/* PLANTILLAS — tabla única de registros. Para las 5 cartas de cobro
          por PD (carta_pd1/4/5/6/7), además de las acciones de ARCHIVO
          (Descargar / Reemplazar), se agregan las acciones de PLANTILLA DE
          TEXTO: Visualizar / Editar — en la MISMA fila, nunca en otra
          sección aparte. */}
      {tab === 4 && (
        <Paper sx={{ p: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ mb: 1.5 }}>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              Las filas "Carta PD1-PD3 / PD4+ / PD5 / PD6 / PD7" son plantillas de TEXTO configurables (contenido en
              config_plantillas): usa <strong>Visualizar</strong> para leer la carta completa y <strong>Editar</strong> para
              modificar asunto/cuerpo/estado (y el plazo, solo en PD7). PD0 no tiene carta. PD1-PD3 comparten una misma
              plantilla — editarla afecta a las tres.
            </Typography>
          </Box>
          <TableContainer sx={{ maxHeight: '65vh' }}>
            <Table stickyHeader size="small">
              <TableHead><TableRow>{['Plantilla', 'Versión', 'Fecha', 'Usuario', 'Estado', 'Acciones'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>
                {plantillas.map((p) => {
                  const carta = plantillasCarta.find((pc) => pc.clave === p.clave);
                  return (
                    <TableRow key={p.id} hover>
                      <TableCell>
                        {p.nombre}
                        {carta && <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{carta.tono} · {carta.bandas.join('/')}</Typography>}
                      </TableCell>
                      <TableCell>{carta ? carta.version ?? 1 : p.version ?? 1}</TableCell>
                      <TableCell sx={{ fontSize: 12 }}>
                        {carta
                          ? (carta.updatedAt ? String(carta.updatedAt).slice(0, 16).replace('T', ' ') : '—')
                          : (p.updated_at ? String(p.updated_at).slice(0, 16).replace('T', ' ') : '—')}
                      </TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{(carta ? carta.updatedBy : p.updated_by) ?? '—'}</TableCell>
                      <TableCell>
                        {carta
                          ? <Chip size="small" label={carta.activo ? 'Activa' : 'Inactiva'} color={carta.activo ? 'success' : 'default'} variant={carta.activo ? 'filled' : 'outlined'} />
                          : <Chip size="small" label={p.url ? 'Configurada' : 'Sin archivo'} color={p.url ? 'success' : 'default'} variant="outlined" />}
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {carta && <Button size="small" variant="outlined" onClick={() => abrirPreviewCarta(carta.clave)} sx={{ textTransform: 'none' }}>Visualizar</Button>}
                          {carta && canEdit && <Button size="small" variant="contained" onClick={() => abrirEdicionCarta(carta)} sx={{ textTransform: 'none' }}>Editar</Button>}
                          <Button size="small" disabled={!p.url} onClick={() => descargarP(p.clave)} sx={{ textTransform: 'none' }}>Descargar</Button>
                          {canEdit && <Button size="small" component="label" sx={{ textTransform: 'none' }}>Reemplazar / Nueva versión<input hidden type="file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { await subirPlantilla(p.clave, f); setPlantillas(await getPlantillas()); setToast('Plantilla actualizada.'); } }} /></Button>}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          <Divider sx={{ my: 3 }} />
          <Stack spacing={2}>
            <Typography sx={{ fontWeight: 700, fontSize: 13 }}>Datos de contacto (aplican a las 5 plantillas de carta)</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}><TextField label="WhatsApp de cobros" value={gv('whatsapp_cobros')} onChange={(e) => sgv('whatsapp_cobros', e.target.value)} size="small" fullWidth disabled={!canEdit} /></Grid>
            </Grid>
            <Typography sx={{ fontWeight: 700, fontSize: 13 }}>Direcciones por país (Localización de la carta)</Typography>
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
              Solo la dirección/ciudad — el país ya se antepone automáticamente. Ej. para Guatemala, escribir
              "Ciudad de Guatemala" produce "Guatemala, Ciudad de Guatemala" en la carta.
            </Typography>
            <Grid container spacing={2}>
              {DIRECCIONES_PAIS.map(({ clave, label }) => (
                <Grid item xs={12} sm={6} key={clave}>
                  <TextField label={label} value={gv(clave)} onChange={(e) => sgv(clave, e.target.value)} size="small" fullWidth disabled={!canEdit} placeholder="Ej. Ciudad de Guatemala" />
                </Grid>
              ))}
            </Grid>
            {canEdit && <Box><Button variant="contained" onClick={guardarGeneral} sx={{ textTransform: 'none' }}>Guardar configuración de cartas</Button></Box>}
          </Stack>
        </Paper>
      )}

      {/* Editar carta: Asunto (campo propio), activo/inactiva, plazo SOLO si
          es carta_pd7, cuerpo multilínea + variables — con pestañas Editor /
          Vista previa (la vista previa renderiza el BORRADOR sin guardar). */}
      <Dialog open={Boolean(cartaEditClave)} onClose={() => setCartaEditClave(null)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Editar carta · {plantillasCarta.find((p) => p.clave === cartaEditClave)?.nombre}</DialogTitle>
        <Tabs value={cartaEditTab} onChange={(_e, v) => cambiarTabEditor(v)} sx={{ px: 3, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Tab label="Editor" sx={{ textTransform: 'none' }} />
          <Tab label="Vista previa" sx={{ textTransform: 'none' }} />
        </Tabs>
        <DialogContent dividers sx={{ bgcolor: cartaEditTab === 1 ? 'action.hover' : 'background.paper' }}>
          {cartaEditTab === 0 && (
            <Stack spacing={2}>
              <Stack direction="row" spacing={2} alignItems="center">
                <TextField label="Asunto" value={cartaEditAsunto} onChange={(e) => setCartaEditAsunto(e.target.value)} size="small" fullWidth disabled={!canEdit} />
                <FormControlLabel
                  sx={{ whiteSpace: 'nowrap', mr: 0 }}
                  control={<Switch checked={cartaEditActivo} onChange={(e) => setCartaEditActivo(e.target.checked)} disabled={!canEdit} />}
                  label={cartaEditActivo ? 'Activa' : 'Inactiva'}
                />
              </Stack>
              {!cartaEditActivo && (
                <Alert severity="warning" sx={{ py: 0.5 }}>
                  Mientras esté inactiva, el Gestor NO podrá generar ni previsualizar esta carta.
                </Alert>
              )}
              {cartaEditClave === cartaPd7Clave && (
                <TextField
                  label="Plazo de días (solo PD7)"
                  type="number"
                  value={cartaEditPlazo}
                  onChange={(e) => setCartaEditPlazo(e.target.value)}
                  size="small"
                  sx={{ maxWidth: 260 }}
                  disabled={!canEdit}
                  inputProps={{ min: 0, step: 1 }}
                />
              )}
              <Box>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>
                  Variables disponibles — haz clic en una para copiarla, y pégala donde la necesites dentro del texto.
                  «Logo» y «Firma» se reemplazan por las imágenes configuradas, solo una vez autorizada la carta.
                </Typography>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  {variablesCarta.map((v) => (
                    <Chip
                      key={v.variable}
                      size="small"
                      variant="outlined"
                      label={`«${v.variable}»${v.soloPd7 ? ' (solo PD7)' : ''}`}
                      title={`${v.descripcion} — clic para copiar`}
                      onClick={() => { navigator.clipboard?.writeText(`«${v.variable}»`).then(() => setToast(`«${v.variable}» copiada.`)).catch(() => undefined); }}
                      sx={{ cursor: 'pointer' }}
                    />
                  ))}
                </Stack>
              </Box>
              <TextField
                value={cartaEditContenido}
                onChange={(e) => setCartaEditContenido(e.target.value)}
                multiline minRows={22} maxRows={22} fullWidth disabled={!canEdit}
                placeholder="Cuerpo completo de la carta..."
                sx={{ '& textarea': { fontFamily: 'monospace', fontSize: 13 } }}
              />
            </Stack>
          )}
          {cartaEditTab === 1 && (
            <Stack spacing={2} alignItems="center">
              <Typography sx={{ fontSize: 12, color: 'text.secondary', alignSelf: 'flex-start' }}>
                Vista previa del borrador actual (sin guardar) — con una cuenta de prueba representativa del PD.
                Esto NO crea ni modifica ninguna carta real.
              </Typography>
              {cartaEditPreviewBusy && <CircularProgress size={22} />}
              {cartaEditPreview?.variablesFaltantes && cartaEditPreview.variablesFaltantes.length > 0 && (
                <Alert severity="warning" sx={{ py: 0.5, alignSelf: 'stretch' }}>
                  Pendiente de configurar: {cartaEditPreview.variablesFaltantes.join(', ')}
                </Alert>
              )}
              {cartaEditPreview?.contenido && (
                <Box sx={{ boxShadow: 3, borderRadius: 1, bgcolor: '#fff' }}>
                  <CartaRenderer contenido={cartaEditPreview.contenido} logoUrl={cartaPrevLogoUrl} firmaUrl={cartaPrevFirmaUrl} />
                </Box>
              )}
              <Button size="small" variant="outlined" disabled={cartaEditPreviewBusy} onClick={previsualizarBorradorActual} sx={{ textTransform: 'none' }}>
                Actualizar vista previa
              </Button>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCartaEditClave(null)} sx={{ textTransform: 'none' }}>Cancelar</Button>
          {cartaEditTab === 0 && (
            <Button variant="outlined" disabled={!cartaEditContenido.trim()} onClick={() => cambiarTabEditor(1)} sx={{ textTransform: 'none' }}>
              Vista previa
            </Button>
          )}
          {canEdit && (
            <Button
              variant="contained"
              disabled={cartaEditBusy || !cartaEditContenido.trim() || !cartaEditAsunto.trim()}
              onClick={guardarPlantillaCarta}
              sx={{ textTransform: 'none' }}
            >
              {cartaEditBusy ? 'Guardando...' : 'Guardar'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Visualizar carta: la carta COMPLETA ya guardada, renderizada con el
          mismo CartaRenderer de Gestión/Control Operativo — solo una
          PREVISUALIZACIÓN (nunca crea/aprueba una carta real ni descarga). */}
      <Dialog open={Boolean(cartaPrevClave)} onClose={() => setCartaPrevClave(null)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Visualizar carta · {plantillasCarta.find((p) => p.clave === cartaPrevClave)?.nombre}</DialogTitle>
        <DialogContent dividers sx={{ bgcolor: 'action.hover' }}>
          <Stack spacing={2} alignItems="center">
            <Stack direction="row" spacing={1} sx={{ alignSelf: 'stretch' }}>
              <TextField label="Código de cuenta real (opcional)" value={cartaPrevCodigo} onChange={(e) => setCartaPrevCodigo(e.target.value)} size="small" fullWidth />
              <Button variant="outlined" disabled={cartaPrevBusy} onClick={ejecutarPreviewCarta} sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}>Cargar</Button>
            </Stack>
            <Typography sx={{ fontSize: 11, color: 'text.secondary', alignSelf: 'flex-start' }}>Sin código, se usa una cuenta de prueba representativa de este PD.</Typography>
            {cartaPrevBusy && <CircularProgress size={22} />}
            {cartaPrevResult && !cartaPrevResult.disponible && (
              <Alert severity="info" sx={{ py: 0.5, alignSelf: 'stretch' }}>
                {cartaPrevResult.variablesFaltantes.includes('plantilla_inactiva')
                  ? 'Esta plantilla está desactivada. Actívala en "Editar carta" para poder previsualizarla.'
                  : 'No hay plantilla disponible para este PD.'}
              </Alert>
            )}
            {cartaPrevResult?.disponible && cartaPrevResult.variablesFaltantes.length > 0 && (
              <Alert severity="warning" sx={{ py: 0.5, alignSelf: 'stretch' }}>
                Pendiente de configurar: {cartaPrevResult.variablesFaltantes.join(', ')}
              </Alert>
            )}
            {cartaPrevResult?.contenido && (
              <Box sx={{ boxShadow: 3, borderRadius: 1, bgcolor: '#fff' }}>
                <CartaRenderer contenido={cartaPrevResult.contenido} logoUrl={cartaPrevLogoUrl} firmaUrl={cartaPrevFirmaUrl} />
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCartaPrevClave(null)} sx={{ textTransform: 'none' }}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      {/* TASAS DE CONVERSIÓN */}
      {tab === 7 && (
        <Paper sx={{ p: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
          <Stack spacing={2}>
            <Box>
              <Typography sx={{ fontWeight: 700 }}>Tasas de Conversión</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                Unidades de moneda local equivalentes a 1 USD. Fuente oficial usada por el Dashboard. Dólares y Balboas inician en 1.
              </Typography>
            </Box>
            <TableContainer sx={{ maxHeight: '60vh' }}>
              <Table stickyHeader size="small">
                <TableHead><TableRow>{['Moneda', 'Código', 'Símbolo', 'Tasa (por 1 USD)', 'Actualizado'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
                <TableBody>
                  {tasas.map((t) => {
                    const draft = tasaDrafts[t.id] ?? String(t.tasa);
                    const draftNum = Number(draft);
                    const isValid = draft.trim() !== '' && Number.isFinite(draftNum) && draftNum > 0;
                    const isDirty = draft !== String(t.tasa);
                    return (
                      <TableRow key={t.id} hover>
                        <TableCell sx={{ fontWeight: 600 }}>{t.nombre}</TableCell>
                        <TableCell>{t.codigo}</TableCell>
                        <TableCell>{simboloMoneda(t.codigo)}</TableCell>
                        <TableCell>
                          {canEdit ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <TextField
                                variant="outlined"
                                size="small"
                                type="number"
                                value={draft}
                                error={!isValid}
                                inputProps={{ step: '0.0001', min: '0' }}
                                sx={{ width: 140 }}
                                onChange={(e) => setTasaDrafts((prev) => ({ ...prev, [t.id]: e.target.value }))}
                              />
                              <Button
                                size="small"
                                variant="contained"
                                disabled={!isDirty || !isValid}
                                onClick={async () => {
                                  try {
                                    await actualizarTasaConversion(t.id, draftNum);
                                    setTasas(await getTasasConversion());
                                    setTasaDrafts((prev) => { const next = { ...prev }; delete next[t.id]; return next; });
                                    setToast('Tasa actualizada.');
                                  } catch (err) { setToast(err instanceof Error ? err.message : 'No se pudo guardar.'); }
                                }}
                                sx={{ textTransform: 'none' }}
                              >
                                Guardar
                              </Button>
                            </Box>
                          ) : t.tasa.toFixed(4)}
                        </TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{t.updated_at ? String(t.updated_at).slice(0, 16).replace('T', ' ') : '—'}</TableCell>
                      </TableRow>
                    );
                  })}
                  {tasas.length === 0 && <TableRow><TableCell colSpan={5} align="center" sx={{ py: 3, color: 'text.secondary' }}>Sin registros.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </TableContainer>
          </Stack>
        </Paper>
      )}

      {/* METAS (configuración global única: % o monto, mutuamente excluyentes) */}
      {tab === TAB_METAS && (
        <Paper sx={{ p: 2, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
          <Stack spacing={2} sx={{ maxWidth: 560 }}>
            <Box>
              <Typography sx={{ fontWeight: 700 }}>Metas</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                Configuración global única de meta de recuperación. Define UNA de las dos fuentes;
                la otra se calcula automáticamente contra el saldo inicial total de la cartera.
                Centro de Inteligencia distribuye esta meta proporcionalmente por país, PD y gestor.
              </Typography>
            </Box>
            <TextField
              select
              label="Meta definida en"
              size="small"
              value={metaTipo}
              disabled={!canEdit}
              onChange={(e) => {
                const nuevoTipo = e.target.value as 'PORCENTAJE' | 'MONTO';
                setMetaTipo(nuevoTipo);
                setMetaDraft(nuevoTipo === 'PORCENTAJE'
                  ? String(Math.round((metaCfg?.porcentaje ?? 0) * 1e6) / 1e4)
                  : String(Math.round((metaCfg?.montoUsdGlobal ?? 0) * 100) / 100));
              }}
            >
              <MenuItem value="PORCENTAJE">Porcentaje (%)</MenuItem>
              <MenuItem value="MONTO">Monto (USD)</MenuItem>
            </TextField>
            <TextField
              label={metaTipo === 'PORCENTAJE' ? 'Meta %' : 'Meta Monto (USD)'}
              size="small"
              type="number"
              value={metaDraft}
              error={!metaDraftValido}
              disabled={!canEdit}
              inputProps={{ step: metaTipo === 'PORCENTAJE' ? '0.01' : '1', min: '0' }}
              InputProps={{ endAdornment: metaTipo === 'PORCENTAJE' ? '%' : undefined }}
              onChange={(e) => setMetaDraft(e.target.value)}
            />
            {canEdit && (
              <Box>
                <Button variant="contained" disabled={!metaDraftValido || metaGuardando} onClick={guardarMeta} sx={{ textTransform: 'none' }}>
                  {metaGuardando ? 'Guardando...' : 'Guardar'}
                </Button>
              </Box>
            )}
            <Divider />
            <Typography sx={{ fontWeight: 700 }}>Información calculada</Typography>
            {!metaCfg?.definida ? (
              <Alert severity="info" sx={{ py: 0.5 }}>Aún no hay una meta configurada.</Alert>
            ) : (
              <Grid container spacing={1.5}>
                <Grid item xs={12} sm={4}>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase' }}>Total Saldo Inicial</Typography>
                  <Typography sx={{ fontSize: 16, fontWeight: 800 }}>${metaCfg.totalSaldoInicialUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}</Typography>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase' }}>Meta %</Typography>
                  <Typography sx={{ fontSize: 16, fontWeight: 800 }}>{((metaCfg.porcentaje ?? 0) * 100).toFixed(2)}%</Typography>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase' }}>Meta Monto</Typography>
                  <Typography sx={{ fontSize: 16, fontWeight: 800 }}>${(metaCfg.montoUsdGlobal ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</Typography>
                </Grid>
              </Grid>
            )}
            {metaCfg?.updatedAt && <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Última actualización: {String(metaCfg.updatedAt).slice(0, 16).replace('T', ' ')}</Typography>}
          </Stack>
        </Paper>
      )}

      {/* USUARIOS (módulo integrado dentro de Configuración; reutiliza la página existente) */}
      {canUsuarios && tab === TAB_USUARIOS && (
        <Box sx={{ mx: -2 }}>
          <UsuariosPage />
        </Box>
      )}

      <Snackbar open={Boolean(toast)} autoHideDuration={3500} onClose={() => setToast(null)} message={toast ?? ''} />
    </Box>
  );
};

export default ConfiguracionPage;
