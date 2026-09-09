import { useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { Box, Collapse, List, ListItemButton, ListItemIcon, ListItemText, Tooltip } from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/LanguageProvider';
import { NAVIGATION, nodeHasVisibleLeaf, firstLeafPath, railItems, type NavItem, type NavLeaf, type NavNode } from '../../config/navigation';

interface Props { collapsed: boolean; onNavigate?: () => void; }

const splitPath = (path: string): { base: string; tab: string | null } => {
  const [base, q] = path.split('?');
  return { base, tab: q ? new URLSearchParams(q).get('tab') : null };
};

const SidebarNav = ({ collapsed, onNavigate }: Props) => {
  const { hasPermission } = useAuth();
  const { t, lang } = useI18n();
  const location = useLocation();
  const label = (i18nKey: string, fallback: string) => { const s = t(i18nKey); return s === i18nKey ? fallback : s; };

  const matchesCurrentLocation = (leaf: NavLeaf): boolean => {
    if (location.pathname !== splitPath(leaf.path).base) return false;
    const leafTab = splitPath(leaf.path).tab;
    const currentTab = new URLSearchParams(location.search).get('tab');
    if (leafTab === null) return true;
    if (currentTab === leafTab) return true;
    return Boolean(leaf.activeWhenNoTab && currentTab === null);
  };

  // Si dos menús apuntan a la misma ruta (por ejemplo Calendario), solo el primer
  // elemento coincidente se considera activo. Así nunca aparecen dos submenús rosas
  // simultáneamente para la misma página.
  const activeLeafKey = useMemo(() => {
    const find = (items: NavItem[]): string | null => {
      for (const item of items) {
        if (item.kind === 'leaf') {
          if (hasPermission(item.permission) && matchesCurrentLocation(item)) return item.key;
        } else {
          const found = find(item.children);
          if (found) return found;
        }
      }
      return null;
    };
    return find(NAVIGATION);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search, hasPermission, lang]);

  const isLeafActive = (leaf: NavLeaf): boolean => leaf.key === activeLeafKey;
  const subtreeActive = (item: NavItem): boolean => item.kind === 'leaf' ? isLeafActive(item) : item.children.some(subtreeActive);

  // Predeterminado: módulos abiertos; los menús internos empiezan cerrados.
  const moduleKeys = useMemo(() => NAVIGATION.map((item) => item.key), []);
  const [openNodes, setOpenNodes] = useState<Set<string>>(() => new Set(moduleKeys));
  const initialRender = useRef(true);

  const toggle = (key: string) => setOpenNodes((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // Después de la carga inicial, un cambio de ruta abre los ancestros necesarios.
  // Esto conserva la vista inicial tipo "módulos abiertos / menús cerrados" y mantiene
  // navegación profunda funcional cuando el usuario cambia de sección.
  useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }
    const findAncestors = (items: NavItem[], trail: string[]): string[] | null => {
      for (const item of items) {
        if (item.kind === 'leaf') {
          if (isLeafActive(item)) return trail;
        } else {
          const found = findAncestors(item.children, [...trail, item.key]);
          if (found) return found;
        }
      }
      return null;
    };
    const ancestors = findAncestors(NAVIGATION, []);
    if (ancestors?.length) setOpenNodes((prev) => {
      const next = new Set(prev);
      ancestors.forEach((key) => next.add(key));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search, activeLeafKey]);

  const rail = useMemo(() => railItems().filter((item) => item.kind === 'leaf' ? hasPermission(item.permission) : nodeHasVisibleLeaf(item, hasPermission)), [hasPermission, lang]);

  if (collapsed) {
    return <List sx={{ flexGrow: 1, py: 0.5 }}>
      {rail.map((item) => {
        const to = item.kind === 'leaf' ? item.path : firstLeafPath(item);
        const active = item.kind === 'leaf' ? isLeafActive(item) : subtreeActive(item);
        return <Tooltip key={item.key} title={label(item.i18nKey, item.label)} placement="right" arrow>
          <ListItemButton component={RouterLink} to={to} onClick={onNavigate} selected={active} sx={{ justifyContent: 'center', mx: 0.5, mb: 0.5, borderRadius: 2, py: 1, bgcolor: active ? 'rgba(230,0,126,.12)' : 'transparent', '&:hover': { bgcolor: 'action.hover' } }}>
            <ListItemIcon sx={{ minWidth: 0, color: active ? '#E6007E' : '#1E3A8A' }}>{item.icon}</ListItemIcon>
          </ListItemButton>
        </Tooltip>;
      })}
    </List>;
  }

  const renderLeaf = (leaf: NavLeaf, depth: number) => {
    if (!hasPermission(leaf.permission)) return null;
    const active = isLeafActive(leaf);
    return <ListItemButton key={leaf.key} component={RouterLink} to={leaf.path} onClick={onNavigate} selected={active} sx={{ mx: 0.5, my: 0.15, borderRadius: 1.75, pl: depth === 2 ? 2.75 : 1.5, py: depth === 2 ? 0.5 : 0.6, minHeight: depth === 2 ? 34 : 38, bgcolor: active ? 'rgba(230,0,126,.11)' : 'transparent', '&:hover': { bgcolor: active ? 'rgba(230,0,126,.15)' : 'action.hover' } }}>
      <Box sx={{ width: 16, mr: 0.75, display: 'flex', justifyContent: 'center' }}><Box sx={{ width: active ? 7 : 5, height: active ? 7 : 5, borderRadius: '50%', bgcolor: active ? '#E6007E' : 'text.disabled', transition: 'all 120ms ease' }} /></Box>
      <ListItemText primary={label(leaf.i18nKey, leaf.label)} primaryTypographyProps={{ fontSize: depth === 2 ? 12 : 12.5, fontWeight: active ? 700 : 500, noWrap: true, color: active ? '#E6007E' : 'text.primary' }} />
    </ListItemButton>;
  };

  const renderNode = (node: NavNode, depth: number) => {
    if (!nodeHasVisibleLeaf(node, hasPermission)) return null;
    const open = openNodes.has(node.key);
    const active = subtreeActive(node);
    const isModule = depth === 0;
    return <Box key={node.key}>
      <ListItemButton onClick={() => toggle(node.key)} sx={{ mx: 0.5, mt: isModule ? 1 : 0.25, mb: isModule ? 0.35 : 0.15, borderRadius: isModule ? 1.5 : 1.75, pl: isModule ? 1 : 1.5, py: isModule ? 0.65 : 0.7, minHeight: isModule ? 40 : 40, bgcolor: isModule ? 'transparent' : active ? 'rgba(30,58,138,.055)' : 'transparent', '&:hover': { bgcolor: isModule ? 'rgba(30,58,138,.045)' : 'action.hover' } }}>
        <ListItemIcon sx={{ minWidth: 30, color: '#1E3A8A' }}>{node.icon}</ListItemIcon>
        <ListItemText primary={label(node.i18nKey, node.label)} primaryTypographyProps={{ fontSize: isModule ? 11 : 13, fontWeight: isModule ? 800 : 650, textTransform: isModule ? 'uppercase' : 'none', letterSpacing: isModule ? 0.8 : 0, color: isModule ? 'text.secondary' : 'text.primary', noWrap: true }} />
        <Box sx={{ display: 'flex' }}>
          {open ? <KeyboardArrowDownIcon sx={{ fontSize: isModule ? 19 : 18, color: 'text.secondary' }} /> : <KeyboardArrowRightIcon sx={{ fontSize: isModule ? 19 : 18, color: 'text.secondary' }} />}
        </Box>
      </ListItemButton>
      <Collapse in={open} timeout={180} unmountOnExit>
        <Box sx={{ ml: isModule ? 1.75 : 2.25, mr: 0.5, borderLeft: '1px solid', borderColor: isModule ? 'rgba(30,58,138,.14)' : 'divider', pl: 0.35 }}>
          {node.children.map((child) => child.kind === 'node' ? renderNode(child, depth + 1) : renderLeaf(child, depth + 1))}
        </Box>
      </Collapse>
    </Box>;
  };

  return <List sx={{ flexGrow: 1, py: 0.25 }}>{NAVIGATION.map((node) => renderNode(node, 0))}</List>;
};

export default SidebarNav;
