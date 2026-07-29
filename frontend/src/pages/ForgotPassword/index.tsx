import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Link, Paper, TextField, Typography } from '@mui/material';
import LockResetIcon from '@mui/icons-material/LockReset';
import { authService } from '../../services/authService';

const ForgotPasswordPage = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { error: err } = await authService.resetPasswordForEmail(email);
      if (err) {
        setError('No se pudo enviar el correo. Verifica la dirección e intenta de nuevo.');
        return;
      }
      setSent(true);
    } catch {
      setError('No se pudo enviar el correo. Intenta de nuevo.');
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
          <Typography sx={{ fontSize: 20, fontWeight: 800 }}>Recuperar contraseña</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', textAlign: 'center', mt: 0.5 }}>
            Ingresa tu correo electrónico y te enviaremos instrucciones para restablecer tu contraseña.
          </Typography>
        </Box>

        {sent ? (
          <>
            <Alert severity="success">Si el correo existe, recibirás instrucciones para restablecer tu contraseña.</Alert>
            <Button component={RouterLink} to="/login" fullWidth sx={{ mt: 2, textTransform: 'none' }}>Volver a iniciar sesión</Button>
          </>
        ) : (
          <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField label="Correo electrónico" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" size="small" fullWidth />
            {error && <Alert severity="error" sx={{ py: 0.5 }}>{error}</Alert>}
            <Button type="submit" variant="contained" disabled={loading} sx={{ mt: 1, borderRadius: 2, textTransform: 'none', fontWeight: 700, py: 1 }}>
              {loading ? <CircularProgress size={22} color="inherit" /> : 'Enviar instrucciones'}
            </Button>
            <Link component={RouterLink} to="/login" underline="hover" sx={{ fontSize: 13, textAlign: 'center' }}>Volver a iniciar sesión</Link>
          </Box>
        )}
      </Paper>
    </Box>
  );
};

export default ForgotPasswordPage;
