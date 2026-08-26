import { useMemo, useState } from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { Box, Collapse, List, ListItemButton, ListItemIcon, ListItemText, Tooltip } from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/LanguageProvider';
import { NAVIGATION, flattenLeaves, nodeHasVisibleLeaf, type NavItem, type NavLeaf, type NavNode } from '../../config/navigation';

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

  const isLeafActive = (leaf: NavLeaf): boolean => {
    const { base, tab } = splitPath(leaf.path);
    if (location.pathname !== base) return false;
    if (tab === null) return true;
    return new URLSearchParams(location.search).get('tab') === tab;
  };
  const subtreeActive = (item: NavItem): boolean =>
    item.kind === 'leaf' ? isLeafActive(item) : item.children.some(subtreeActive);

  const [openNodes, setOpenNodes] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpenNodes((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // Hojas visibles (respeta permisos). `lang` en deps para re-render de etiquetas.
  const leavesVisibles = useMemo(
    () => flattenLeaves(NAVIGATION).filter((l) => hasPermission(l.permission)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasPermission, lang]
  );

  // ===== Modo colapsado: rail de iconos (una entrada por hoja navegable) =====
  if (collapsed) {
    return (
      <List sx={{ flexGrow: 1, py: 0.5 }}>
        {leavesVisibles.map((leaf) => {
          const active = isLeafActive(leaf);
          return (
            <Tooltip key={leaf.key} title={label(leaf.i18nKey, leaf.label)} placement="right" arrow>
              <ListItemButton
                component={RouterLink}
                to={leaf.path}
                onClick={onNavigate}
                selected={active}
                sx={{
                  justifyContent: 'center', mx: 0.5, mb: 0.5, borderRadius: 2, py: 1,
                  bgcolor: active ? 'rgba(230, 0, 126, 0.12)' : 'transparent',
                  '&:hover': { bgcolor: 'action.hover' }
                }}
              >
                <ListItemIcon sx={{ minWidth: 0, color: active ? '#E6007E' : '#1E3A8A' }}>{leaf.icon}</ListItemIcon>
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
    const open = openNodes.has(node.key) || subtreeActive(node);
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
            {node.children.map((child) => (child.kind === 'node' ? renderNode(child, depth + 1) : renderLeaf(child, depth + 1)))}
          </Box>
        </Collapse>
      </Box>
    );
  };

  const renderLeaf = (leaf: NavLeaf, depth: number) => {
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
