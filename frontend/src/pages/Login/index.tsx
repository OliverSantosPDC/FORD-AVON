import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  Link,
  Paper,
  TextField,
  Typography
} from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useAuth } from '../../context/AuthContext';

const LoginPage = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { error: loginError } = await login(email.trim(), password);
      if (loginError) {
        setError('Correo o contraseña incorrectos, o el usuario está inactivo.');
        return;
      }
      navigate('/dashboard', { replace: true });
    } catch {
      setError('No se pudo iniciar sesión. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
        background: 'linear-gradient(135deg, #0F172A 0%, #1E3A8A 100%)'
      }}
    >
      <Paper sx={{ p: { xs: 3, sm: 4 }, width: '100%', maxWidth: 400, borderRadius: 3, boxShadow: '0 24px 70px rgba(0,0,0,0.4)' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
          <Box sx={{ width: 48, height: 48, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: 'rgba(230,0,126,0.12)', color: '#E6007E', mb: 1.5 }}>
            <LockOutlinedIcon />
          </Box>
          <Typography sx={{ fontSize: 22, fontWeight: 800, letterSpacing: 0.5 }}>FORD-AVON</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Plataforma de gestión de cobranza</Typography>
        </Box>

        <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Correo electrónico"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            size="small"
            fullWidth
          />
          <TextField
            label="Contraseña"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            size="small"
            fullWidth
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={() => setShowPassword((v) => !v)} edge="end" size="small" aria-label="mostrar u ocultar contraseña">
                    {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                  </IconButton>
                </InputAdornment>
              )
            }}
          />

          {error && <Alert severity="error" sx={{ py: 0.5 }}>{error}</Alert>}

          <Button
            type="submit"
            variant="contained"
            disabled={loading}
            sx={{ mt: 1, borderRadius: 2, textTransform: 'none', fontWeight: 700, py: 1 }}
          >
            {loading ? <CircularProgress size={22} color="inherit" /> : 'Iniciar sesión'}
          </Button>

          <Link component={RouterLink} to="/forgot-password" underline="hover" sx={{ fontSize: 13, textAlign: 'center', mt: 0.5 }}>
            ¿Olvidaste tu contraseña?
          </Link>
        </Box>
      </Paper>
    </Box>
  );
};

export default LoginPage;
