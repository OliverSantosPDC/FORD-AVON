import type { ReactNode } from 'react';
import DashboardIcon from '@mui/icons-material/Dashboard';
import InsightsIcon from '@mui/icons-material/Insights';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import FolderIcon from '@mui/icons-material/Folder';
import PersonIcon from '@mui/icons-material/Person';
import SettingsIcon from '@mui/icons-material/Settings';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

/**
 * FUENTE ÚNICA de módulos del sistema: define orden, ruta, permiso e icono.
 * El menú (sidebar) y las rutas se generan a partir de aquí, filtrados por permiso.
 * Los permisos son los YA existentes en `role_permissions` (claves `modulo.*`); no se inventan.
 * La autorización real la sigue aplicando el backend (permisos + scope).
 *
 * Nota de reutilización (sin módulos nuevos ni duplicados):
 *  - "Información" reutiliza la página de Cartera (pages/Cartera/index.tsx).
 *  - "Repositorio" reutiliza la carga/importación (pages/CargarCartera/index.tsx).
 *  - Los módulos aún sin implementación usan PlaceholderPage.
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
  { key: 'inteligencia', label: 'Centro de Inteligencia', path: '/inteligencia', permission: 'modulo.centro_inteligencia', icon: <InsightsIcon sx={{ fontSize: 22 }} /> },
  { key: 'calendario', label: 'Calendario', path: '/calendario', permission: 'modulo.calendario', icon: <CalendarTodayIcon sx={{ fontSize: 22 }} /> },
  { key: 'control-operativo', label: 'Control Operativo', path: '/control-operativo', permission: 'modulo.control_operativo', icon: <CenterFocusStrongIcon sx={{ fontSize: 22 }} /> },
  { key: 'gestion', label: 'Gestión', path: '/gestion', permission: 'modulo.gestion', icon: <TrendingUpIcon sx={{ fontSize: 22 }} /> },
  { key: 'repositorio', label: 'Repositorio', path: '/repositorio', permission: 'modulo.repositorio', icon: <FolderIcon sx={{ fontSize: 22 }} /> },
  { key: 'usuarios', label: 'Usuarios', path: '/usuarios', permission: 'modulo.usuarios', icon: <PersonIcon sx={{ fontSize: 22 }} /> },
  { key: 'configuracion', label: 'Configuración', path: '/configuracion', permission: 'configuracion.ver', icon: <SettingsIcon sx={{ fontSize: 22 }} /> },
  { key: 'informacion', label: 'Información', path: '/informacion', permission: 'modulo.informacion', icon: <InfoOutlinedIcon sx={{ fontSize: 22 }} /> }
];
