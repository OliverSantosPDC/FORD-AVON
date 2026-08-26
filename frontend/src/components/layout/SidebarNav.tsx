import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { Box, Collapse, List, ListItemButton, ListItemIcon, ListItemText, Tooltip } from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/LanguageProvider';
import {
  NAVIGATION, nodeHasVisibleLeaf, firstLeafPath, railItems,
  type NavItem, type NavLeaf, type NavNode
} from '../../config/navigation';

interface Props {
  collapsed: boolean;
  /** callback opcional al navegar (p.ej. cerrar el Drawer temporal en móvil). */
  onNavigate?: () => void;
}

const splitPath = (path: string): { base: string; tab: string | null } => {
  const [base, q] = path.split('?');
  return { base, tab: q ? new URLSearchParams(q).get('tab') : null };
};

const SidebarNav = ({ collapsed, onNavigate }: Props) => {
  const { hasPermission } = useAuth();
  const { t, lang } = useI18n();
  const location = useLocation();
  const label = (i18nKey: string, fallback: string) => {
    const s = t(i18nKey);
    return s === i18nKey ? fallback : s;
  };

  // ── Detección de ruta activa: base + ?tab. Sólo UNA hoja puede quedar activa. ──
  const isLeafActive = (leaf: NavLeaf): boolean => {
    const { base, tab } = splitPath(leaf.path);
    if (location.pathname !== base) return false;
    const curTab = new URLSearchParams(location.search).get('tab');
    if (tab === null) return true; // hoja sin ?tab: activa en su ruta base
    if (curTab === tab) return true;
    return Boolean(leaf.activeWhenNoTab && curTab === null); // opción por defecto cuando no hay ?tab
  };
  const subtreeActive = (item: NavItem): boolean =>
    item.kind === 'leaf' ? isLeafActive(item) : item.children.some(subtreeActive);

  const [openNodes, setOpenNodes] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpenNodes((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  // ── Apertura automática de ancestros de la hoja activa (sin cerrar lo que el usuario abrió). ──
  useEffect(() => {
    const findAncestors = (items: NavItem[], trail: string[]): string[] | null => {
      for (const it of items) {
        if (it.kind === 'leaf') { if (isLeafActive(it)) return trail; }
        else { const r = findAncestors(it.children, [...trail, it.key]); if (r) return r; }
      }
      return null;
    };
    const anc = findAncestors(NAVIGATION, []);
    if (anc && anc.length) setOpenNodes((prev) => { const n = new Set(prev); anc.forEach((k) => n.add(k)); return n; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  // Lista plana ordenada para el rail (nodos nivel-1 + hojas en pre-orden). `lang` re-renderiza etiquetas.
  const rail = useMemo(
    () => railItems().filter((it) => (it.kind === 'leaf' ? hasPermission(it.permission) : nodeHasVisibleLeaf(it, hasPermission))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasPermission, lang]
  );

  // ===== Modo colapsado: rail de iconos preservando EXACTAMENTE el orden del árbol expandido =====
  if (collapsed) {
    return (
      <List sx={{ flexGrow: 1, py: 0.5 }}>
        {rail.map((it) => {
          const to = it.kind === 'leaf' ? it.path : firstLeafPath(it);
          const active = it.kind === 'leaf' ? isLeafActive(it) : subtreeActive(it);
          return (
            <Tooltip key={it.key} title={label(it.i18nKey, it.label)} placement="right" arrow>
              <ListItemButton
                component={RouterLink}
                to={to}
                onClick={onNavigate}
                selected={active}
                sx={{
                  justifyContent: 'center', mx: 0.5, mb: 0.5, borderRadius: 2, py: 1,
                  bgcolor: active ? 'rgba(230, 0, 126, 0.12)' : 'transparent',
                  '&:hover': { bgcolor: 'action.hover' }
                }}
              >
                <ListItemIcon sx={{ minWidth: 0, color: active ? '#E6007E' : '#1E3A8A' }}>{it.icon}</ListItemIcon>
              </ListItemButton>
            </Tooltip>
          );
        })}
      </List>
    );
  }

  // ===== Modo expandido: árbol jerárquico colapsable =====
  const renderNode = (node: NavNode, depth: number) => {
    if (!nodeHasVisibleLeaf(node, hasPermission)) return null;
    const open = openNodes.has(node.key); // colapsable de forma independiente; los ancestros se abren al navegar
    return (
      <Box key={node.key}>
        <ListItemButton onClick={() => toggle(node.key)} sx={{ mx: 0.5, my: 0.25, borderRadius: 2, pl: 1, py: 0.6 }}>
          <ListItemIcon sx={{ minWidth: 28, color: '#1E3A8A' }}>{node.icon}</ListItemIcon>
          <ListItemText
            primary={label(node.i18nKey, node.label)}
            primaryTypographyProps={{
              fontSize: depth === 0 ? 11 : 11.5,
              fontWeight: depth === 0 ? 800 : 700,
              textTransform: depth === 0 ? 'uppercase' : 'none',
              letterSpacing: depth === 0 ? 0.5 : 0,
              color: 'text.secondary', noWrap: true
            }}
          />
          {open ? <KeyboardArrowDownIcon sx={{ fontSize: 18, color: 'text.secondary' }} /> : <KeyboardArrowRightIcon sx={{ fontSize: 18, color: 'text.secondary' }} />}
        </ListItemButton>
        <Collapse in={open} unmountOnExit>
          <Box sx={{ ml: depth === 0 ? 1.5 : 2, borderLeft: '1px solid', borderColor: 'divider', pl: 0.25 }}>
            {node.children.map((child) => (child.kind === 'node' ? renderNode(child, depth + 1) : renderLeaf(child)))}
          </Box>
        </Collapse>
      </Box>
    );
  };

  const renderLeaf = (leaf: NavLeaf) => {
    if (!hasPermission(leaf.permission)) return null;
    const active = isLeafActive(leaf);
    return (
      <ListItemButton
        key={leaf.key}
        component={RouterLink}
        to={leaf.path}
        onClick={onNavigate}
        selected={active}
        sx={{
          mx: 0.5, my: 0.15, borderRadius: 2, pl: 1, py: 0.6,
          bgcolor: active ? 'rgba(230, 0, 126, 0.12)' : 'transparent',
          '&:hover': { bgcolor: 'action.hover' }
        }}
      >
        <ListItemIcon sx={{ minWidth: 26, color: active ? '#E6007E' : '#1E3A8A' }}>{leaf.icon}</ListItemIcon>
        <ListItemText primary={label(leaf.i18nKey, leaf.label)} primaryTypographyProps={{ fontSize: 11.5, fontWeight: active ? 700 : 600, noWrap: true }} />
      </ListItemButton>
    );
  };

  return <List sx={{ flexGrow: 1, py: 0.5 }}>{NAVIGATION.map((node) => renderNode(node, 0))}</List>;
};

export default SidebarNav;
