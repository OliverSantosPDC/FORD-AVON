import { useRef, useState } from 'react';
import { Alert, Box, Button, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import { uploadCartera, type UploadProgress } from '../../services/uploadService';

const isBusy = (phase?: UploadProgress['phase']) =>
  phase === 'preparing' || phase === 'uploading' || phase === 'stored' || phase === 'processing';

const CargarCarteraPage = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const busy = isBusy(progress?.phase);

  const handleSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setProgress(null);
    setErrorMsg('');
  };

  const handleUpload = async () => {
    if (!file) return;
    setErrorMsg('');
    setProgress({ phase: 'preparing', progress: 0, message: 'Preparando archivo...' });
    try {
      await uploadCartera(file, (p) => setProgress(p));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error de carga.';
      setErrorMsg(message);
      setProgress({ phase: 'error', progress: 0, message: 'Error de carga' });
    }
  };

  const pct = progress?.progress ?? 0;
  const showBar = busy || progress?.phase === 'completed';

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', py: 2 }}>
      <Typography sx={{ fontSize: 20, fontWeight: 700, mb: 0.5 }}>Administración · Gestión de Cartera</Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
        Selecciona un archivo Excel (.xlsx). Se sube directo a Supabase Storage y luego se procesa para actualizar la cartera.
      </Typography>

      <Paper sx={{ p: 3, borderRadius: 2.5, border: '1px solid', borderColor: 'divider', boxShadow: '0 10px 26px rgba(15, 23, 42, 0.06)' }}>
        <Stack spacing={2}>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleSelect}
            style={{ display: 'none' }}
          />

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              startIcon={<UploadFileOutlinedIcon />}
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              sx={{ borderRadius: 2, textTransform: 'none' }}
            >
              Seleccionar archivo
            </Button>
            <Typography sx={{ fontSize: 13, color: file ? 'text.primary' : 'text.secondary' }}>
              {file ? `${file.name} · ${(file.size / (1024 * 1024)).toFixed(2)} MB` : 'Ningún archivo seleccionado'}
            </Typography>
          </Box>

          <Box>
            <Button
              variant="contained"
              startIcon={<CloudUploadOutlinedIcon />}
              onClick={handleUpload}
              disabled={!file || busy}
              sx={{ borderRadius: 2, textTransform: 'none' }}
            >
              {busy ? 'Procesando...' : 'Subir archivo'}
            </Button>
          </Box>

          {showBar && (
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{progress?.message}</Typography>
                <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
                  {progress?.indeterminate ? '' : `${pct}%`}
                </Typography>
              </Box>
              <LinearProgress
                variant={progress?.indeterminate ? 'indeterminate' : 'determinate'}
                value={pct}
                sx={{ height: 10, borderRadius: 999 }}
                color={progress?.phase === 'completed' ? 'success' : 'primary'}
              />
            </Box>
          )}

          {progress && (
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              Estado: <strong>{progress.phase === 'error' ? 'Error de carga' : progress.message}</strong>
            </Typography>
          )}

          {progress?.phase === 'completed' && (
            <Alert severity="success">Carga completada correctamente.</Alert>
          )}

          {progress?.phase === 'error' && <Alert severity="error">{errorMsg}</Alert>}
        </Stack>
      </Paper>
    </Box>
  );
};

export default CargarCarteraPage;
