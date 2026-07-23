import { useMemo, useState } from 'react';
import { Box } from '@mui/material';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
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

const PD_COLORS: Record<string, string> = {
  PD0: '#22C55E',
  PD1: '#16A34A',
  PD2: '#EAB308',
  PD3: '#F59E0B',
  PD4: '#F97316',
  PD5: '#EA580C',
  PD6: '#EF4444',
  PD7: '#B91C1C'
};

const getPdColor = (pd: string) => PD_COLORS[String(pd ?? '').toUpperCase()] ?? '#94A3B8';

const DashboardCharts = ({ pds, resumenPD, countrySummary }: DashboardChartsProps) => {
  const [donutDir, setDonutDir] = useState<'asc' | 'desc'>('asc');
  const [horizDir, setHorizDir] = useState<'asc' | 'desc'>('desc');
  const [lineDir, setLineDir] = useState<'asc' | 'desc'>('asc');
  const [comboDir, setComboDir] = useState<'asc' | 'desc'>('asc');
  const [areaDir, setAreaDir] = useState<'asc' | 'desc'>('asc');
  const [pdsDir, setPdsDir] = useState<'asc' | 'desc'>('asc');

  const sortByPd = (items: ResumenPdItem[], direction: 'asc' | 'desc') =>
    [...items].sort((a, b) => {
      const result = getPdIndex(a.pd) - getPdIndex(b.pd);
      return direction === 'asc' ? result : -result;
    });

  const donutData = useMemo(() => sortByPd(resumenPD, donutDir), [resumenPD, donutDir]);
  const lineData = useMemo(() => sortByPd(resumenPD, lineDir), [resumenPD, lineDir]);

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
      {/* 1 · Donut por PD */}
      <ChartCard
        title="Saldo actual por PD"
        subtitle="Distribución del saldo vigente"
        chartId="chart-donut-pd"
        fileBaseName="saldo-actual-por-pd"
        height={CHART_HEIGHT}
        sortDirection={donutDir}
        onSortAsc={() => setDonutDir('asc')}
        onSortDesc={() => setDonutDir('desc')}
        sortAscLabel="PD0 → PD7"
        sortDescLabel="PD7 → PD0"
        csvHeaders={['PD', 'Saldo Actual USD']}
        csvRows={donutData.map((item) => [item.pd, item.saldoActualUsd])}
      >
        {(height) => (
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Tooltip formatter={(value: number) => formatUsd(value)} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
              <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={legendStyle} />
              <Pie data={donutData} dataKey="saldoActualUsd" nameKey="pd" innerRadius="52%" outerRadius="78%" paddingAngle={2} cornerRadius={4}>
                {donutData.map((entry) => (
                  <Cell key={entry.pd} fill={getPdColor(entry.pd)} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 2 · Barras horizontales por país */}
      <ChartCard
        title="Saldo actual por país"
        subtitle="Comparativo de saldo vigente"
        chartId="chart-horiz-pais"
        fileBaseName="saldo-actual-por-pais"
        height={CHART_HEIGHT}
        sortDirection={horizDir}
        onSortAsc={() => setHorizDir('asc')}
        onSortDesc={() => setHorizDir('desc')}
        sortAscLabel="Menor a mayor"
        sortDescLabel="Mayor a menor"
        csvHeaders={['País', 'Saldo Actual USD']}
        csvRows={horizData.map((item) => [item.pais, item.saldoActualUsd])}
      >
        {(height) => (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={horizData} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
              <XAxis type="number" tickFormatter={formatCompact} tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="pais" width={112} tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value: number) => formatUsd(value)} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
              <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={legendStyle} />
              <Bar dataKey="saldoActualUsd" name="Saldo Actual USD" fill="#1E3A8A" radius={[0, 6, 6, 0]} barSize={14} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 3 · Línea de recuperación */}
      <ChartCard
        title="Recuperación por PD"
        subtitle="Porcentaje recuperado por nivel de riesgo"
        chartId="chart-line-pd"
        fileBaseName="recuperacion-por-pd"
        height={CHART_HEIGHT}
        sortDirection={lineDir}
        onSortAsc={() => setLineDir('asc')}
        onSortDesc={() => setLineDir('desc')}
        sortAscLabel="PD0 → PD7"
        sortDescLabel="PD7 → PD0"
        csvHeaders={['PD', '% Recuperación USD']}
        csvRows={lineData.map((item) => [item.pd, item.porcentajeRecuperacionUsd])}
      >
        {(height) => (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={lineData} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="pd" tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(value) => `${value}%`} tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value: number) => `${value.toFixed(2)}%`} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
              <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={legendStyle} />
              <Line type="monotone" dataKey="porcentajeRecuperacionUsd" name="% Recuperación" stroke="#1E3A8A" strokeWidth={2.5} dot={{ r: 3, fill: '#1E3A8A' }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 4 · Asignado vs Recuperado */}
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

      {/* 5 · Área acumulada */}
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

      {/* 6 · Barras por PD */}
      <ChartCard
        title="Riesgo por PD"
        subtitle="Exposición asignada USD y local"
        chartId="chart-pds"
        fileBaseName="riesgo-por-pd"
        height={CHART_HEIGHT}
        sortDirection={pdsDir}
        onSortAsc={() => setPdsDir('asc')}
        onSortDesc={() => setPdsDir('desc')}
        sortAscLabel="PD0 → PD7"
        sortDescLabel="PD7 → PD0"
        csvHeaders={['PD', 'Riesgo USD', 'Riesgo Local']}
        csvRows={barsPdData.map((item) => [item.nombre, item.totalUsd, item.totalLocal])}
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
              <Bar dataKey="totalLocal" name="Riesgo Local" fill="#0EA5E9" radius={[6, 6, 0, 0]} barSize={14} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </Box>
  );
};

export default DashboardCharts;
