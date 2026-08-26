import type { ReactNode } from 'react';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PsychologyIcon from '@mui/icons-material/Psychology';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import FolderIcon from '@mui/icons-material/Folder';
import SettingsIcon from '@mui/icons-material/Settings';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import InsightsIcon from '@mui/icons-material/Insights';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import VerifiedOutlinedIcon from '@mui/icons-material/VerifiedOutlined';
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline';

/**
 * Árbol de navegación jerárquico (3 niveles). SOLO reorganiza rutas/pestañas EXISTENTES.
 * - Las hojas apuntan a rutas reales ya registradas en AppRoutes (con ?tab= donde la página
 *   soporta pestañas). La seguridad la sigue aplicando PermissionRoute en cada ruta.
 * - Un grupo es visible si el usuario tiene permiso sobre alguna hoja descendiente.
 * Elementos de la estructura solicitada que NO existen como funcionalidad independiente y por
 * tanto NO se inventan: "Aprobaciones" (Análisis), "Aprobaciones y escalamientos",
 * "Resultados de evaluaciones". Se documentan, no se crean.
 */
export interface NavLeaf {
  kind: 'leaf';
  key: string;
  i18nKey: string;
  label: string;
  path: string;
  permission: string;
  icon: ReactNode;
}
export interface NavNode {
  kind: 'node';
  key: string;
  i18nKey: string;
  label: string;
  icon: ReactNode;
  children: NavItem[];
}
export type NavItem = NavLeaf | NavNode;

const leaf = (key: string, i18nKey: string, label: string, path: string, permission: string, icon: ReactNode): NavLeaf =>
  ({ kind: 'leaf', key, i18nKey, label, path, permission, icon });

