import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import type { ExportSnapshot } from '../../utils/exportDashboardPdf';
import { renderSnapshotToPdf } from '../../utils/exportDashboardPdf';

interface OnePagePreviewDialogProps {
  open: boolean;
  snapshot: ExportSnapshot | null;
  onClose: () => void;
}

/**
 * Vista previa de OnePage: muestra el MISMO clon de exportación (`snapshot.container`)
 * que luego se usa para generar el PDF, dentro de un contenedor con scroll. No es una
 * maqueta ni un resumen: es el Dashboard real (filtros, moneda, gráficos y tablas ya
 * expandidas) insertado tal cual como nodo DOM.
 */
const OnePagePreviewDialog = ({ open, snapshot, onClose }: OnePagePreviewDialogProps) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !snapshot) return;
    mount.appendChild(snapshot.container);
    return () => {
      if (snapshot.container.parentNode === mount) mount.removeChild(snapshot.container);
    };
  }, [snapshot]);

  const handleGenerarPdf = async () => {
    if (!snapshot || generando) return;
    setGenerando(true);
    setError(null);
    try {
      await renderSnapshotToPdf(snapshot);
    } catch {
      setError('No se pudo generar el PDF. Intenta nuevamente.');
    } finally {
      setGenerando(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth PaperProps={{ sx: { height: '92vh' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 800 }}>
        Vista previa de OnePage
        <IconButton onClick={onClose} size="small"><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ bgcolor: 'action.hover', p: 2 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {!snapshot ? (
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Preparando vista previa...</Typography>
        ) : (
          <Box sx={{ overflow: 'auto', height: '100%', bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            <Box sx={{ p: 2 }} ref={mountRef} />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cerrar</Button>
        <Button
          variant="contained"
          startIcon={<PictureAsPdfOutlinedIcon />}
          onClick={handleGenerarPdf}
          disabled={!snapshot || generando}
          sx={{ textTransform: 'none' }}
        >
          {generando ? 'Generando PDF...' : 'Generar PDF'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default OnePagePreviewDialog;
