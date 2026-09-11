import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import type { ExportSnapshot } from '../../utils/exportDashboardPdf';
import { createExportSnapshot, renderSnapshotToPdf } from '../../utils/exportDashboardPdf';

interface OnePagePreviewDialogProps {
  open: boolean;
  onClose: () => void;
  /** Devuelve el elemento raíz del Dashboard real en el momento de abrir el preview
   *  (no antes): así cada apertura fotografía el estado/filtros/moneda vigentes. */
  getRoot: () => HTMLElement | null;
}

/**
 * Vista previa de OnePage. El diálogo se abre de inmediato al cambiar `open` a true
 * (no espera nada): la preparación del snapshot (clonar, expandir scroll, convertir
 * SVG a imagen) ocurre DESPUÉS, dentro de este componente, mientras el diálogo ya
 * está visible mostrando "Preparando vista previa...". Si la preparación falla, el
 * diálogo permanece abierto y muestra el error real (nunca se cierra solo ni se
 * descarga nada). El PDF se genera únicamente al pulsar "Generar PDF", a partir del
 * mismo snapshot ya mostrado aquí.
 */
const OnePagePreviewDialog = ({ open, onClose, getRoot }: OnePagePreviewDialogProps) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [snapshot, setSnapshot] = useState<ExportSnapshot | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [generandoPdf, setGenerandoPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSnapshot(null);
    setPrepError(null);
    setPdfError(null);

    const root = getRoot();
    if (!root) {
      setPrepError('No se encontró el contenido del Dashboard para generar la vista previa.');
      return;
    }

    let cancelled = false;
    createExportSnapshot(root)
      .then((snap) => {
        if (cancelled) return;
        setSnapshot(snap);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPrepError(e instanceof Error ? e.message : 'No se pudo preparar la vista previa de OnePage.');
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !snapshot) return;
    mount.appendChild(snapshot.container);
    return () => {
      if (snapshot.container.parentNode === mount) mount.removeChild(snapshot.container);
    };
  }, [snapshot]);

  const handleGenerarPdf = async () => {
    if (!snapshot || generandoPdf) return;
    setGenerandoPdf(true);
    setPdfError(null);
    try {
      await renderSnapshotToPdf(snapshot);
    } catch {
      setPdfError('No se pudo generar el PDF. Intenta nuevamente.');
    } finally {
      setGenerandoPdf(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth PaperProps={{ sx: { height: '92vh' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 800 }}>
        Vista previa de OnePage
        <IconButton onClick={onClose} size="small"><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ bgcolor: 'action.hover', p: 2 }}>
        {pdfError && <Alert severity="error" sx={{ mb: 2 }}>{pdfError}</Alert>}
        {prepError ? (
          <Alert severity="error">{prepError}</Alert>
        ) : !snapshot ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 2 }}>
            <CircularProgress size={18} />
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Preparando vista previa...</Typography>
          </Box>
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
          disabled={!snapshot || generandoPdf}
          sx={{ textTransform: 'none' }}
        >
          {generandoPdf ? 'Generando PDF...' : 'Generar PDF'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default OnePagePreviewDialog;
