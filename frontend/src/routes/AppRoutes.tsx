import { Navigate, Route, Routes } from 'react-router-dom';
import RootLayout from '../layouts/RootLayout';
import LoginPage from '../pages/Login';
import DashboardPage from '../pages/Dashboard';
import CarteraPage from '../pages/Cartera';
import InteligenciaPage from '../pages/Inteligencia';
import CargarCarteraPage from '../pages/CargarCartera';
import { ProtectedRoute, PermissionRoute } from '../components/ProtectedRoute';

/**
 * Rutas de la aplicación (versión usable — FASE 4).
 * - /login es pública.
 * - Todo lo demás vive bajo ProtectedRoute (exige sesión) + RootLayout.
 * - Cada módulo se envuelve en PermissionRoute con su permiso real.
 * - La importación se gatea por el permiso `cartera.importar` (Admin/Supervisor).
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

        <Route element={<PermissionRoute permission="modulo.informacion" />}>
          <Route path="cartera" element={<CarteraPage />} />
        </Route>

        <Route element={<PermissionRoute permission="modulo.centro_inteligencia" />}>
          <Route path="inteligencia" element={<InteligenciaPage />} />
        </Route>

        <Route element={<PermissionRoute permission="cartera.importar" />}>
          <Route path="importar" element={<CargarCarteraPage />} />
        </Route>

        <Route path="*" element={<Navigate replace to="dashboard" />} />
      </Route>
    </Route>
  </Routes>
);

export default AppRoutes;
