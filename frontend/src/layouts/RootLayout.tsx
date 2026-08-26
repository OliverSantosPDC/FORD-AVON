import React, { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AppBar,
  Avatar,
  Box,
  Collapse,
  CssBaseline,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  useTheme,
  Menu,
  MenuItem,
  Badge,
  Tooltip
} from '@mui/material';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import SidebarNav from '../components/layout/SidebarNav';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LogoutIcon from '@mui/icons-material/Logout';
import { useThemeMode } from '../theme/ThemeProviderWrapper';
import { useI18n } from '../i18n/LanguageProvider';
import { useAuth } from '../context/AuthContext';
import pdcLogo from '../assets/branding/pdc-logo.svg';
import avonLogo from '../assets/branding/avon-logo.svg';

const EXPANDED_WIDTH = 240;
const COLLAPSED_WIDTH = 68;
const SIDEBAR_KEY = 'ford-avon-sidebar-collapsed';

const initialsOf = (nombre?: string | null, apellido?: string | null): string => {
  const a = (nombre ?? '').trim().charAt(0);
  const b = (apellido ?? '').trim().charAt(0);
  const ini = `${a}${b}`.toUpperCase();
  return ini || 'U';
};

const RootLayout = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { mode, toggleMode } = useThemeMode();
  const { lang, setLang, t } = useI18n();
  const { user, role, hasPermission, logout } = useAuth();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [time, setTime] = useState(() => new Date());
  const location = useLocation();

  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  // Sidebar colapsable (persistente).
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  useEffect(() => {
    setSidebarCollapsed(localStorage.getItem(SIDEBAR_KEY) === '1');
  }, []);
  const toggleSidebar = () =>
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
      return next;
    });
  const drawerWidth = sidebarCollapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;

  const updateDate = useMemo(
    () => new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date()),
    []
  );

  const formattedTime = useMemo(
    () => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(time),
    [time]
  );

  const nombreCompleto = [user?.nombre, user?.apellido].filter(Boolean).join(' ') || user?.email || 'Usuario';
  const roleNombre = role?.nombre ?? 'Sin rol';
  const iniciales = initialsOf(user?.nombre, user?.apellido);

  const handleUserMenuOpen = (event: React.MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget);
  const handleUserMenuClose = () => setAnchorEl(null);

  const handleLogout = async () => {
    handleUserMenuClose();
    await logout();
    navigate('/login', { replace: true });
  };

  const drawer = (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: mode === 'light' ? '#F6F8FB' : '#111827',
        color: mode === 'light' ? '#5B6472' : '#E2E8F0',
        overflowY: 'auto',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        '&::-webkit-scrollbar': { display: 'none', width: 0, height: 0 }
      }}
    >
      <Toolbar sx={{ px: 1, py: 1.25, minHeight: 52, display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : 'space-between', gap: 0.5 }}>
        {!sidebarCollapsed && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box component="img" src={pdcLogo} alt="Logo PDC" sx={{ width: 54, height: 16 }} />
            <Box component="img" src={avonLogo} alt="Logo AVON" sx={{ width: 54, height: 16 }} />
          </Box>
        )}
        <Tooltip title={sidebarCollapsed ? t('nav.expand') : t('nav.collapse')} placement="right" arrow>
          <IconButton size="small" onClick={toggleSidebar} aria-label="toggle sidebar">
            <MenuOpenIcon fontSize="small" sx={{ transform: sidebarCollapsed ? 'rotate(180deg)' : 'none', transition: 'transform 200ms ease' }} />
          </IconButton>
        </Tooltip>
      </Toolbar>
      <Divider sx={{ mb: 1.25, borderColor: mode === 'light' ? '#E5E7EB' : '#17233F' }} />
      <SidebarNav collapsed={sidebarCollapsed} />
      <Box sx={{ p: 1.75 }}>
        <Typography variant="caption" sx={{ color: mode === 'light' ? '#6B7280' : '#94A3B8', fontSize: 10 }}>
          FORD-AVON · v1.0.0
        </Typography>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <CssBaseline />
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          zIndex: theme.zIndex.drawer + 1,
          bgcolor: mode === 'light' ? '#FFFFFFCC' : '#111827CC',
          backdropFilter: 'blur(15px)',
          borderBottom: '1px solid',
          borderColor: mode === 'light' ? '#EEF2F7' : '#334155',
          boxShadow: mode === 'light' ? '0 20px 50px rgba(15, 23, 42, 0.08)' : '0 20px 50px rgba(0, 0, 0, 0.45)'
        }}
      >
        <Toolbar sx={{ justifyContent: 'space-between', px: { xs: 1.5, sm: 2.5, md: 3 }, py: 0.75, minHeight: 56, gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Tooltip title={sidebarCollapsed ? t('nav.expand') : t('nav.collapse')}>
              <IconButton size="small" onClick={toggleSidebar} aria-label="toggle sidebar" edge="start">
                <MenuOpenIcon fontSize="small" sx={{ transform: sidebarCollapsed ? 'rotate(180deg)' : 'none', transition: 'transform 200ms ease' }} />
              </IconButton>
            </Tooltip>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.25, py: 0.5, borderRadius: 3, bgcolor: mode === 'light' ? 'rgba(30, 58, 138, 0.08)' : 'rgba(255, 255, 255, 0.06)', transition: 'background-color 220ms ease-in-out' }}>
              <Box component="img" src={pdcLogo} alt="Logo PDC" sx={{ width: 68, height: 19 }} />
              <Divider orientation="vertical" flexItem sx={{ borderColor: mode === 'light' ? '#D1D5DB' : '#17233F' }} />
              <Box component="img" src={avonLogo} alt="Logo AVON" sx={{ width: 68, height: 19 }} />
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.15 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ letterSpacing: 0.1, fontSize: 15, lineHeight: 1.2 }}>
                FORD-AVON
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
                Fecha {updateDate} · Hora {formattedTime}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                px: 1.5,
                py: 0.5,
                borderRadius: 3,
                bgcolor: mode === 'light' ? '#FFFFFF' : '#0F172A',
                border: '1px solid',
                borderColor: mode === 'light' ? '#EEF2F7' : '#334155',
                boxShadow: mode === 'light' ? '0 10px 26px rgba(15, 23, 42, 0.06)' : '0 10px 26px rgba(0, 0, 0, 0.35)',
                transition: 'box-shadow 220ms ease-in-out'
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.85 }}>
                <Avatar sx={{ width: 28, height: 28, bgcolor: '#1E3A8A', fontSize: 12 }}>{iniciales}</Avatar>
                <Box>
                  <Typography variant="caption" fontWeight={700} sx={{ display: 'block', lineHeight: 1.2 }}>
                    {nombreCompleto}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, lineHeight: 1.2 }}>
                    {roleNombre}
                  </Typography>
                </Box>
              </Box>
            </Box>
            <Tooltip title={t('common.language')}>
              <IconButton
                size="small"
                onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
                color="inherit"
                aria-label={t('common.language')}
                sx={{
                  bgcolor: mode === 'light' ? '#FFFFFF' : '#0F172A',
                  border: '1px solid',
                  borderColor: mode === 'light' ? '#EEF2F7' : '#334155',
                  fontSize: 12,
                  fontWeight: 700,
                  width: 34, height: 34,
                  transition: 'all 220ms ease-in-out',
                  '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 10px 24px rgba(15, 23, 42, 0.12)' }
                }}
              >
                {lang.toUpperCase()}
              </IconButton>
            </Tooltip>
            <Tooltip title={t('common.theme')}>
              <IconButton
                size="small"
                onClick={toggleMode}
                color="inherit"
                sx={{
                  bgcolor: mode === 'light' ? '#FFFFFF' : '#0F172A',
                  border: '1px solid',
                  borderColor: mode === 'light' ? '#EEF2F7' : '#334155',
                  transition: 'all 220ms ease-in-out',
                  '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 10px 24px rgba(15, 23, 42, 0.12)' }
                }}
              >
                {mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Notificaciones">
              <IconButton
                size="small"
                aria-label="notificaciones"
                sx={{
                  bgcolor: mode === 'light' ? '#FFFFFF' : '#0F172A',
                  border: '1px solid',
                  borderColor: mode === 'light' ? '#EEF2F7' : '#334155',
                  transition: 'all 220ms ease-in-out',
                  '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 10px 24px rgba(15, 23, 42, 0.12)' }
                }}
              >
                <Badge badgeContent={3} color="secondary">
                  <NotificationsNoneIcon fontSize="small" />
                </Badge>
              </IconButton>
            </Tooltip>
            <Tooltip title="Abrir menú de usuario">
              <IconButton
                size="small"
                onClick={handleUserMenuOpen}
                sx={{
                  bgcolor: mode === 'light' ? '#FFFFFF' : '#0F172A',
                  border: '1px solid',
                  borderColor: mode === 'light' ? '#EEF2F7' : '#334155',
                  transition: 'all 220ms ease-in-out',
                  '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 10px 24px rgba(15, 23, 42, 0.12)' }
                }}
              >
                <Avatar sx={{ width: 26, height: 26, bgcolor: '#E6007E', fontSize: 12 }}>{iniciales}</Avatar>
              </IconButton>
            </Tooltip>
            <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleUserMenuClose}>
              <Box sx={{ px: 2, py: 1 }}>
                <Typography variant="body2" fontWeight={700} sx={{ lineHeight: 1.3 }}>{nombreCompleto}</Typography>
                <Typography variant="caption" color="text.secondary">{roleNombre}</Typography>
              </Box>
              <Divider />
              <MenuItem onClick={handleLogout}>
                <ListItemIcon sx={{ minWidth: 32 }}><LogoutIcon fontSize="small" /></ListItemIcon>
                Cerrar sesión
              </MenuItem>
            </Menu>
          </Box>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: drawerWidth, flexShrink: 0, transition: 'width 220ms ease' }} aria-label="sidebar navigation">
        <Drawer
          variant="permanent"
          open
          sx={{
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
              borderRight: 'none',
              overflowX: 'hidden',
              transition: 'width 220ms ease',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              '&::-webkit-scrollbar': { display: 'none', width: 0, height: 0 }
            }
          }}
        >
          {drawer}
        </Drawer>
      </Box>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: 2, width: { md: `calc(100% - ${drawerWidth}px)` }, transition: 'width 220ms ease' }}>
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
};

export default RootLayout;
