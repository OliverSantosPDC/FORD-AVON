import type { ReactNode } from 'react';
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
import EventNoteIcon from '@mui/icons-material/EventNote';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import SettingsIcon from '@mui/icons-material/Settings';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import BusinessIcon from '@mui/icons-material/Business';
import PaymentsIcon from '@mui/icons-material/Payments';
import BuildIcon from '@mui/icons-material/Build';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import GroupIcon from '@mui/icons-material/Group';
import EventNoteOutlinedIcon from '@mui/icons-material/EventNoteOutlined';
import TuneIcon from '@mui/icons-material/Tune';
import CategoryIcon from '@mui/icons-material/Category';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import PaletteIcon from '@mui/icons-material/Palette';
import DescriptionIcon from '@mui/icons-material/Description';
import DataObjectIcon from '@mui/icons-material/DataObject';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import CurrencyExchangeIcon from '@mui/icons-material/CurrencyExchange';
import TrackChangesIcon from '@mui/icons-material/TrackChanges';

/** Árbol de navegación jerárquico. Las hojas usan únicamente rutas/permisos existentes. */
export interface NavLeaf {
  kind: 'leaf'; key: string; i18nKey: string; label: string; path: string; permission: string; icon: ReactNode;
  activeWhenNoTab?: boolean;
}
export interface NavNode { kind: 'node'; key: string; i18nKey: string; label: string; icon: ReactNode; children: NavItem[]; }
export type NavItem = NavLeaf | NavNode;

const ico = (I: typeof InfoOutlinedIcon): ReactNode => <I sx={{ fontSize: 20 }} />;
const leaf = (
  key: string, i18nKey: string, label: string, path: string, permission: string, I: typeof InfoOutlinedIcon, activeWhenNoTab = false
): NavLeaf => ({ kind: 'leaf', key, i18nKey, label, path, permission, icon: ico(I), activeWhenNoTab });

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
              leaf('asig-asignacion', 'nav.asignacion', 'Asignación', '/asignacion?tab=0', 'control_operativo.asignacion.ver', AssignmentIcon, true),
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
          leaf('gestion-calendario', 'nav.calendario', 'Calendario', '/calendario', 'modulo.calendario', EventNoteIcon)
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
          leaf('repo-cartera', 'nav.repositorio.cartera', 'Gestión de Cartera', '/repositorio?tab=0', 'modulo.repositorio', FolderOpenIcon, true),
          leaf('repo-usuarios', 'nav.repositorio.usuarios', 'Gestión masiva de Usuarios', '/repositorio?tab=1', 'usuarios.administrar_global', GroupIcon),
          leaf('repo-calendario', 'nav.repositorio.calendario', 'Gestión de Calendario', '/repositorio?tab=2', 'calendario.crear', EventNoteOutlinedIcon)
        ]
      },
      {
        kind: 'node', key: 'configuracion', i18nKey: 'nav.configuracion', label: 'Configuración', icon: ico(SettingsIcon),
        children: [
          leaf('config-general', 'nav.configuracion.general', 'General', '/configuracion?tab=0', 'configuracion.ver', TuneIcon, true),
          leaf('config-catalogos', 'nav.configuracion.catalogos', 'Catálogos', '/configuracion?tab=1', 'configuracion.ver', CategoryIcon),
          leaf('config-tasas', 'nav.configuracion.tasas', 'Tasas de Conversión', '/configuracion?tab=7', 'configuracion.ver', CurrencyExchangeIcon),
          leaf('config-metas', 'nav.configuracion.metas', 'Metas', '/configuracion?tab=9', 'configuracion.ver', TrackChangesIcon),
          leaf('config-roles', 'nav.configuracion.roles', 'Roles y permisos', '/configuracion?tab=2', 'configuracion.ver', AdminPanelSettingsOutlinedIcon),
          leaf('config-apariencia', 'nav.configuracion.apariencia', 'Apariencia', '/configuracion?tab=3', 'configuracion.ver', PaletteIcon),
          leaf('config-plantillas', 'nav.configuracion.plantillas', 'Plantillas', '/configuracion?tab=4', 'configuracion.ver', DescriptionIcon),
          leaf('config-variables', 'nav.configuracion.variables', 'Variables', '/configuracion?tab=5', 'configuracion.ver', DataObjectIcon),
          leaf('config-auditoria', 'nav.configuracion.auditoria', 'Auditoría', '/configuracion?tab=6', 'configuracion.ver', FactCheckIcon),
          // Ruta a la ruta AUTÓNOMA /usuarios (no a /configuracion?tab=8): esa ruta anidada
          // exige además `configuracion.ver`, permiso que "supervisor" no tiene aunque SÍ
          // tenga `modulo.usuarios` — con /configuracion?tab=8 este rol nunca podría entrar.
          // /usuarios solo exige `modulo.usuarios`, que es el permiso real del módulo.
          leaf('config-usuarios', 'nav.configuracion.usuarios', 'Usuarios', '/usuarios', 'modulo.usuarios', GroupIcon)
        ]
      },
      {
        kind: 'node', key: 'informacion', i18nKey: 'nav.informacion', label: 'Información', icon: ico(InfoOutlinedIcon),
        children: [
          leaf('info-identidad', 'nav.info.identidad', 'Identidad de la empresa', '/informacion?tab=identidad', 'modulo.informacion', BusinessIcon, true),
          leaf('info-cobros', 'nav.info.cobros', 'Cobros Venta Directa', '/informacion?tab=cobros', 'modulo.informacion', PaymentsIcon),
          leaf('info-herramientas', 'nav.info.herramientas', 'Herramientas y Sistemas', '/informacion?tab=herramientas', 'modulo.informacion', BuildIcon)
        ]
      }
    ]
  }
];

export const nodeHasVisibleLeaf = (item: NavItem, has: (perm: string) => boolean): boolean =>
  item.kind === 'leaf' ? has(item.permission) : item.children.some((c) => nodeHasVisibleLeaf(c, has));

export const firstLeafPath = (item: NavItem): string =>
  item.kind === 'leaf' ? item.path : (item.children[0] ? firstLeafPath(item.children[0]) : '/');

const railWalk = (items: NavItem[], depth: number): NavItem[] =>
  items.flatMap((it) => (it.kind === 'leaf' ? [it] : [...(depth === 1 ? [it] : []), ...railWalk(it.children, depth + 1)]));
export const railItems = (): NavItem[] => NAVIGATION.flatMap((g) => railWalk(g.children, 1));
