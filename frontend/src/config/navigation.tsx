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

/**
 * Árbol de navegación jerárquico. SOLO reorganiza rutas/pestañas EXISTENTES; no crea páginas.
 * - Hojas → rutas reales (con ?tab= donde la página soporta pestañas). PermissionRoute sigue
 *   protegiendo cada ruta. Un grupo es visible si el usuario tiene permiso sobre alguna hoja.
 * - Iconos únicos por elemento (excepción: el mismo destino /calendario comparte icono).
 * No existen como funcionalidad independiente (y por tanto NO se inventan): "Aprobaciones",
 * "Aprobaciones y escalamientos", "Resultados de evaluaciones".
 */
export interface NavLeaf {
  kind: 'leaf'; key: string; i18nKey: string; label: string; path: string; permission: string; icon: ReactNode;
  /** Marca la hoja como activa cuando la ruta base no lleva ?tab (opción por defecto). */
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
      leaf('repositorio', 'nav.repositorio', 'Repositorio', '/repositorio', 'modulo.repositorio', Inventory2Icon),
      leaf('configuracion', 'nav.configuracion', 'Configuración', '/configuracion', 'configuracion.ver', SettingsIcon),
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

/** ¿El usuario tiene permiso sobre alguna hoja del subárbol? */
export const nodeHasVisibleLeaf = (item: NavItem, has: (perm: string) => boolean): boolean =>
  item.kind === 'leaf' ? has(item.permission) : item.children.some((c) => nodeHasVisibleLeaf(c, has));

/** Primera hoja del subárbol (destino de un nodo en el rail colapsado). */
export const firstLeafPath = (item: NavItem): string =>
  item.kind === 'leaf' ? item.path : (item.children[0] ? firstLeafPath(item.children[0]) : '/');

/**
 * Rail colapsado: recorrido en PRE-ORDEN que preserva EXACTAMENTE el orden del árbol expandido.
 * Emite las hojas y los nodos de nivel 1 (hijos directos de los grupos superiores); los nodos
 * más profundos (p.ej. Asignación) no se emiten como icono, pero sí se recorren sus hojas.
 */
const railWalk = (items: NavItem[], depth: number): NavItem[] =>
  items.flatMap((it) => (it.kind === 'leaf' ? [it] : [...(depth === 1 ? [it] : []), ...railWalk(it.children, depth + 1)]));
export const railItems = (): NavItem[] => NAVIGATION.flatMap((g) => railWalk(g.children, 1));
