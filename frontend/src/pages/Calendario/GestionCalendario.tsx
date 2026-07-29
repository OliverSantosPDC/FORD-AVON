import { useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, Paper, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography
} from '@mui/material';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined';
import { downloadBlob, exportRowsToExcel } from '../../utils/tableExport';
import {
  descargarPlantillaCalendario, validarImportacionCalendario, aplicarImportacionCalendario,
  type CalPreviewItem, type CalResumen, type CalResultadoItem
} from '../../services/calendarService';

const Chips = ({ r }: { r: CalResumen }) => (
  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ my: 1.5 }}>
    <Chip label={`Total: ${r.total}`} />
    <Chip color="success" variant="outlined" label={`Válidas: ${r.validas}`} />
    <Chip color="error" variant="outlined" label={`Errores: ${r.errores}`} />
    <Chip variant="outlined" label={`Crear: ${r.creaciones}`} />
    <Chip variant="outlined" label={`Actualizar: ${r.actualizaciones}`} />
    <Chip variant="outlined" label={`Eliminar: ${r.eliminaciones}`} />
    <Chip variant="outlined" label={`Activar: ${r.activaciones}`} />
    <Chip variant="outlined" label={`Desactivar: ${r.desactivaciones}`} />
  </Stack>
);

const GestionCalendario = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ items: CalPreviewItem[]; resumen: CalResumen } | null>(null);
  const [result, setResult] = useState<{ resultados: CalResultadoItem[]; resumen: CalResumen } | null>(null);

  const reset = () => { setPreview(null); setResult(null); setError(null); };
  const onSelect = (e: React.ChangeEvent<HTMLInputElement>) => { setFile(e.target.files?.[0] ?? null); reset(); };

  const onPlantilla = async () => {
    try { downloadBlob(await descargarPlantillaCalendario(), 'plantilla_calendario.xlsx'); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo descargar la plantilla.'); }
  };
  const onValidar = async () => {
    if (!file) return; setBusy(true); setError(null); setResult(null);
    try { setPreview(await validarImportacionCalendario(file)); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo validar el archivo.'); }
    finally { setBusy(false); }
  };
  const onAplicar = async (soloValidas: boolean) => {
    if (!file) return; setBusy(true); setError(null);
    try { setResult(await aplicarImportacionCalendario(file, soloValidas)); setPreview(null); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo procesar el archivo.'); }
    finally { setBusy(false); }
  };
  const onReporte = () => {
    if (!result) return;
    const headers = ['FILA', 'ACCION', 'TITULO', 'RESULTADO', 'MENSAJE'];
    const rows = result.resultados.map((r) => [r.fila, r.accion, r.titulo, r.resultado, r.mensaje]);
    exportRowsToExcel('resultado_calendario.xlsx', 'Resultado', headers, rows);
  };
  const tieneErrores = (preview?.resumen.errores ?? 0) > 0;

  return (
    <Box sx={{ maxWidth: 980, mx: 'auto', py: 1 }}>
      <Typography sx={{ fontSize: 18, fontWeight: 700, mb: 0.5 }}>Gestión de calendario</Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
        Descarga la plantilla, complétala y súbela. Se valida sin cambios y luego confirmas la aplicación.
      </Typography>
      <Paper sx={{ p: 3, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={2}>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button variant="outlined" startIcon={<DownloadOutlinedIcon />} onClick={onPlantilla} sx={{ textTransform: 'none', borderRadius: 2 }}>Descargar plantilla</Button>
            <input ref={inputRef} type="file" accept=".xlsx" onChange={onSelect} style={{ display: 'none' }} />
            <Button variant="outlined" startIcon={<UploadFileOutlinedIcon />} onClick={() => inputRef.current?.click()} sx={{ textTransform: 'none', borderRadius: 2 }}>Seleccionar archivo</Button>
            <Typography sx={{ fontSize: 13, color: file ? 'text.primary' : 'text.secondary' }}>{file ? file.name : 'Ningún archivo seleccionado'}</Typography>
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
              <Chips r={preview.resumen} />
              <TableContainer sx={{ maxHeight: 340 }}>
                <Table stickyHeader size="small">
                  <TableHead><TableRow>{['Fila', 'Acción', 'Título', 'Estado', 'Mensaje'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
                  <TableBody>
                    {preview.items.map((it) => (
                      <TableRow key={it.fila} hover>
                        <TableCell>{it.fila}</TableCell><TableCell>{it.accion}</TableCell><TableCell>{it.titulo}</TableCell>
                        <TableCell><Chip size="small" label={it.estado} color={it.estado === 'VALIDO' ? 'success' : 'error'} variant="outlined" /></TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{it.mensaje}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <Stack direction="row" spacing={1.5} justifyContent="flex-end">
                <Button onClick={reset} sx={{ textTransform: 'none' }}>Cancelar</Button>
                {tieneErrores ? (
                  <Button variant="contained" color="warning" disabled={busy || preview.resumen.validas === 0} onClick={() => onAplicar(true)} sx={{ textTransform: 'none' }}>Procesar solo válidas ({preview.resumen.validas})</Button>
                ) : (
                  <Button variant="contained" disabled={busy || preview.resumen.validas === 0} onClick={() => onAplicar(false)} sx={{ textTransform: 'none' }}>Aplicar cambios</Button>
                )}
              </Stack>
            </>
          )}

          {result && (
            <>
              <Divider />
              <Alert severity="success">Proceso completado.</Alert>
              <Chips r={result.resumen} />
              <TableContainer sx={{ maxHeight: 320 }}>
                <Table stickyHeader size="small">
                  <TableHead><TableRow>{['Fila', 'Acción', 'Título', 'Resultado', 'Mensaje'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
                  <TableBody>
                    {result.resultados.map((r) => (
                      <TableRow key={r.fila} hover>
                        <TableCell>{r.fila}</TableCell><TableCell>{r.accion}</TableCell><TableCell>{r.titulo}</TableCell>
                        <TableCell><Chip size="small" label={r.resultado} color={r.resultado === 'OK' ? 'success' : 'error'} variant="outlined" /></TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{r.mensaje}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <Stack direction="row" justifyContent="flex-end">
                <Button variant="outlined" startIcon={<DownloadOutlinedIcon />} onClick={onReporte} sx={{ textTransform: 'none' }}>Descargar reporte</Button>
              </Stack>
            </>
          )}
        </Stack>
      </Paper>
    </Box>
  );
};

export default GestionCalendario;