export const NAVIGATION: NavNode[] = [
  {
    kind: 'node', key: 'analisis', i18nKey: 'nav.group.analisis', label: 'Análisis', icon: <InsightsIcon sx={{ fontSize: 20 }} />,
    children: [
      {
        kind: 'node', key: 'plan', i18nKey: 'nav.sub.plan', label: 'Plan y Proyección', icon: <PsychologyIcon sx={{ fontSize: 20 }} />,
        children: [
          leaf('dashboard', 'nav.dashboard', 'Dashboard', '/dashboard', 'modulo.dashboard', <DashboardIcon sx={{ fontSize: 20 }} />),
          leaf('inteligencia', 'nav.inteligencia', 'Centro de Inteligencia', '/inteligencia', 'modulo.centro_inteligencia', <PsychologyIcon sx={{ fontSize: 20 }} />)
        ]
      }
    ]
  },
  {
    kind: 'node', key: 'operacion', i18nKey: 'nav.group.operacion', label: 'Operación', icon: <CenterFocusStrongIcon sx={{ fontSize: 20 }} />,
    children: [
      {
        kind: 'node', key: 'control-operativo', i18nKey: 'nav.control_operativo', label: 'Control Operativo', icon: <CenterFocusStrongIcon sx={{ fontSize: 20 }} />,
        children: [
          leaf('co-dashboard', 'nav.dashboard', 'Dashboard', '/control-operativo', 'control_operativo.ver', <DashboardIcon sx={{ fontSize: 20 }} />),
          {
            kind: 'node', key: 'asignacion', i18nKey: 'nav.asignacion', label: 'Asignación', icon: <AssignmentIndIcon sx={{ fontSize: 20 }} />,
            children: [
              leaf('asig-asignacion', 'nav.asignacion', 'Asignación', '/asignacion?tab=0', 'control_operativo.asignacion.ver', <AssignmentIndIcon sx={{ fontSize: 20 }} />),
              leaf('asig-reasignacion', 'nav.reasignacion', 'Reasignación manual', '/asignacion?tab=1', 'control_operativo.asignacion.ver', <AssignmentIndIcon sx={{ fontSize: 20 }} />),
              leaf('asig-historial', 'nav.historial', 'Historial', '/asignacion?tab=2', 'control_operativo.asignacion.ver', <AssignmentIndIcon sx={{ fontSize: 20 }} />),
              leaf('asig-base', 'nav.base_marcacion', 'Base de marcación', '/asignacion?tab=3', 'control_operativo.asignacion.ver', <AssignmentIndIcon sx={{ fontSize: 20 }} />)
            ]
          },
          leaf('co-calidad', 'nav.control_calidad', 'Control de Calidad', '/control-operativo', 'control_operativo.calidad.ver', <VerifiedOutlinedIcon sx={{ fontSize: 20 }} />),
          leaf('co-calendario', 'nav.calendario', 'Calendario', '/calendario', 'modulo.calendario', <CalendarTodayIcon sx={{ fontSize: 20 }} />)
        ]
      },
      {
        kind: 'node', key: 'gestion', i18nKey: 'nav.gestion', label: 'Gestión', icon: <TrendingUpIcon sx={{ fontSize: 20 }} />,
        children: [
          leaf('gestion-dashboard', 'nav.dashboard', 'Dashboard', '/gestion', 'modulo.gestion', <DashboardIcon sx={{ fontSize: 20 }} />),
          leaf('gestion-calendario', 'nav.calendario', 'Calendario', '/calendario', 'modulo.calendario', <CalendarTodayIcon sx={{ fontSize: 20 }} />)
        ]
      }
    ]
  },
  {
    kind: 'node', key: 'administracion', i18nKey: 'nav.group.administracion', label: 'Administración', icon: <SettingsIcon sx={{ fontSize: 20 }} />,
    children: [
      {
        kind: 'node', key: 'repositorio', i18nKey: 'nav.repositorio', label: 'Repositorio', icon: <FolderIcon sx={{ fontSize: 20 }} />,
        children: [
          leaf('repo-cartera', 'nav.repo.cartera', 'Gestión de Cartera', '/repositorio', 'modulo.repositorio', <FolderIcon sx={{ fontSize: 20 }} />),
          leaf('repo-usuarios', 'nav.repo.usuarios_masivo', 'Gestión masiva de Usuarios', '/repositorio', 'modulo.repositorio', <PeopleOutlineIcon sx={{ fontSize: 20 }} />),
          leaf('repo-calendario', 'nav.repo.calendario', 'Gestión de Calendario', '/repositorio', 'modulo.repositorio', <CalendarTodayIcon sx={{ fontSize: 20 }} />)
        ]
      },
      {
        kind: 'node', key: 'configuracion', i18nKey: 'nav.configuracion', label: 'Configuración', icon: <SettingsIcon sx={{ fontSize: 20 }} />,
        children: [
          leaf('cfg-apariencia', 'nav.cfg.apariencia', 'Apariencia', '/configuracion?tab=3', 'configuracion.ver', <SettingsIcon sx={{ fontSize: 20 }} />),
          leaf('cfg-general', 'nav.cfg.general', 'General', '/configuracion?tab=0', 'configuracion.ver', <SettingsIcon sx={{ fontSize: 20 }} />),
          leaf('cfg-catalogos', 'nav.cfg.catalogos', 'Catálogos', '/configuracion?tab=1', 'configuracion.ver', <SettingsIcon sx={{ fontSize: 20 }} />),
          leaf('cfg-plantillas', 'nav.cfg.plantillas', 'Plantillas', '/configuracion?tab=4', 'configuracion.ver', <SettingsIcon sx={{ fontSize: 20 }} />),
          leaf('cfg-roles', 'nav.cfg.roles', 'Roles y permisos', '/configuracion?tab=2', 'configuracion.ver', <SettingsIcon sx={{ fontSize: 20 }} />),
          leaf('cfg-usuarios', 'nav.usuarios', 'Usuarios', '/configuracion?tab=7', 'modulo.usuarios', <PeopleOutlineIcon sx={{ fontSize: 20 }} />),
          leaf('cfg-variables', 'nav.cfg.variables', 'Variables', '/configuracion?tab=5', 'configuracion.ver', <SettingsIcon sx={{ fontSize: 20 }} />),
          leaf('cfg-auditoria', 'nav.cfg.auditoria', 'Auditoría', '/configuracion?tab=6', 'configuracion.ver', <SettingsIcon sx={{ fontSize: 20 }} />)
        ]
      },
      {
        kind: 'node', key: 'informacion', i18nKey: 'nav.informacion', label: 'Información', icon: <InfoOutlinedIcon sx={{ fontSize: 20 }} />,
        children: [
          leaf('info-identidad', 'nav.info.identidad', 'Identidad de la empresa', '/informacion', 'modulo.informacion', <InfoOutlinedIcon sx={{ fontSize: 20 }} />),
          leaf('info-cobros', 'nav.info.cobros', 'Cobros Venta Directa', '/informacion', 'modulo.informacion', <InfoOutlinedIcon sx={{ fontSize: 20 }} />),
          leaf('info-herramientas', 'nav.info.herramientas', 'Herramientas y Sistemas', '/informacion', 'modulo.informacion', <InfoOutlinedIcon sx={{ fontSize: 20 }} />)
        ]
      }
    ]
  }
];

/** Aplana todas las hojas visibles (para el modo colapsado: rail de iconos). */
export const flattenLeaves = (items: NavItem[]): NavLeaf[] =>
  items.flatMap((it) => (it.kind === 'leaf' ? [it] : flattenLeaves(it.children)));

/** ¿El usuario tiene permiso sobre alguna hoja del subárbol? */
export const nodeHasVisibleLeaf = (item: NavItem, has: (perm: string) => boolean): boolean =>
  item.kind === 'leaf' ? has(item.permission) : item.children.some((c) => nodeHasVisibleLeaf(c, has));
