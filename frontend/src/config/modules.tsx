import type { ReactNode } from 'react';
import DashboardIcon from '@mui/icons-material/Dashboard';
import InsightsIcon from '@mui/icons-material/Insights';
import TableChartIcon from '@mui/icons-material/TableChart';
import UploadFileIcon from '@mui/icons-material/UploadFile';

/**
 * FUENTE ÚNICA de módulos usables del sistema: define orden, ruta, permiso e icono.
 * El menú (sidebar) y las rutas se generan a partir de aquí, filtrados por permiso.
 * Los permisos son los YA existentes en `role_permissions`; no se inventan nuevos.
 * La autorización real la sigue aplicando el backend (permisos + scope).
 */
export interface ModuleDef {
  key: string;
  label: string;
  path: string;
  permission: string;
  icon: ReactNode;
}

export const MODULES: ModuleDef[] = [
  { key: 'dashboard', label: 'Dashboard', path: '/dashboard', permission: 'modulo.dashboard', icon: <DashboardIcon sx={{ fontSize: 22 }} /> },
  { key: 'cartera', label: 'Cartera', path: '/cartera', permission: 'modulo.informacion', icon: <TableChartIcon sx={{ fontSize: 22 }} /> },
  { key: 'inteligencia', label: 'Centro de Inteligencia', path: '/inteligencia', permission: 'modulo.centro_inteligencia', icon: <InsightsIcon sx={{ fontSize: 22 }} /> },
  { key: 'importar', label: 'Importar cartera', path: '/importar', permission: 'cartera.importar', icon: <UploadFileIcon sx={{ fontSize: 22 }} /> }
];
