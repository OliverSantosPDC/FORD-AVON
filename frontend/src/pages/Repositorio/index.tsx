import { useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Divider, FormControlLabel, Paper, Stack, Tab, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tabs, Typography
} from '@mui/material';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined';
import CargarCarteraPage from '../CargarCartera';
import GestionCalendario from '../Calendario/GestionCalendario';
import { useAuth } from '../../context/AuthContext';
import { downloadBlob, exportRowsToExcel } from '../../utils/tableExport';
import { descargarPlantilla, validarImportacion, aplicarImportacion, type PreviewItem, type ResumenImport, type ResultadoAplicarItem } from '../../services/usuariosService';

const ResumenChips = ({ r }: { r: ResumenImport }) => (
  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ my: 1.5 }}>
    <Chip label={`Total: ${r.total}`} /><Chip color="success" variant="outlined" label={`Válidas: ${r.validas}`} />
    <Chip color="error" variant="outlined" label={`Errores: ${r.errores}`} /><Chip variant="outlined" label={`Crear: ${r.creaciones}`} />
    <Chip variant="outlined" label={`Actualizar: ${r.actualizaciones}`} /><Chip variant="outlined" label={`Activar: ${r.activaciones}`} />
    <Chip variant="outlined" label={`Desactivar: ${r.desactivaciones}`} />
    <Chip color="info" variant="outlined" label={`Relaciones creadas: ${r.relacionesCreadas}`} />
    <Chip color="info" variant="outlined" label={`Relaciones vigentes: ${r.relacionesVigentes}`} />
    <Chip color="warning" variant="outlined" label={`Relaciones eliminadas: ${r.relacionesEliminadas}`} />
  </Stack>
);

type Etapa = 'idle' | 'seleccionado' | 'validando' | 'procesando' | 'completado' | 'error';
const ETAPA_LABEL: Record<Etapa, string> = {
  idle: '', seleccionado: 'Archivo seleccionado', validando: 'Validando…',
  procesando: 'Procesando: aplicando usuarios, actualizando Supabase y sincronizando relaciones…',
  completado: 'Completado', error: 'Error'
};

