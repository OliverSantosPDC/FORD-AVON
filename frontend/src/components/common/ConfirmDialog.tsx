import { Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { useI18n } from '../../i18n/LanguageProvider';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Diálogo de confirmación reutilizable para acciones sensibles/destructivas.
 * Previene doble click con `loading` (deshabilita el botón mientras se ejecuta).
 */
const ConfirmDialog = ({ open, title, description, confirmLabel, cancelLabel, destructive, loading, onConfirm, onCancel }: ConfirmDialogProps) => {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={loading ? undefined : onCancel} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{title}</DialogTitle>
      {description && <DialogContent><Typography sx={{ fontSize: 14 }}>{description}</Typography></DialogContent>}
      <DialogActions>
        <Button onClick={onCancel} disabled={loading} sx={{ textTransform: 'none' }}>{cancelLabel ?? t('common.cancel')}</Button>
        <Button variant="contained" color={destructive ? 'error' : 'primary'} onClick={onConfirm} disabled={loading} sx={{ textTransform: 'none' }}>
          {loading ? <CircularProgress size={18} color="inherit" /> : (confirmLabel ?? t('common.confirm'))}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ConfirmDialog;
