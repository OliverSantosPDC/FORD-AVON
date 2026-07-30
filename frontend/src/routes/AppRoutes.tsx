import { Navigate, Route, Routes } from 'react-router-dom';
import RootLayout from '../layouts/RootLayout';
import LoginPage from '../pages/Login';
import ForgotPasswordPage from '../pages/ForgotPassword';
import ResetPasswordPage from '../pages/ResetPassword';
import DashboardPage from '../pages/Dashboard';
import InteligenciaPage from '../pages/Inteligencia';
import RepositorioPage from '../pages/Repositorio';
import UsuariosPage from '../pages/Usuarios';
import CalendarioPage from '../pages/Calendario';
import InformacionPage from '../pages/Informacion';
import GestionPage from '../pages/Gestion';
import ConfiguracionPage from '../pages/Configuracion';
import ControlOperativoPage from '../pages/ControlOperativo';
import PlaceholderPage from '../pages/PlaceholderPage';
import { ProtectedRoute, PermissionRoute } from '../components/ProtectedRoute';

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
);

export default AppRoutes;