const GestionMasivaUsuarios = () => {
  const inputRef = useRef<HTMLInputElement>(null); const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [etapa, setEtapa] = useState<Etapa>('idle');
  const [preview, setPreview] = useState<{ items: PreviewItem[]; resumen: ResumenImport } | null>(null);
  const [result, setResult] = useState<{ resultados: ResultadoAplicarItem[]; resumen: ResumenImport } | null>(null);
  const [soloErrores, setSoloErrores] = useState(false);
  const previewItemsMostrados = useMemo(() => (preview ? (soloErrores ? preview.items.filter((it) => it.estado === 'ERROR') : preview.items) : []), [preview, soloErrores]);
  const reset = () => { setPreview(null); setResult(null); setError(null); setEtapa(file ? 'seleccionado' : 'idle'); };
  const onSelect = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0] ?? null; setFile(f); setPreview(null); setResult(null); setError(null); setEtapa(f ? 'seleccionado' : 'idle'); };
  const onPlantilla = async () => { setError(null); try { const blob = await descargarPlantilla(); downloadBlob(blob, 'plantilla_usuarios.xlsx'); } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo descargar la plantilla.'); } };
  const onValidar = async () => { if (!file) return; setBusy(true); setError(null); setResult(null); setEtapa('validando'); try { setPreview(await validarImportacion(file)); setEtapa('seleccionado'); } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo validar el archivo.'); setEtapa('error'); } finally { setBusy(false); } };
  const onAplicar = async (soloValidas: boolean) => {
    if (!file) return;
    setBusy(true); setError(null); setEtapa('procesando');
    try {
      const res = await aplicarImportacion(file, soloValidas);
      setResult(res); setPreview(null); setEtapa('completado');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo procesar el archivo.'); setEtapa('error');
    } finally { setBusy(false); }
  };
  const onDescargarReporte = () => { if (!result) return; const headers = ['HOJA','FILA','ACCION','EMAIL','NOMBRE','APELLIDO','ROL','COLUMNA','ESTADO','CONTRASEÑA_TEMPORAL','MENSAJE']; const rows = result.resultados.map((r) => [r.hoja,r.fila,r.accion,r.email,r.nombre ?? '',r.apellido ?? '',r.rol ?? '',r.columna || '',r.resultado,r.password ?? '',r.mensaje]); exportRowsToExcel('resultado_usuarios.xlsx','Resultado',headers,rows); };
  const hayPasswords = Boolean(result?.resultados.some((r) => r.password)); const tieneErrores = (preview?.resumen.errores ?? 0) > 0;
  return <Box sx={{ maxWidth: 980, mx: 'auto', py: 1 }}><Typography sx={{ fontSize: 18, fontWeight: 700, mb: .5 }}>Gestión masiva de usuarios</Typography><Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>Descarga la plantilla, complétala y súbela. Primero se valida (sin cambios) y luego confirmas la aplicación.</Typography><Paper sx={{ p: 3, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}><Stack spacing={2}>
    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}><Button variant="outlined" startIcon={<DownloadOutlinedIcon />} onClick={onPlantilla} sx={{ textTransform:'none', borderRadius:2 }}>Descargar plantilla</Button><input ref={inputRef} type="file" accept=".xlsx" onChange={onSelect} style={{ display:'none' }} /><Button variant="outlined" startIcon={<UploadFileOutlinedIcon />} onClick={() => inputRef.current?.click()} sx={{ textTransform:'none', borderRadius:2 }}>Seleccionar archivo</Button><Typography sx={{ fontSize:13, color:file?'text.primary':'text.secondary' }}>{file?file.name:'Ningún archivo seleccionado'}</Typography><Box sx={{flex:1}}/><Button variant="contained" startIcon={<PlayArrowOutlinedIcon />} onClick={onValidar} disabled={!file||busy} sx={{textTransform:'none',borderRadius:2}}>{busy&&!result?<CircularProgress size={20} color="inherit"/>:'Validar archivo'}</Button></Box>
    {etapa!=='idle'&&<Chip size="small" label={ETAPA_LABEL[etapa]} color={etapa==='completado'?'success':etapa==='error'?'error':etapa==='procesando'||etapa==='validando'?'info':'default'} variant="outlined" sx={{alignSelf:'flex-start'}}/>}
    {error&&<Alert severity="error">{error}</Alert>}
    {preview&&<><Divider/><Typography sx={{fontWeight:700}}>Vista previa</Typography><ResumenChips r={preview.resumen}/>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{mb:0.5}}>
        <FormControlLabel control={<Checkbox size="small" checked={soloErrores} onChange={(e)=>setSoloErrores(e.target.checked)} disabled={preview.resumen.errores===0} />} label={<Typography sx={{fontSize:13}}>Mostrar solo errores ({preview.resumen.errores})</Typography>} />
      </Stack>
      <TableContainer sx={{maxHeight:420}}><Table stickyHeader size="small"><TableHead><TableRow>{['Hoja','Fila','Estado','Error / Motivo','Acción','Email','Rol','Valor','Columna'].map(h=><TableCell key={h} sx={{fontWeight:700}}>{h}</TableCell>)}</TableRow></TableHead><TableBody>{previewItemsMostrados.length===0?<TableRow><TableCell colSpan={9}><Typography sx={{fontSize:13,color:'text.secondary',textAlign:'center',py:2}}>Sin errores para mostrar.</Typography></TableCell></TableRow>:previewItemsMostrados.map(it=><TableRow key={`${it.hoja}-${it.fila}-${it.columna}`} hover sx={it.estado==='ERROR'?{bgcolor:(t)=>t.palette.mode==='dark'?'rgba(244,67,54,0.16)':'rgba(244,67,54,0.07)'}:undefined}><TableCell sx={{whiteSpace:'nowrap'}}>{it.hoja}</TableCell><TableCell>{it.fila}</TableCell><TableCell><Chip size="small" label={it.estado} color={it.estado==='VALIDO'?'success':'error'} variant="outlined"/></TableCell><TableCell sx={{fontSize:12,fontWeight:it.estado==='ERROR'?600:400,minWidth:260}}>{it.estado==='ERROR'?it.mensaje:'—'}</TableCell><TableCell>{it.accion||'—'}</TableCell><TableCell sx={{whiteSpace:'nowrap'}}>{it.email}</TableCell><TableCell>{it.rol||'—'}</TableCell><TableCell sx={{whiteSpace:'nowrap'}}>{it.valor||'—'}</TableCell><TableCell sx={{whiteSpace:'nowrap'}}>{it.columna||'—'}</TableCell></TableRow>)}</TableBody></Table></TableContainer><Stack direction="row" spacing={1.5} justifyContent="flex-end"><Button onClick={reset} sx={{textTransform:'none'}}>Cancelar</Button>{tieneErrores?<Button variant="contained" color="warning" disabled={busy||preview.resumen.validas===0} onClick={()=>onAplicar(true)} sx={{textTransform:'none'}}>Procesar solo válidas ({preview.resumen.validas})</Button>:<Button variant="contained" disabled={busy||preview.resumen.validas===0} onClick={()=>onAplicar(false)} sx={{textTransform:'none'}}>Aplicar cambios</Button>}</Stack></>}
    {result&&<><Divider/><Alert severity="success">Proceso completado.</Alert>{hayPasswords&&<Alert severity="warning">El archivo de resultados contiene contraseñas temporales. Descárgalo, guárdalo de forma segura y elimínalo tras compartir las credenciales.</Alert>}<ResumenChips r={result.resumen}/><TableContainer sx={{maxHeight:320}}><Table stickyHeader size="small"><TableHead><TableRow>{['Hoja','Fila','Acción','Email','Columna','Resultado','Mensaje'].map(h=><TableCell key={h} sx={{fontWeight:700}}>{h}</TableCell>)}</TableRow></TableHead><TableBody>{result.resultados.map(r=><TableRow key={`${r.hoja}-${r.fila}`} hover><TableCell sx={{whiteSpace:'nowrap'}}>{r.hoja}</TableCell><TableCell>{r.fila}</TableCell><TableCell>{r.accion||'—'}</TableCell><TableCell sx={{whiteSpace:'nowrap'}}>{r.email}</TableCell><TableCell sx={{whiteSpace:'nowrap'}}>{r.columna||'—'}</TableCell><TableCell><Chip size="small" label={r.resultado} color={r.resultado==='OK'?'success':'error'} variant="outlined"/></TableCell><TableCell sx={{fontSize:12}}>{r.mensaje}</TableCell></TableRow>)}</TableBody></Table></TableContainer><Stack direction="row" justifyContent="flex-end"><Button variant="outlined" startIcon={<DownloadOutlinedIcon />} onClick={onDescargarReporte} sx={{textTransform:'none'}}>Descargar reporte</Button></Stack></>}
  </Stack></Paper></Box>;
};

