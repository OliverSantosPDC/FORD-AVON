import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Box, Button, Chip, CircularProgress, Divider, IconButton, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import LockResetIcon from '@mui/icons-material/LockReset';
import { useNotificaciones } from '../../hooks/useNotificaciones';
import { rutaDeNotificacion, type Notificacion, type TipoNotificacion } from '../../services/notificacionesService';

/** Icono/color por tipo — mismo sistema de color success/warning/error/info
 *  que ya usan los Chip de estado de carta en Gestión/Control Operativo
 *  (APROBADA=success, RECHAZADA=error, PENDIENTE=warning), nunca colores
 *  nuevos inventados. */
const ESTILO_POR_TIPO: Record<TipoNotificacion, { Icon: typeof DescriptionOutlinedIcon; color: 'warning' | 'success' | 'error' | 'info' }> = {
  CARTA_ESCALADA: { Icon: DescriptionOutlinedIcon, color: 'warning' },
  CARTA_AUTORIZADA: { Icon: CheckCircleOutlineIcon, color: 'success' },
  CARTA_RECHAZADA: { Icon: CancelOutlinedIcon, color: 'error' },
  PASSWORD_CAMBIADA: { Icon: LockResetIcon, color: 'info' },
  PASSWORD_SOLICITUD_RECHAZADA: { Icon: LockResetIcon, color: 'error' }
};

const formatearFecha = (iso: string): string =>
  new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

interface NotificationBellProps { mode: 'light' | 'dark'; }

/**
 * Campana de notificaciones del Header — ÚNICO componente de notificaciones
 * de toda la app (no crear otro). Reemplaza el icono anterior, que era
 * decorativo (badgeContent={3} fijo, sin datos, sin onClick): ahora el
 * contador y el listado vienen de GET /api/notificaciones/contador y
 * GET /api/notificaciones (useNotificaciones), ambos acotados en el
 * backend al usuario autenticado.
 */
const NotificationBell = ({ mode }: NotificationBellProps) => {
  const navigate = useNavigate();
  const { noLeidas, notificaciones, cargandoLista, panelAbierto, abrirPanel, cerrarPanel, marcarLeida, marcarTodas } = useNotificaciones();
  const anchorRef = useRef<HTMLButtonElement>(null);

  const handleClickNotificacion = async (n: Notificacion) => {
    if (!n.leida) await marcarLeida(n.id);
    const ruta = rutaDeNotificacion(n);
    cerrarPanel();
    if (ruta) navigate(ruta);
  };

  return (
    <>
      <Tooltip title="Notificaciones">
        <IconButton
          ref={anchorRef}
          size="small"
          aria-label="notificaciones"
          onClick={abrirPanel}
          sx={{
            bgcolor: mode === 'light' ? '#FFFFFF' : '#0F172A',
            border: '1px solid',
            borderColor: mode === 'light' ? '#EEF2F7' : '#334155',
            transition: 'all 220ms ease-in-out',
            '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 10px 24px rgba(15, 23, 42, 0.12)' }
          }}
        >
          <Badge badgeContent={noLeidas > 99 ? '99+' : noLeidas} color="secondary" invisible={noLeidas === 0}>
            <NotificationsNoneIcon fontSize="small" />
          </Badge>
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchorRef.current} open={panelAbierto} onClose={cerrarPanel} PaperProps={{ sx: { width: 380, maxHeight: 480, borderRadius: 2.5 } }}>
        <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Typography variant="subtitle2" fontWeight={800}>Notificaciones</Typography>
          {noLeidas > 0 && (
            <Button size="small" onClick={() => void marcarTodas()} sx={{ textTransform: 'none', fontSize: 11.5 }}>
              Marcar todas como leídas
            </Button>
          )}
        </Box>
        <Divider />
        {cargandoLista && notificaciones.length === 0 && (
          <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}><CircularProgress size={20} /></Box>
        )}
        {!cargandoLista && notificaciones.length === 0 && (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">No tienes notificaciones nuevas.</Typography>
          </Box>
        )}
        {notificaciones.map((n) => {
          const estilo = ESTILO_POR_TIPO[n.tipo] ?? { Icon: NotificationsNoneIcon, color: 'info' as const };
          const Icon = estilo.Icon;
          return (
            <MenuItem
              key={n.id}
              onClick={() => void handleClickNotificacion(n)}
              sx={{
                alignItems: 'flex-start', gap: 1.25, py: 1.25, whiteSpace: 'normal',
                bgcolor: n.leida ? 'transparent' : (mode === 'light' ? 'rgba(230,0,126,0.05)' : 'rgba(230,0,126,0.1)'),
                borderLeft: '3px solid', borderLeftColor: n.leida ? 'transparent' : 'secondary.main'
              }}
            >
              <Icon fontSize="small" color={estilo.color} sx={{ mt: 0.25, flexShrink: 0 }} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" fontWeight={n.leida ? 500 : 700} sx={{ lineHeight: 1.3 }}>{n.titulo}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{n.mensaje}</Typography>
                <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.25 }}>{formatearFecha(n.fechaCreacion)}</Typography>
              </Box>
              {!n.leida && <Chip label="Nueva" size="small" color="secondary" sx={{ height: 18, fontSize: 9.5, mt: 0.25, flexShrink: 0 }} />}
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
};

export default NotificationBell;
