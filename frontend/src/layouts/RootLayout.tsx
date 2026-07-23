import React, { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, Outlet, useLocation } from 'react-router-dom';
import {
  AppBar,
  Avatar,
  Box,
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
import DashboardIcon from '@mui/icons-material/Dashboard';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import InsightsIcon from '@mui/icons-material/Insights';
import BarChartIcon from '@mui/icons-material/BarChart';
import SettingsIcon from '@mui/icons-material/Settings';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import AvatarIcon from '@mui/icons-material/Person';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import type { PaletteMode } from '@mui/material';
import { useThemeMode } from '../theme/ThemeProviderWrapper';
import pdcLogo from '../assets/branding/pdc-logo.svg';
import avonLogo from '../assets/branding/avon-logo.svg';

const drawerWidth = 168;

const menuItems = [
  { label: 'Dashboard', icon: <DashboardIcon sx={{ fontSize: 22 }} />, path: '/dashboard' },
  { label: 'Gestión', icon: <TrendingUpIcon sx={{ fontSize: 22 }} />, path: '/gestion' },
  { label: 'Calendario', icon: <CalendarTodayIcon sx={{ fontSize: 22 }} />, path: '/calendario' },
  { label: 'Reportes', icon: <BarChartIcon sx={{ fontSize: 22 }} />, path: '/reportes' },
  { label: 'Proyecciones', icon: <InsightsIcon sx={{ fontSize: 22 }} />, path: '/proyecciones' },
  { label: 'Centro de Inteligencia', icon: <InsightsIcon sx={{ fontSize: 22 }} />, path: '/inteligencia' },
  { label: 'Cargar cartera', icon: <UploadFileIcon sx={{ fontSize: 22 }} />, path: '/cargar-cartera' },
  { label: 'Configuración', icon: <SettingsIcon sx={{ fontSize: 22 }} />, path: '/configuracion' },
  { label: 'Usuarios', icon: <AvatarIcon sx={{ fontSize: 22 }} />, path: '/usuarios' }
];

const RootLayout = () => {
  const theme = useTheme();
  const { mode, toggleMode } = useThemeMode();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [time, setTime] = useState(() => new Date());
  const location = useLocation();

  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const updateDate = useMemo(
    () => new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date()),
    []
  );

  const formattedTime = useMemo(
    () => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(time),
    [time]
  );

  const handleUserMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleUserMenuClose = () => {
    setAnchorEl(null);
  };

  const drawer = (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: mode === 'light' ? '#F6F8FB' : '#111827',
        color: mode === 'light' ? '#5B6472' : '#E2E8F0',
        // Scrollbar eliminado por completo en el panel lateral.
        overflowY: 'auto',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        '&::-webkit-scrollbar': { display: 'none', width: 0, height: 0 }
      }}
    >
      {/* Espacio reservado para los logos oficiales de la próxima iteración. */}
      <Toolbar sx={{ px: 1.75, py: 1.25, minHeight: 52 }}>
        <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box component="img" src={pdcLogo} alt="Logo PDC" sx={{ width: 60, height: 18 }} />
          <Box component="img" src={avonLogo} alt="Logo AVON" sx={{ width: 60, height: 18 }} />
        </Box>
      </Toolbar>
      <Divider sx={{ mb: 1.25, borderColor: mode === 'light' ? '#E5E7EB' : '#17233F' }} />
      <List sx={{ flexGrow: 1, py: 0.5 }}>
        {menuItems.map((item) => {
          const selected = location.pathname === item.path;
          return (
            <ListItem key={item.label} disablePadding>
              <ListItemButton
                component={RouterLink}
                to={item.path}
                selected={selected}
                sx={{
                  position: 'relative',
                  overflow: 'hidden',
                  py: 1,
                  borderRadius: 2.5,
                  mb: 0.75,
                  mx: 1,
                  pl: 1.25,
                  transition: 'transform 320ms cubic-bezier(0.4, 0, 0.2, 1), background-color 320ms ease, box-shadow 320ms ease',
                  bgcolor: selected ? 'rgba(230, 0, 126, 0.12)' : 'transparent',
                  color: mode === 'light' ? '#5B6472' : '#E2E8F0',
                  borderLeft: selected ? '3px solid #E6007E' : '3px solid transparent',
                  transform: selected ? 'translateX(3px)' : 'translateX(0)',
                  boxShadow: selected
                    ? '0 0 0 1px rgba(230, 0, 126, 0.14), 0 8px 22px rgba(230, 0, 126, 0.18)'
                    : 'none',
                  // Iluminación suave que recorre el módulo activo.
                  '&::after': selected
                    ? {
                        content: '""',
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '60%',
                        height: '100%',
                        background: 'linear-gradient(100deg, transparent 0%, rgba(230, 0, 126, 0.16) 50%, transparent 100%)',
                        animation: 'navGlow 3.6s ease-in-out infinite',
                        pointerEvents: 'none'
                      }
                    : {},
                  '@keyframes navGlow': {
                    '0%': { transform: 'translateX(-120%)', opacity: 0 },
                    '35%': { opacity: 1 },
                    '100%': { transform: 'translateX(260%)', opacity: 0 }
                  },
                  '&:hover': {
                    bgcolor: mode === 'light' ? 'rgba(230, 0, 126, 0.08)' : 'rgba(255, 255, 255, 0.06)',
                    transform: 'translateX(3px)'
                  }
                }}
              >
                <ListItemIcon sx={{ color: selected ? '#E6007E' : '#1E3A8A', minWidth: 30, transition: 'color 320ms ease' }}>{item.icon}</ListItemIcon>
                <ListItemText
                  primary={item.label}
                  primaryTypographyProps={{
                    fontWeight: selected ? 700 : 600,
                    fontSize: 11.5,
                    color: mode === 'light' ? '#4B5563' : '#F8FAFC',
                    noWrap: true
                  }}
                />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>
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
                <Avatar sx={{ width: 28, height: 28, bgcolor: '#1E3A8A', fontSize: 12 }}>A</Avatar>
                <Box>
                  <Typography variant="caption" fontWeight={700} sx={{ display: 'block', lineHeight: 1.2 }}>
                    Adrián Pérez
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, lineHeight: 1.2 }}>
                    Avon PDC
                  </Typography>
                </Box>
              </Box>
            </Box>
            <Tooltip title="Cambiar tema">
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
                <Avatar sx={{ width: 26, height: 26, bgcolor: '#E6007E', fontSize: 12 }}>AP</Avatar>
              </IconButton>
            </Tooltip>
            <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleUserMenuClose}>
              <MenuItem onClick={handleUserMenuClose}>Perfil</MenuItem>
              <MenuItem onClick={handleUserMenuClose}>Cerrar sesión</MenuItem>
            </Menu>
          </Box>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: drawerWidth, flexShrink: 0 }} aria-label="sidebar navigation">
        <Drawer
          variant="permanent"
          open
          sx={{
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
              borderRight: 'none',
              overflowX: 'hidden',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              '&::-webkit-scrollbar': { display: 'none', width: 0, height: 0 }
            }
          }}
        >
          {drawer}
        </Drawer>
      </Box>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: 2, width: { md: `calc(100% - ${drawerWidth}px)` } }}>
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
};

export default RootLayout;
