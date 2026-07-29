import { Navigate, Route, Routes } from 'react-router-dom';
import RootLayout from '../layouts/RootLayout';
import LoginPage from '../pages/Login';
import DashboardPage from '../pages/Dashboard';
import InteligenciaPage from '../pages/Inteligencia';
import CarteraPage from '../pages/Cartera';
import RepositorioPage from '../pages/Repositorio';
import UsuariosPage from '../pages/Usuarios';
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
          <Route path="calendario" element={<PlaceholderPage title="Calendario" />} />
        </Route>

        <Route element={<PermissionRoute permission="modulo.control_operativo" />}>
          <Route path="control-operativo" element={<PlaceholderPage title="Control Operativo" />} />
        </Route>

        <Route element={<PermissionRoute permission="modulo.gestion" />}>
          <Route path="gestion" element={<PlaceholderPage title="Gestión" />} />
        </Route>

        <Route element={<PermissionRoute permission="modulo.repositorio" />}>
          <Route path="repositorio" element={<RepositorioPage />} />
        </Route>

        <Route element={<PermissionRoute permission="modulo.usuarios" />}>
          <Route path="usuarios" element={<UsuariosPage />} />
        </Route>

        <Route element={<PermissionRoute permission="modulo.configuracion" />}>
          <Route path="configuracion" element={<PlaceholderPage title="Configuración" />} />
        </Route>

        <Route element={<PermissionRoute permission="modulo.informacion" />}>
          <Route path="informacion" element={<CarteraPage />} />
        </Route>

        <Route path="*" element={<Navigate replace to="dashboard" />} />
      </Route>
    </Route>
  </Routes>
);

export default AppRoutes;
