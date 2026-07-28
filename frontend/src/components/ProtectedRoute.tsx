import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { Box, CircularProgress, Paper, Typography } from '@mui/material';
import BlockIcon from '@mui/icons-material/Block';
import { useAuth } from '../context/AuthContext';

const FullScreenLoader = () => (
  <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
    <CircularProgress />
  </Box>
);

/** Exige sesión válida; redirige a /login si no hay usuario autenticado. */
export const ProtectedRoute = ({ children }: { children?: ReactNode }) => {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children ?? <Outlet />}</>;
};

/** Página de acceso no autorizado (permiso insuficiente). */
export const AccesoNoAutorizado = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
    <Paper sx={{ p: 5, maxWidth: 520, textAlign: 'center', borderRadius: 3 }}>
      <BlockIcon sx={{ fontSize: 40, color: '#EF4444', mb: 1 }} />
      <Typography variant="h6" fontWeight={700} gutterBottom>Acceso no autorizado</Typography>
      <Typography color="text.secondary">Tu rol no tiene permiso para acceder a este módulo.</Typography>
    </Paper>
  </Box>
);

/** Exige un permiso concreto para renderizar el módulo. */
export const PermissionRoute = ({ permission, children }: { permission: string; children?: ReactNode }) => {
  const { hasPermission, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!hasPermission(permission)) return <AccesoNoAutorizado />;
  return <>{children ?? <Outlet />}</>;
};
