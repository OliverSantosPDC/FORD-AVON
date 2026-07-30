import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography
} from '@mui/material';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined';
import CargarCarteraPage from '../CargarCartera';
import GestionCalendario from '../Calendario/GestionCalendario';
import { useAuth } from '../../context/AuthContext';
import { downloadBlob, exportRowsToExcel } from '../../utils/tableExport';
import {
  descargarPlantilla,
  validarImportacion,
  aplicarImportacion,
  type PreviewItem,
  type ResumenImport,
  type ResultadoAplicarItem
} from '../../services/usuariosService';

const ResumenChips = ({ r }: { r: ResumenImport }) => (
  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ my: 1.5 }}>
    <Chip label={`Total: ${r.total}`} />
    <Chip color="success" variant="outlined" label={`Válidas: ${r.validas}`} />
    <Chip color="error" variant="outlined" label={`Errores: ${r.errores}`} />
    <Chip variant="outlined" label={`Crear: ${r.creaciones}`} />
    <Chip variant="outlined" label={`Actualizar: ${r.actualizaciones}`} />
    <Chip variant="outlined" label={`Activar: ${r.activaciones}`} />
    <Chip variant="outlined" label={`Desactivar: ${r.desactivaciones}`} />
  </Stack>
);

const GestionMasivaUsuarios = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ items: PreviewItem[]; resumen: ResumenImport } | null>(null);
  const [result, setResult] = useState<{ resultados: ResultadoAplicarItem[]; resumen: ResumenImport } | null>(null);

  const reset = () => {
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const onSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
    reset();
  };

  const onPlantilla = async () => {
    setError(null);
    try {
      const blob = await descargarPlantilla();
      downloadBlob(blob, 'plantilla_usuarios.xlsx');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo descargar la plantilla.');
    }
  };

  const onValidar = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setPreview(await validarImportacion(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo validar el archivo.');
    } finally {
      setBusy(false);
    }
  };

  const onAplicar = async (soloValidas: boolean) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await aplicarImportacion(file, soloValidas);
      setResult(res);
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo procesar el archivo.');
    } finally {
      setBusy(false);
    }
  };

  const onDescargarReporte = () => {
    if (!result) return;
    const headers = ['FILA', 'ACCION', 'EMAIL', 'NOMBRE', 'APELLIDO', 'ROL', 'ESTADO', 'CONTRASEÑA_TEMPORAL', 'MENSAJE'];
    const rows = result.resultados.map((r) => [
      r.fila,
      r.accion,
      r.email,
      r.nombre ?? '',
      r.apellido ?? '',
      r.rol ?? '',
      r.resultado,
      r.password ?? '',
      r.mensaje
    ]);
    exportRowsToExcel('resultado_usuarios.xlsx', 'Resultado', headers, rows);
  };

  const hayPasswords = Boolean(result?.resultados.some((r) => r.password));

  const tieneErrores = (preview?.resumen.errores ?? 0) > 0;

  return (
    <Box sx={{ maxWidth: 980, mx: 'auto', py: 1 }}>
      <Typography sx={{ fontSize: 18, fontWeight: 700, mb: 0.5 }}>Gestión masiva de usuarios</Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
        Descarga la plantilla, complétala y súbela. Primero se valida (sin cambios) y luego confirmas la aplicación.
      </Typography>

      <Paper sx={{ p: 3, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={2}>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button variant="outlined" startIcon={<DownloadOutlinedIcon />} onClick={onPlantilla} sx={{ textTransform: 'none', borderRadius: 2 }}>
              Descargar plantilla
            </Button>
            <input ref={inputRef} type="file" accept=".xlsx" onChange={onSelect} style={{ display: 'none' }} />
            <Button variant="outlined" startIcon={<UploadFileOutlinedIcon />} onClick={() => inputRef.current?.click()} sx={{ textTransform: 'none', borderRadius: 2 }}>
              Seleccionar archivo
            </Button>
            <Typography sx={{ fontSize: 13, color: file ? 'text.primary' : 'text.secondary' }}>
              {file ? file.name : 'Ningún archivo seleccionado'}
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Button variant="contained" startIcon={<PlayArrowOutlinedIcon />} onClick={onValidar} disabled={!file || busy} sx={{ textTransform: 'none', borderRadius: 2 }}>
              {busy && !result ? <CircularProgress size={20} color="inherit" /> : 'Validar archivo'}
            </Button>
          </Box>

          {error && <Alert severity="error">{error}</Alert>}

          {preview && (
            <>
              <Divider />
              <Typography sx={{ fontWeight: 700 }}>Vista previa</Typography>
              <ResumenChips r={preview.resumen} />
              <TableContainer sx={{ maxHeight: 360 }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      {['Fila', 'Acción', 'Email', 'Rol', 'Estado', 'Mensaje'].map((h) => (
                        <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {preview.items.map((it) => (
                      <TableRow key={it.fila} hover>
                        <TableCell>{it.fila}</TableCell>
                        <TableCell>{it.accion}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{it.email}</TableCell>
                        <TableCell>{it.rol || '—'}</TableCell>
                        <TableCell>
                          <Chip size="small" label={it.estado} color={it.estado === 'VALIDO' ? 'success' : 'error'} variant="outlined" />
                        </TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{it.mensaje}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              <Stack direction="row" spacing={1.5} justifyContent="flex-end">
                <Button onClick={reset} sx={{ textTransform: 'none' }}>Cancelar</Button>
                {tieneErrores ? (
                  <Button variant="contained" color="warning" disabled={busy || preview.resumen.validas === 0} onClick={() => onAplicar(true)} sx={{ textTransform: 'none' }}>
                    Procesar solo válidas ({preview.resumen.validas})
                  </Button>
                ) : (
                  <Button variant="contained" disabled={busy || preview.resumen.validas === 0} onClick={() => onAplicar(false)} sx={{ textTransform: 'none' }}>
                    Aplicar cambios
                  </Button>
                )}
              </Stack>
            </>
          )}

          {result && (
            <>
              <Divider />
              <Alert severity="success">Proceso completado.</Alert>
              {hayPasswords && (
                <Alert severity="warning">
                  El archivo de resultados contiene contraseñas temporales. Descárgalo, guárdalo de forma segura y elimínalo tras compartir las credenciales.
                </Alert>
              )}
              <ResumenChips r={result.resumen} />
              <TableContainer sx={{ maxHeight: 320 }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      {['Fila', 'Acción', 'Email', 'Resultado', 'Mensaje'].map((h) => (
                        <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {result.resultados.map((r) => (
                      <TableRow key={r.fila} hover>
                        <TableCell>{r.fila}</TableCell>
                        <TableCell>{r.accion}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.email}</TableCell>
                        <TableCell>
                          <Chip size="small" label={r.resultado} color={r.resultado === 'OK' ? 'success' : 'error'} variant="outlined" />
                        </TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{r.mensaje}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <Stack direction="row" justifyContent="flex-end">
                <Button variant="outlined" startIcon={<DownloadOutlinedIcon />} onClick={onDescargarReporte} sx={{ textTransform: 'none' }}>
                  Descargar reporte
                </Button>
              </Stack>
            </>
          )}
        </Stack>
      </Paper>
    </Box>
  );
};

const RepositorioPage = () => {
  const { hasPermission } = useAuth();
  const puedeAdministrarUsuarios = hasPermission('usuarios.administrar_global');
  const puedeCalendario = hasPermission('calendario.crear');
  const [tab, setTab] = useState(0);

  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Cargar cartera" sx={{ textTransform: 'none' }} />
        {puedeAdministrarUsuarios && <Tab label="Gestión masiva de usuarios" sx={{ textTransform: 'none' }} />}
        {puedeCalendario && <Tab label="Gestión de calendario" sx={{ textTransform: 'none' }} />}
      </Tabs>

      {tab === 0 && <CargarCarteraPage />}
      {tab === 1 && puedeAdministrarUsuarios && <GestionMasivaUsuarios />}
      {tab === 2 && puedeCalendario && <GestionCalendario />}
    </Box>
  );
};

export default RepositorioPage;
