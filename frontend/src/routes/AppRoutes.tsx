import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import RootLayout from '../layouts/RootLayout';
import LoginPage from '../pages/Login';
import ForgotPasswordPage from '../pages/ForgotPassword';
import ResetPasswordPage from '../pages/ResetPassword';
import PlaceholderPage from '../pages/PlaceholderPage';
import { ProtectedRoute, PermissionRoute } from '../components/ProtectedRoute';

// Code splitting: páginas autenticadas pesadas se cargan bajo demanda (React.lazy).
// Reduce el bundle inicial sin alterar rutas, permisos ni layout.
const DashboardPage = lazy(() => import('../pages/Dashboard'));
const InteligenciaPage = lazy(() => import('../pages/Inteligencia'));
const RepositorioPage = lazy(() => import('../pages/Repositorio'));
const UsuariosPage = lazy(() => import('../pages/Usuarios'));
const CalendarioPage = lazy(() => import('../pages/Calendario'));
const InformacionPage = lazy(() => import('../pages/Informacion'));
const GestionPage = lazy(() => import('../pages/Gestion'));
const ConfiguracionPage = lazy(() => import('../pages/Configuracion'));
const ControlOperativoPage = lazy(() => import('../pages/ControlOperativo'));
const AsignacionPage = lazy(() => import('../pages/Asignacion'));

const PageLoader = () => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 1.5 }}>
    <CircularProgress size={26} />
  </Box>
);

/**
 * Rutas de la aplicación — arquitectura de 9 módulos (fuente: config/modules.tsx).
 * - /login es pública.
 * - Todo lo demás vive bajo ProtectedRoute (exige sesión) + RootLayout.
 * - Cada módulo se envuelve en PermissionRoute con su permiso `modulo.*`.
 * Reutilización (sin páginas nuevas ni módulos duplicados):
 *  - Información  → CarteraPage (pages/Cartera/index.tsx)
 *  - Repositorio  → CargarCarteraPage (pages/CargarCartera/index.tsx)
 *  - Módulos sin implementación → PlaceholderPage
 * El backend sigue siendo la autoridad de permisos y scope.
 */
const AppRoutes = () => (
  <Suspense fallback={<PageLoader />}>
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />

    <Route element={<ProtectedRoute />}>
      <Route path="/" element={<RootLayout />}>
        <Route index element={<Navigate replace to="dashboard" />} />

        <Route element={<PermissionRoute permission="modulo.dashboard" />}>
          <Route path="dashboard" element={<DashboardPage />} />
        </Route>

        <Route element={<PermissionRoute permission="modulo.centro_inteligencia" />}>
          <Route path="inteligencia" element={<InteligenciaPage />} />
        </Route>

        <Route element={<PermissionRoute permission="modulo.calendario" />}>
          <Route path="calendario" element={<CalendarioPage />} />
        </Route>

        <Route element={<PermissionRoute permission="control_operativo.ver" />}>
          <Route path="control-operativo" element={<ControlOperativoPage />} />
        </Route>

        <Route element={<PermissionRoute permission="control_operativo.asignacion.ver" />}>
          <Route path="asignacion" element={<AsignacionPage />} />
        </Route>

        <Route element={<PermissionRoute permission="modulo.gestion" />}>
          <Route path="gestion" element={<GestionPage />} />
        </Route>

        <Route element={<PermissionRoute permission="modulo.repositorio" />}>
          <Route path="repositorio" element={<RepositorioPage />} />
        </Route>

        <Route element={<PermissionRoute permission="modulo.usuarios" />}>
          <Route path="usuarios" element={<UsuariosPage />} />
        </Route>

        <Route element={<PermissionRoute permission="configuracion.ver" />}>
          <Route path="configuracion" element={<ConfiguracionPage />} />
        </Route>

        <Route element={<PermissionRoute permission="modulo.informacion" />}>
          <Route path="informacion" element={<InformacionPage />} />
        </Route>

        <Route path="*" element={<Navigate replace to="dashboard" />} />
      </Route>
    </Route>
  </Routes>
  </Suspense>
);

export default AppRoutes;
