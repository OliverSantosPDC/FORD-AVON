import { Navigate, Route, Routes } from 'react-router-dom';
import RootLayout from '../layouts/RootLayout';
import DashboardPage from '../pages/Dashboard';
import InteligenciaPage from '../pages/Inteligencia';
import CargarCarteraPage from '../pages/CargarCartera';
import PlaceholderPage from '../pages/PlaceholderPage';

const AppRoutes = () => (
  <Routes>
    <Route path="/" element={<RootLayout />}>
      <Route index element={<Navigate replace to="dashboard" />} />
      <Route path="dashboard" element={<DashboardPage />} />
      <Route path="gestion" element={<PlaceholderPage title="Gestión" />} />
      <Route path="calendario" element={<PlaceholderPage title="Calendario" />} />
      <Route path="reportes" element={<PlaceholderPage title="Reportes" />} />
      <Route path="proyecciones" element={<PlaceholderPage title="Proyecciones" />} />
      <Route path="inteligencia" element={<InteligenciaPage />} />
      <Route path="cargar-cartera" element={<CargarCarteraPage />} />
      <Route path="configuracion" element={<PlaceholderPage title="Configuración" />} />
      <Route path="usuarios" element={<PlaceholderPage title="Usuarios" />} />
      <Route path="*" element={<Navigate replace to="dashboard" />} />
    </Route>
  </Routes>
);

export default AppRoutes;
