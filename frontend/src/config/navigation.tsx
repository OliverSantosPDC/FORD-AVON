import type { ReactNode } from 'react';
// Iconos únicos por elemento (Material UI). Evita repeticiones entre funcionalidades distintas.
import InsightsIcon from '@mui/icons-material/Insights';
import QueryStatsIcon from '@mui/icons-material/QueryStats';
import SpaceDashboardIcon from '@mui/icons-material/SpaceDashboard';
import PsychologyIcon from '@mui/icons-material/Psychology';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import AssignmentIcon from '@mui/icons-material/Assignment';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import HistoryIcon from '@mui/icons-material/History';
import CallIcon from '@mui/icons-material/Call';
import VerifiedOutlinedIcon from '@mui/icons-material/VerifiedOutlined';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import AssessmentIcon from '@mui/icons-material/Assessment';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import GroupsIcon from '@mui/icons-material/Groups';
import EditCalendarIcon from '@mui/icons-material/EditCalendar';
import SettingsIcon from '@mui/icons-material/Settings';
import PaletteIcon from '@mui/icons-material/Palette';
import TuneIcon from '@mui/icons-material/Tune';
import ListAltIcon from '@mui/icons-material/ListAlt';
import DescriptionIcon from '@mui/icons-material/Description';
import SecurityIcon from '@mui/icons-material/Security';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import DataObjectIcon from '@mui/icons-material/DataObject';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import BusinessIcon from '@mui/icons-material/Business';
import PaymentsIcon from '@mui/icons-material/Payments';
import BuildIcon from '@mui/icons-material/Build';

/**
 * Árbol de navegación jerárquico (3 niveles). SOLO reorganiza rutas/pestañas EXISTENTES.
 * - Las hojas apuntan a rutas reales ya registradas en AppRoutes (con ?tab= donde la página
 *   soporta pestañas). La seguridad la sigue aplicando PermissionRoute en cada ruta.
 * - Un grupo es visible si el usuario tiene permiso sobre alguna hoja descendiente.
 * - Cada elemento usa un icono único y semánticamente apropiado.
 * Elementos de la estructura que NO existen como funcionalidad independiente y por tanto NO se
 * inventan: "Aprobaciones", "Aprobaciones y escalamientos", "Resultados de evaluaciones".
 */
export interface NavLeaf { kind: 'leaf'; key: string; i18nKey: string; label: string; path: string; permission: string; icon: ReactNode; }
export interface NavNode { kind: 'node'; key: string; i18nKey: string; label: string; icon: ReactNode; children: NavItem[]; }
export type NavItem = NavLeaf | NavNode;

const ico = (I: typeof InfoOutlinedIcon): ReactNode => <I sx={{ fontSize: 20 }} />;
const leaf = (key: string, i18nKey: string, label: string, path: string, permission: string, I: typeof InfoOutlinedIcon): NavLeaf =>
  ({ kind: 'leaf', key, i18nKey, label, path, permission, icon: ico(I) });

