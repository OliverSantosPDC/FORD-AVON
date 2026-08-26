import { Box, Button, CircularProgress, Typography } from '@mui/material';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ReplayIcon from '@mui/icons-material/Replay';
import { useI18n } from '../../i18n/LanguageProvider';

/** Cargando (bloque). Consistente para tablas/secciones. */
export const SectionLoader = ({ label }: { label?: string }) => {
  const { t } = useI18n();
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 4 }}>
      <CircularProgress size={22} />
      <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>{label ?? t('common.loading')}</Typography>
    </Box>
  );
};

/** Estado vacío reutilizable con acción opcional. */
export const EmptyState = ({ title, description, action }: { title?: string; description?: string; action?: React.ReactNode }) => {
  const { t } = useI18n();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, py: 5, color: 'text.secondary', textAlign: 'center' }}>
      <InboxOutlinedIcon sx={{ fontSize: 40, opacity: 0.5 }} />
      <Typography sx={{ fontWeight: 600 }}>{title ?? t('empty.default')}</Typography>
      {description && <Typography sx={{ fontSize: 13 }}>{description}</Typography>}
      {action}
    </Box>
  );
};

/** Estado de error reutilizable con reintento opcional (no expone detalles internos). */
export const ErrorState = ({ message, onRetry }: { message?: string; onRetry?: () => void }) => {
  const { t } = useI18n();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.25, py: 5, textAlign: 'center' }}>
      <ErrorOutlineIcon color="error" sx={{ fontSize: 40 }} />
      <Typography sx={{ fontWeight: 600 }}>{message ?? t('error.loadFailed')}</Typography>
      {onRetry && (
        <Button size="small" variant="outlined" startIcon={<ReplayIcon />} onClick={onRetry} sx={{ textTransform: 'none' }}>
          {t('common.retry')}
        </Button>
      )}
    </Box>
  );
};
