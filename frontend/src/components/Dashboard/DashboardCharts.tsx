import { useMemo, useState, type ReactNode } from 'react';
import { Box } from '@mui/material';
import {
  Area,
  AreaChart,
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
import type { CountrySummary, DashboardItem, ResumenPdItem } from '../../types/cartera';
import { getPdIndex } from '../../utils/carteraAggregations';
import ChartCard from './ChartCard';

interface DashboardChartsProps {
  pds: DashboardItem[];
  resumenPD: ResumenPdItem[];
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

const DashboardCharts = ({ pds, resumenPD, countrySummary, pdMigrationChart, zonaSector }: DashboardChartsProps) => {
  const [horizDir, setHorizDir] = useState<'asc' | 'desc'>('desc');
  const [comboDir, setComboDir] = useState<'asc' | 'desc'>('asc');
  const [areaDir, setAreaDir] = useState<'asc' | 'desc'>('asc');
  const [pdsDir, setPdsDir] = useState<'asc' | 'desc'>('asc');

  const sortByPd = (items: ResumenPdItem[], direction: 'asc' | 'desc') =>
    [...items].sort((a, b) => {
      const result = getPdIndex(a.pd) - getPdIndex(b.pd);
      return direction === 'asc' ? result : -result;
    });

  const horizData = useMemo(() => {
    return [...countrySummary].sort((a, b) => {
      const result = a.saldoActualUsd - b.saldoActualUsd;
      return horizDir === 'asc' ? result : -result;
    });
  }, [countrySummary, horizDir]);

  const comboData = useMemo(() => {
    return [...countrySummary].sort((a, b) => {
      const result = String(a.pais).localeCompare(String(b.pais), 'es', { sensitivity: 'base' });
      return comboDir === 'asc' ? result : -result;
    });
  }, [countrySummary, comboDir]);

  const areaData = useMemo(() => {
    const ordered = sortByPd(resumenPD, areaDir);
    let running = 0;
    return ordered.map((item) => {
      running += item.saldoAsignadoUsd;
      return { pd: item.pd, acumuladoUsd: running };
    });
  }, [resumenPD, areaDir]);

  const barsPdData = useMemo(() => {
    return [...pds].sort((a, b) => {
      const result = getPdIndex(a.nombre) - getPdIndex(b.nombre);
      return pdsDir === 'asc' ? result : -result;
    });
  }, [pds, pdsDir]);

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
        sortDirection={horizDir}
        onSortAsc={() => setHorizDir('asc')}
        onSortDesc={() => setHorizDir('desc')}
        sortAscLabel="Menor a mayor"
        sortDescLabel="Mayor a menor"
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
        sortDirection={comboDir}
        onSortAsc={() => setComboDir('asc')}
        onSortDesc={() => setComboDir('desc')}
        sortAscLabel="Ordenar A-Z"
        sortDescLabel="Ordenar Z-A"
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

      <ChartCard
        title="Saldo acumulado por PD"
        subtitle="Exposición acumulada en orden de riesgo"
        chartId="chart-area-pd"
        fileBaseName="saldo-acumulado-por-pd"
        height={CHART_HEIGHT}
        sortDirection={areaDir}
        onSortAsc={() => setAreaDir('asc')}
        onSortDesc={() => setAreaDir('desc')}
        sortAscLabel="PD0 → PD7"
        sortDescLabel="PD7 → PD0"
        csvHeaders={['PD', 'Saldo Asignado Acumulado USD']}
        csvRows={areaData.map((item) => [item.pd, item.acumuladoUsd])}
      >
        {(height) => (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={areaData} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="areaAcumuladoGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0EA5E9" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#0EA5E9" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="pd" tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={formatCompact} tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value: number) => formatUsd(value)} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
              <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={legendStyle} />
              <Area type="monotone" dataKey="acumuladoUsd" name="Acumulado USD" stroke="#0EA5E9" fill="url(#areaAcumuladoGradient)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard
        title="Riesgo por PD"
        subtitle="Exposición asignada USD"
        chartId="chart-pds"
        fileBaseName="riesgo-por-pd"
        height={CHART_HEIGHT}
        sortDirection={pdsDir}
        onSortAsc={() => setPdsDir('asc')}
        onSortDesc={() => setPdsDir('desc')}
        sortAscLabel="PD0 → PD7"
        sortDescLabel="PD7 → PD0"
        csvHeaders={['PD', 'Riesgo USD']}
        csvRows={barsPdData.map((item) => [item.nombre, item.totalUsd])}
      >
        {(height) => (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={barsPdData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barCategoryGap="24%">
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="nombre" tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={formatCompact} tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value: number) => formatUsd(value)} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
              <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={legendStyle} />
              <Bar dataKey="totalUsd" name="Riesgo USD" fill="#E6007E" radius={[6, 6, 0, 0]} barSize={14} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </Box>
  );
};

export default DashboardCharts;
