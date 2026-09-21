import { useState } from 'react';
import { Alert, Box, Button, CircularProgress, IconButton, InputAdornment, TextField, Typography } from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import { authService } from '../../services/authService';
import { confirmarPasswordCambiada } from '../../services/usuariosService';

/** Misma contraseña temporal fija que asigna Usuarios > Restablecer contraseña
 *  (backend/src/utils/password.ts: PASSWORD_TEMPORAL_ADMINISTRATIVA). La nueva
 *  contraseña del usuario nunca puede ser este valor. */
const PASSWORD_TEMPORAL = 'Avon2026';
const MIN_PASSWORD_LEN = 8;

interface Props {
  email: string;
  /** Se llama tras confirmar el cambio en Supabase Auth Y limpiar el estado temporal en el backend. */
  onSuccess: () => void | Promise<void>;
}

/**
 * Formulario de "Contraseña actual / Nueva / Confirmar", reutilizado tanto
 * en Login (justo tras autenticar con la temporal) como en RootLayout
 * (sesión ya abierta, advertencia o vencimiento). Reutiliza el ÚNICO
 * mecanismo de cambio de contraseña que ya existe en el proyecto
 * (authService.login/updatePassword, los mismos que Login y ResetPassword
 * usan) — no crea una segunda arquitectura de autenticación. Re-verificar la
 * "contraseña actual" vía un nuevo signInWithPassword evita que una sesión
 * dejada abierta permita cambiar la contraseña sin conocerla.
 */
const TemporaryPasswordChangeForm = ({ email, onSuccess }: Props) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!current) { setError('Ingresa tu contraseña actual.'); return; }
    if (next.length < MIN_PASSWORD_LEN) { setError(`La nueva contraseña debe tener al menos ${MIN_PASSWORD_LEN} caracteres.`); return; }
    if (next === PASSWORD_TEMPORAL) { setError('La nueva contraseña no puede ser la contraseña temporal.'); return; }
    if (next !== confirm) { setError('Las contraseñas no coinciden.'); return; }

    setBusy(true);
    try {
      const { error: verifyError } = await authService.login(email, current);
      if (verifyError) { setError('La contraseña actual no es correcta.'); return; }

      const { error: updateError } = await authService.updatePassword(next);
      if (updateError) { setError('No se pudo actualizar la contraseña. Intenta de nuevo.'); return; }

      await confirmarPasswordCambiada();
      await onSuccess();
    } catch {
      setError('No se pudo cambiar la contraseña. Intenta de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField
        label="Contraseña actual" type={showPasswords ? 'text' : 'password'} value={current}
        onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" size="small" fullWidth
      />
      <TextField
        label="Nueva contraseña" type={showPasswords ? 'text' : 'password'} value={next}
        onChange={(e) => setNext(e.target.value)} required autoComplete="new-password" size="small" fullWidth
        helperText={`Mínimo ${MIN_PASSWORD_LEN} caracteres. No puede ser la contraseña temporal.`}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <IconButton size="small" onClick={() => setShowPasswords((v) => !v)} edge="end" aria-label="mostrar u ocultar contraseñas">
                {showPasswords ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
              </IconButton>
            </InputAdornment>
          )
        }}
      />
      <TextField
        label="Confirmar nueva contraseña" type={showPasswords ? 'text' : 'password'} value={confirm}
        onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" size="small" fullWidth
        error={Boolean(confirm) && next !== confirm}
        helperText={Boolean(confirm) && next !== confirm ? 'No coincide.' : ' '}
      />
      {error && <Alert severity="error" sx={{ py: 0.5 }}>{error}</Alert>}
      <Button type="submit" variant="contained" disabled={busy} sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700, py: 1 }}>
        {busy ? <CircularProgress size={22} color="inherit" /> : 'Cambiar contraseña'}
      </Button>
      <Typography sx={{ fontSize: 11, color: 'text.secondary', textAlign: 'center' }}>
        Al cambiarla, dejará de ser temporal y esta advertencia desaparecerá.
      </Typography>
    </Box>
  );
};

export default TemporaryPasswordChangeForm;
