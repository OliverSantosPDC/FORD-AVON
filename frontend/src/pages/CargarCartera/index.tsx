import { useRef, useState } from 'react';
import { Box, Button, Paper, Stack, Typography, Alert } from '@mui/material';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import { uploadCartera, type UploadCarteraResponse } from '../../services/uploadService';

type Status = 'idle' | 'uploading' | 'success' | 'error';

const STATUS_TEXT: Record<Status, string> = {
  idle: 'Esperando archivo',
  uploading: 'Subiendo...',
  success: 'Carga exitosa',
  error: 'Error de carga'
};

const CargarCarteraPage = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<UploadCarteraResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const handleSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setStatus('idle');
    setResult(null);
    setErrorMsg('');
  };

  const handleUpload = async () => {
    if (!file) return;
    setStatus('uploading');
    setErrorMsg('');
    setResult(null);
    try {
      const response = await uploadCartera(file);
      setResult(response);
      setStatus('success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error de carga.');
      setStatus('error');
    }
  };

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', py: 2 }}>
      <Typography sx={{ fontSize: 20, fontWeight: 700, mb: 0.5 }}>Administración · Cargar cartera</Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
        Selecciona un archivo Excel (.xlsx) y envíalo al servidor. Por ahora solo se verifica la recepción; no se actualiza la cartera.
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
              sx={{ borderRadius: 2, textTransform: 'none' }}
            >
              Seleccionar archivo
            </Button>
            <Typography sx={{ fontSize: 13, color: file ? 'text.primary' : 'text.secondary' }}>
              {file ? file.name : 'Ningún archivo seleccionado'}
            </Typography>
          </Box>

          <Box>
            <Button
              variant="contained"
              startIcon={<CloudUploadOutlinedIcon />}
              onClick={handleUpload}
              disabled={!file || status === 'uploading'}
              sx={{ borderRadius: 2, textTransform: 'none' }}
            >
              {status === 'uploading' ? 'Subiendo...' : 'Subir archivo'}
            </Button>
          </Box>

          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            Estado: <strong>{STATUS_TEXT[status]}</strong>
          </Typography>

          {status === 'success' && result && (
            <Alert severity="success">
              {result.message}
              <br />
              Archivo: <strong>{result.filename}</strong> · Tamaño: <strong>{((result.size ?? 0) / 1024).toFixed(1)} KB</strong>
            </Alert>
          )}

          {status === 'error' && <Alert severity="error">{errorMsg}</Alert>}
        </Stack>
      </Paper>
    </Box>
  );
};

export default CargarCarteraPage;
