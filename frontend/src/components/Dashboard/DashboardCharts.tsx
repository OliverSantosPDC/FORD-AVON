import { useMemo, useState, type ReactNode } from 'react';
import { Box } from '@mui/material';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { CountrySummary } from '../../types/cartera';
import ChartCard, { type ChartSortOption } from './ChartCard';

interface DashboardChartsProps {
  countrySummary: CountrySummary[];
  /** Fila 2 del grid, misma dimensión/patrón que los gráficos de la fila 1. */
  pdMigrationChart: ReactNode;
  zonaSector: ReactNode;
}

const CHART_HEIGHT = 240;

const tooltipContentStyle = {
  borderRadius: 12,
  border: '1px solid #E2E8F0',
  boxShadow: '0 16px 40px rgba(15, 23, 42, 0.14)',
  background: '#FFFFFF',
  padding: '8px 12px',
  fontSize: 12
};

const tooltipLabelStyle = { color: '#0F172A', fontWeight: 700, marginBottom: 2, fontSize: 12 };
const legendStyle = { paddingTop: 4, fontSize: 11, fontWeight: 600 };
const axisTick = { fill: '#475569', fontSize: 10.5 };

const formatUsd = (value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const formatCompact = (value: number) => {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
};

/** Compara alfabéticamente por país (usado como eje A-Z/Z-A en ambos gráficos de país). */
const byPaisNombre = (a: CountrySummary, b: CountrySummary) =>
  String(a.pais).localeCompare(String(b.pais), 'es', { sensitivity: 'base' });

type CountrySortKey = 'valor' | 'nombre';

const DashboardCharts = ({ countrySummary, pdMigrationChart, zonaSector }: DashboardChartsProps) => {
  const [horizSortKey, setHorizSortKey] = useState<CountrySortKey>('valor');
  const [horizSortDir, setHorizSortDir] = useState<'asc' | 'desc'>('desc');
  const [comboSortKey, setComboSortKey] = useState<CountrySortKey>('nombre');
  const [comboSortDir, setComboSortDir] = useState<'asc' | 'desc'>('asc');

  const horizData = useMemo(() => {
    return [...countrySummary].sort((a, b) => {
      const result = horizSortKey === 'nombre' ? byPaisNombre(a, b) : a.saldoActualUsd - b.saldoActualUsd;
      return horizSortDir === 'asc' ? result : -result;
    });
  }, [countrySummary, horizSortKey, horizSortDir]);

  const comboData = useMemo(() => {
    return [...countrySummary].sort((a, b) => {
      const result = comboSortKey === 'nombre' ? byPaisNombre(a, b) : a.saldoAsignadoUsd - b.saldoAsignadoUsd;
      return comboSortDir === 'asc' ? result : -result;
    });
  }, [countrySummary, comboSortKey, comboSortDir]);

  const horizSortOptions: ChartSortOption[] = [
    { id: 'menor-mayor', label: 'Menor a mayor', ascending: true, active: horizSortKey === 'valor' && horizSortDir === 'asc', onClick: () => { setHorizSortKey('valor'); setHorizSortDir('asc'); } },
    { id: 'mayor-menor', label: 'Mayor a menor', ascending: false, active: horizSortKey === 'valor' && horizSortDir === 'desc', onClick: () => { setHorizSortKey('valor'); setHorizSortDir('desc'); } },
    { id: 'az', label: 'A-Z', ascending: true, active: horizSortKey === 'nombre' && horizSortDir === 'asc', onClick: () => { setHorizSortKey('nombre'); setHorizSortDir('asc'); } },
    { id: 'za', label: 'Z-A', ascending: false, active: horizSortKey === 'nombre' && horizSortDir === 'desc', onClick: () => { setHorizSortKey('nombre'); setHorizSortDir('desc'); } }
  ];

  const comboSortOptions: ChartSortOption[] = [
    { id: 'menor-mayor', label: 'Menor a mayor', ascending: true, active: comboSortKey === 'valor' && comboSortDir === 'asc', onClick: () => { setComboSortKey('valor'); setComboSortDir('asc'); } },
    { id: 'mayor-menor', label: 'Mayor a menor', ascending: false, active: comboSortKey === 'valor' && comboSortDir === 'desc', onClick: () => { setComboSortKey('valor'); setComboSortDir('desc'); } },
    { id: 'az', label: 'A-Z', ascending: true, active: comboSortKey === 'nombre' && comboSortDir === 'asc', onClick: () => { setComboSortKey('nombre'); setComboSortDir('asc'); } },
    { id: 'za', label: 'Z-A', ascending: false, active: comboSortKey === 'nombre' && comboSortDir === 'desc', onClick: () => { setComboSortKey('nombre'); setComboSortDir('desc'); } }
  ];

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
        gridAutoRows: '1fr'
      }}
    >
      <ChartCard
        title="Saldo inicial y actual por país"
        subtitle="Comparativo de saldo inicial y saldo vigente"
        chartId="chart-horiz-pais-combo"
        fileBaseName="saldo-inicial-actual-por-pais"
        height={CHART_HEIGHT}
        sortOptions={horizSortOptions}
        csvHeaders={['País', 'Saldo Inicial USD', 'Saldo Actual USD']}
        csvRows={horizData.map((item) => [item.pais, item.saldoAsignadoUsd, item.saldoActualUsd])}
      >
        {(height) => (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={horizData} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
              <XAxis type="number" tickFormatter={formatCompact} tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="pais" width={112} tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value: number) => formatUsd(value)} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
              <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={legendStyle} />
              <Bar dataKey="saldoAsignadoUsd" name="Saldo Inicial USD" fill="#1E3A8A" radius={[0, 6, 6, 0]} barSize={10} />
              <Bar dataKey="saldoActualUsd" name="Saldo Actual USD" fill="#0EA5E9" radius={[0, 6, 6, 0]} barSize={10} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard
        title="Asignado vs Recuperado"
        subtitle="Comparativo por país"
        chartId="chart-combo-pais"
        fileBaseName="asignado-vs-recuperado"
        height={CHART_HEIGHT}
        sortOptions={comboSortOptions}
        csvHeaders={['País', 'Asignado USD', 'Recuperado USD']}
        csvRows={comboData.map((item) => [item.pais, item.saldoAsignadoUsd, item.recuperadoUsd])}
      >
        {(height) => (
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={comboData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="pais" tick={axisTick} axisLine={false} tickLine={false} interval={0} />
              <YAxis tickFormatter={formatCompact} tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value: number) => formatUsd(value)} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
              <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={legendStyle} />
              <Bar dataKey="saldoAsignadoUsd" name="Asignado" fill="#1E3A8A" radius={[6, 6, 0, 0]} barSize={18} />
              <Line type="monotone" dataKey="recuperadoUsd" name="Recuperado" stroke="#E6007E" strokeWidth={2.5} dot={{ r: 3, fill: '#E6007E' }} activeDot={{ r: 5 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {pdMigrationChart}
      {zonaSector}
    </Box>
  );
};

export default DashboardCharts;
