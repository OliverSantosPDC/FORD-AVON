import { Paper, Typography, Box, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import PersonIcon from '@mui/icons-material/Person';
import PercentIcon from '@mui/icons-material/Percent';
import type { DashboardKpi } from '../../types/cartera';

interface KpiCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  accent: string;
}

const KpiCard = ({ title, value, icon, accent }: KpiCardProps) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  return (
    <Paper
      sx={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 1.75,
        py: 1.25,
        height: 92,
        borderRadius: 2.5,
        overflow: 'hidden',
        background: isDark ? '#0F172A' : '#FFFFFF',
        border: '1px solid',
        borderColor: isDark ? alpha('#FFFFFF', 0.08) : alpha(accent, 0.18),
        boxShadow: isDark ? '0 10px 26px rgba(0, 0, 0, 0.22)' : `0 10px 26px ${alpha('#1E3A8A', 0.08)}`,
        transition: 'box-shadow 240ms ease, border-color 240ms ease',
        '&:hover': {
          boxShadow: isDark ? '0 14px 32px rgba(0, 0, 0, 0.28)' : `0 14px 32px ${alpha('#1E3A8A', 0.12)}`,
          borderColor: alpha(accent, 0.4)
        },
        // Iluminación animada muy sutil: sólo la capa de luz se mueve, nunca el dato.
        '&::after': {
          content: '""',
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(100deg, transparent 0%, ${alpha(accent, 0.1)} 50%, transparent 100%)`,
          transform: 'translateX(-100%)',
          animation: 'kpiSheen 7s ease-in-out infinite',
          pointerEvents: 'none'
        },
        '@keyframes kpiSheen': {
          '0%': { transform: 'translateX(-100%)' },
          '55%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(100%)' }
        }
      }}
    >
      {/* Franja de acento lateral: identifica el indicador sin robar altura. */}
      <Box sx={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', bgcolor: accent }} />

      <Box
        sx={{
          width: 40,
          height: 40,
          flexShrink: 0,
          borderRadius: 2,
          display: 'grid',
          placeItems: 'center',
          bgcolor: alpha(accent, 0.14),
          color: accent,
          position: 'relative',
          zIndex: 1,
          '& .MuiSvgIcon-root': { fontSize: 22 }
        }}
      >
        {icon}
      </Box>

      <Box sx={{ minWidth: 0, flex: 1, position: 'relative', zIndex: 1 }}>
        <Typography
          sx={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.7,
            textTransform: 'uppercase',
            color: 'text.secondary',
            lineHeight: 1.2,
            mb: 0.25,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {title}
        </Typography>
        <Typography
          title={value}
          sx={{
            fontSize: 'clamp(1.25rem, 1.35vw, 1.6rem)',
            fontWeight: 800,
            lineHeight: 1.15,
            color: isDark ? '#F8FAFC' : '#0F172A',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {value}
        </Typography>
      </Box>
    </Paper>
  );
};

interface KpiCardsProps {
  kpis: DashboardKpi;
}

const formatNumber = (value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const KpiCards = ({ kpis }: KpiCardsProps) => (
  <Box
    sx={{
      display: 'grid',
      gap: 2,
      gridTemplateColumns: {
        xs: '1fr',
        sm: 'repeat(2, minmax(0, 1fr))',
        md: 'repeat(3, minmax(0, 1fr))',
        lg: 'repeat(5, minmax(0, 1fr))'
      }
    }}
  >
    <KpiCard title="Saldo Asignado USD" value={formatNumber(kpis.saldoAsignado)} icon={<AccountBalanceWalletIcon />} accent="#1E3A8A" />
    <KpiCard title="Saldo Actual USD" value={formatNumber(kpis.saldoActual)} icon={<TrendingUpIcon />} accent="#0EA5E9" />
    <KpiCard title="Recuperado USD" value={formatNumber(kpis.recuperado)} icon={<PointOfSaleIcon />} accent="#22C55E" />
    <KpiCard title="% Recuperación" value={`${kpis.porcentajeRecuperacion.toFixed(2)}%`} icon={<PercentIcon />} accent="#E6007E" />
    <KpiCard title="Total Cuentas" value={kpis.totalCuentas.toLocaleString()} icon={<PersonIcon />} accent="#7C3AED" />
  </Box>
);

export default KpiCards;
