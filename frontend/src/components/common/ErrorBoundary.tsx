import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ReplayIcon from '@mui/icons-material/Replay';
import { useI18n } from '../../i18n/LanguageProvider';

/** UI de respaldo (funcional para poder usar i18n). No expone detalles internos al usuario. */
const ErrorFallback = ({ onRetry }: { onRetry: () => void }) => {
  const { t } = useI18n();
  return (
    <Box sx={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
      <Stack spacing={1.5} alignItems="center" sx={{ textAlign: 'center', maxWidth: 420 }}>
        <ErrorOutlineIcon color="error" sx={{ fontSize: 48 }} />
        <Typography sx={{ fontSize: 18, fontWeight: 800 }}>{t('error.boundaryTitle')}</Typography>
        <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>{t('error.boundaryBody')}</Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="contained" startIcon={<ReplayIcon />} onClick={onRetry} sx={{ textTransform: 'none' }}>{t('common.retry')}</Button>
          <Button variant="outlined" onClick={() => window.location.reload()} sx={{ textTransform: 'none' }}>{t('common.reload')}</Button>
        </Stack>
      </Stack>
    </Box>
  );
};

interface Props { children: ReactNode; }
interface State { hasError: boolean; }

/**
 * Error Boundary global. Evita que un error de render (o un fallo de carga de una
 * página lazy) derribe toda la aplicación. Registra el detalle técnico en consola;
 * la interfaz muestra un mensaje comprensible con opción de reintentar/recargar.
 */
class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logging técnico (no visible al usuario). Reutiliza console; sin sistema externo.
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return <ErrorFallback onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
