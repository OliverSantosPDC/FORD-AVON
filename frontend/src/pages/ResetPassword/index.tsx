import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Paper, TextField, Typography } from '@mui/material';
import LockResetIcon from '@mui/icons-material/LockReset';
import { authService } from '../../services/authService';

const ResetPasswordPage = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setLoading(true);
    try {
      const { error: err } = await authService.updatePassword(password);
      if (err) {
        setError('No se pudo actualizar la contraseña. El enlace pudo expirar; solicita uno nuevo.');
        return;
      }
      setDone(true);
    } catch {
      setError('No se pudo actualizar la contraseña. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2, background: 'linear-gradient(135deg, #0F172A 0%, #1E3A8A 100%)' }}>
      <Paper sx={{ p: { xs: 3, sm: 4 }, width: '100%', maxWidth: 400, borderRadius: 3, boxShadow: '0 24px 70px rgba(0,0,0,0.4)' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
          <Box sx={{ width: 48, height: 48, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: 'rgba(230,0,126,0.12)', color: '#E6007E', mb: 1.5 }}>
            <LockResetIcon />
          </Box>
          <Typography sx={{ fontSize: 20, fontWeight: 800 }}>Nueva contraseña</Typography>
        </Box>

        {done ? (
          <>
            <Alert severity="success">Contraseña actualizada correctamente.</Alert>
            <Button onClick={() => navigate('/login', { replace: true })} variant="contained" fullWidth sx={{ mt: 2, textTransform: 'none' }}>
              Iniciar sesión
            </Button>
          </>
        ) : (
          <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField label="Nueva contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" size="small" fullWidth />
            <TextField label="Confirmar nueva contraseña" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" size="small" fullWidth />
            {error && <Alert severity="error" sx={{ py: 0.5 }}>{error}</Alert>}
            <Button type="submit" variant="contained" disabled={loading} sx={{ mt: 1, borderRadius: 2, textTransform: 'none', fontWeight: 700, py: 1 }}>
              {loading ? <CircularProgress size={22} color="inherit" /> : 'Actualizar contraseña'}
            </Button>
            <Button component={RouterLink} to="/login" sx={{ textTransform: 'none' }}>Volver a iniciar sesión</Button>
          </Box>
        )}
      </Paper>
    </Box>
  );
};

export default ResetPasswordPage;
