import type { ReactNode } from 'react';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PsychologyIcon from '@mui/icons-material/Psychology';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import FolderIcon from '@mui/icons-material/Folder';
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
  /** Clave de traducción i18n para el nombre del módulo (fallback: `label`). */
  i18nKey?: string;
  path: string;
  permission: string;
  icon: ReactNode;
}

export const MODULES: ModuleDef[] = [
  { key: 'dashboard', label: 'Dashboard', i18nKey: 'nav.dashboard', path: '/dashboard', permission: 'modulo.dashboard', icon: <DashboardIcon sx={{ fontSize: 22 }} /> },
  { key: 'inteligencia', label: 'Centro de Inteligencia', i18nKey: 'nav.inteligencia', path: '/inteligencia', permission: 'modulo.centro_inteligencia', icon: <PsychologyIcon sx={{ fontSize: 22 }} /> },
  { key: 'calendario', label: 'Calendario', i18nKey: 'nav.calendario', path: '/calendario', permission: 'modulo.calendario', icon: <CalendarTodayIcon sx={{ fontSize: 22 }} /> },
  { key: 'control-operativo', label: 'Control Operativo', i18nKey: 'nav.control_operativo', path: '/control-operativo', permission: 'control_operativo.ver', icon: <CenterFocusStrongIcon sx={{ fontSize: 22 }} /> },
  { key: 'asignacion', label: 'Asignación', i18nKey: 'nav.asignacion', path: '/asignacion', permission: 'control_operativo.asignacion.ver', icon: <CenterFocusStrongIcon sx={{ fontSize: 22 }} /> },
  { key: 'gestion', label: 'Gestión', i18nKey: 'nav.gestion', path: '/gestion', permission: 'modulo.gestion', icon: <TrendingUpIcon sx={{ fontSize: 22 }} /> },
  { key: 'repositorio', label: 'Repositorio', i18nKey: 'nav.repositorio', path: '/repositorio', permission: 'modulo.repositorio', icon: <FolderIcon sx={{ fontSize: 22 }} /> },
  // Usuarios se integra dentro de Configuración (pestaña Usuarios). La ruta /usuarios
  // se conserva por compatibilidad (bookmarks/enlaces), pero se retira del sidebar.
  { key: 'configuracion', label: 'Configuración', i18nKey: 'nav.configuracion', path: '/configuracion', permission: 'configuracion.ver', icon: <SettingsIcon sx={{ fontSize: 22 }} /> },
  { key: 'informacion', label: 'Información', i18nKey: 'nav.informacion', path: '/informacion', permission: 'modulo.informacion', icon: <InfoOutlinedIcon sx={{ fontSize: 22 }} /> }
];