export const NAVIGATION: NavNode[] = [
  {
    kind: 'node', key: 'analisis', i18nKey: 'nav.group.analisis', label: 'Análisis', icon: ico(InsightsIcon),
    children: [
      {
        kind: 'node', key: 'plan', i18nKey: 'nav.sub.plan', label: 'Plan y Proyección', icon: ico(QueryStatsIcon),
        children: [
          leaf('dashboard', 'nav.dashboard', 'Dashboard', '/dashboard', 'modulo.dashboard', SpaceDashboardIcon),
          leaf('inteligencia', 'nav.inteligencia', 'Centro de Inteligencia', '/inteligencia', 'modulo.centro_inteligencia', PsychologyIcon)
        ]
      }
    ]
  },
  {
    kind: 'node', key: 'operacion', i18nKey: 'nav.group.operacion', label: 'Operación', icon: ico(WorkOutlineIcon),
    children: [
      {
        kind: 'node', key: 'control-operativo', i18nKey: 'nav.control_operativo', label: 'Control Operativo', icon: ico(CenterFocusStrongIcon),
        children: [
          leaf('co-dashboard', 'nav.dashboard', 'Dashboard', '/control-operativo', 'control_operativo.ver', MonitorHeartIcon),
          {
            kind: 'node', key: 'asignacion', i18nKey: 'nav.asignacion', label: 'Asignación', icon: ico(AssignmentIndIcon),
            children: [
              leaf('asig-asignacion', 'nav.asignacion', 'Asignación', '/asignacion?tab=0', 'control_operativo.asignacion.ver', AssignmentIcon),
              leaf('asig-reasignacion', 'nav.reasignacion', 'Reasignación manual', '/asignacion?tab=1', 'control_operativo.asignacion.ver', SwapHorizIcon),
              leaf('asig-historial', 'nav.historial', 'Historial', '/asignacion?tab=2', 'control_operativo.asignacion.ver', HistoryIcon),
              leaf('asig-base', 'nav.base_marcacion', 'Base de marcación', '/asignacion?tab=3', 'control_operativo.asignacion.ver', CallIcon)
            ]
          },
          leaf('co-calidad', 'nav.control_calidad', 'Control de Calidad', '/control-operativo', 'control_operativo.calidad.ver', VerifiedOutlinedIcon),
          leaf('co-calendario', 'nav.calendario', 'Calendario', '/calendario', 'modulo.calendario', CalendarMonthIcon)
        ]
      },
      {
        kind: 'node', key: 'gestion', i18nKey: 'nav.gestion', label: 'Gestión', icon: ico(TrendingUpIcon),
        children: [
          leaf('gestion-dashboard', 'nav.dashboard', 'Dashboard', '/gestion', 'modulo.gestion', AssessmentIcon),
          leaf('gestion-calendario', 'nav.calendario', 'Calendario', '/calendario', 'modulo.calendario', CalendarMonthIcon)
        ]
      }
    ]
  },
  {
    kind: 'node', key: 'administracion', i18nKey: 'nav.group.administracion', label: 'Administración', icon: ico(AdminPanelSettingsIcon),
    children: [
      {
        kind: 'node', key: 'repositorio', i18nKey: 'nav.repositorio', label: 'Repositorio', icon: ico(Inventory2Icon),
        children: [
          leaf('repo-cartera', 'nav.repo.cartera', 'Gestión de Cartera', '/repositorio', 'modulo.repositorio', AccountBalanceWalletIcon),
          leaf('repo-usuarios', 'nav.repo.usuarios_masivo', 'Gestión masiva de Usuarios', '/repositorio', 'modulo.repositorio', GroupsIcon),
          leaf('repo-calendario', 'nav.repo.calendario', 'Gestión de Calendario', '/repositorio', 'modulo.repositorio', EditCalendarIcon)
        ]
      },
      {
        kind: 'node', key: 'configuracion', i18nKey: 'nav.configuracion', label: 'Configuración', icon: ico(SettingsIcon),
        children: [
          leaf('cfg-apariencia', 'nav.cfg.apariencia', 'Apariencia', '/configuracion?tab=3', 'configuracion.ver', PaletteIcon),
          leaf('cfg-general', 'nav.cfg.general', 'General', '/configuracion?tab=0', 'configuracion.ver', TuneIcon),
          leaf('cfg-catalogos', 'nav.cfg.catalogos', 'Catálogos', '/configuracion?tab=1', 'configuracion.ver', ListAltIcon),
          leaf('cfg-plantillas', 'nav.cfg.plantillas', 'Plantillas', '/configuracion?tab=4', 'configuracion.ver', DescriptionIcon),
          leaf('cfg-roles', 'nav.cfg.roles', 'Roles y permisos', '/configuracion?tab=2', 'configuracion.ver', SecurityIcon),
          leaf('cfg-usuarios', 'nav.usuarios', 'Usuarios', '/configuracion?tab=7', 'modulo.usuarios', PeopleAltIcon),
          leaf('cfg-variables', 'nav.cfg.variables', 'Variables', '/configuracion?tab=5', 'configuracion.ver', DataObjectIcon),
          leaf('cfg-auditoria', 'nav.cfg.auditoria', 'Auditoría', '/configuracion?tab=6', 'configuracion.ver', FactCheckIcon)
        ]
      },
      {
        kind: 'node', key: 'informacion', i18nKey: 'nav.informacion', label: 'Información', icon: ico(InfoOutlinedIcon),
        children: [
          leaf('info-identidad', 'nav.info.identidad', 'Identidad de la empresa', '/informacion', 'modulo.informacion', BusinessIcon),
          leaf('info-cobros', 'nav.info.cobros', 'Cobros Venta Directa', '/informacion', 'modulo.informacion', PaymentsIcon),
          leaf('info-herramientas', 'nav.info.herramientas', 'Herramientas y Sistemas', '/informacion', 'modulo.informacion', BuildIcon)
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