const RepositorioPage = () => {
  const { hasPermission } = useAuth(); const puedeAdministrarUsuarios = hasPermission('usuarios.administrar_global'); const puedeCalendario = hasPermission('calendario.crear');
  const [tab, setTab] = useState(() => { const raw = new URLSearchParams(window.location.search).get('tab'); return raw === '1' || raw === '2' ? Number(raw) : 0; });
  const visible = (value: number) => value === 0 || (value === 1 ? puedeAdministrarUsuarios : puedeCalendario);
  const activeTab = visible(tab) ? tab : 0;
  const changeTab = (_e: React.SyntheticEvent, value: number) => { if (!visible(value)) return; setTab(value); const params = new URLSearchParams(window.location.search); params.set('tab', String(value)); window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`); };
  return <Box sx={{p:{xs:1,md:2}}}><Tabs value={activeTab} onChange={changeTab} sx={{mb:2}}><Tab value={0} label="Gestión de Cartera" sx={{textTransform:'none'}} />{puedeAdministrarUsuarios&&<Tab value={1} label="Gestión masiva de usuarios" sx={{textTransform:'none'}}/>}{puedeCalendario&&<Tab value={2} label="Gestión de calendario" sx={{textTransform:'none'}}/>}</Tabs>{activeTab===0&&<CargarCarteraPage/>}{activeTab===1&&puedeAdministrarUsuarios&&<GestionMasivaUsuarios/>}{activeTab===2&&puedeCalendario&&<GestionCalendario/>}</Box>;
};
export default RepositorioPage;
