import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
import type { CarteraRecord, DashboardFilterParams } from '../../types/cartera';
import { fetchCartera } from '../../services/carteraService';
import { getCarteraField, carteraFieldKeys, resolveCountry } from '../../utils/carteraAggregations';
import ChartCard, { type ChartSortOption } from './ChartCard';

interface DashboardChartsProps {
  filters: DashboardFilterParams;
  moneda: 'USD' | 'LOCAL';
  monedaCode: string;
  /** Fila 2 del grid, misma dimensión/patrón que los gráficos de la fila 1. */
  pdMigrationChart: ReactNode;
  zonaSector: ReactNode;
}

interface PaisAgg {
  pais: string;
  asignadoUsd: number;
  actualUsd: number;
  asignadoLocal: number;
  actualLocal: number;
}

interface PaisRow {
  pais: string;
  asignado: number;
  actual: number;
  recuperado: number;
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

const formatUsd = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });
const formatCompact = (value: number) => {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return `${value}`;
};

/** Compara alfabéticamente por país (usado como eje A-Z/Z-A en ambos gráficos de país). */
const byPaisNombre = (a: PaisRow, b: PaisRow) =>
  String(a.pais).localeCompare(String(b.pais), 'es', { sensitivity: 'base' });

type CountrySortKey = 'valor' | 'nombre';

const DashboardCharts = ({ filters, moneda, monedaCode, pdMigrationChart, zonaSector }: DashboardChartsProps) => {
  const [cuentas, setCuentas] = useState<CarteraRecord[]>([]);
  const [horizSortKey, setHorizSortKey] = useState<CountrySortKey>('valor');
  const [horizSortDir, setHorizSortDir] = useState<'asc' | 'desc'>('desc');
  const [comboSortKey, setComboSortKey] = useState<CountrySortKey>('nombre');
  const [comboSortDir, setComboSortDir] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    let active = true;
    fetchCartera(filters).then((data) => { if (active) setCuentas(data); }).catch(() => { if (active) setCuentas([]); });
    return () => { active = false; };
  }, [filters]);

  // Totales Usd y Local por país, calculados en el cliente a partir de la cartera
  // completa (misma fuente/patrón que DashboardZonaSector y PDMigrationChart) para
  // poder ofrecer ambos importes sin depender del resumen agregado del backend
  // (CountrySummary), que sólo trae Usd.
  const paisSummary = useMemo(() => {
    const map = new Map<string, PaisAgg>();
    cuentas.forEach((row) => {
      const country = resolveCountry(getCarteraField(row, carteraFieldKeys.pais));
      if (!country) return;
      const asignadoUsd = Number(getCarteraField(row, carteraFieldKeys.saldoAsignadoUsd) ?? 0);
      const actualUsd = Number(getCarteraField(row, carteraFieldKeys.saldoActualUsd) ?? 0);
      const asignadoLocal = Number(getCarteraField(row, carteraFieldKeys.saldoAsignadoLocal) ?? 0);
      const actualLocal = Number(getCarteraField(row, carteraFieldKeys.saldoActualLocal) ?? 0);
      const existing = map.get(country.name) ?? { pais: country.name, asignadoUsd: 0, actualUsd: 0, asignadoLocal: 0, actualLocal: 0 };
      existing.asignadoUsd += Number.isFinite(asignadoUsd) ? asignadoUsd : 0;
      existing.actualUsd += Number.isFinite(actualUsd) ? actualUsd : 0;
      existing.asignadoLocal += Number.isFinite(asignadoLocal) ? asignadoLocal : 0;
      existing.actualLocal += Number.isFinite(actualLocal) ? actualLocal : 0;
      map.set(country.name, existing);
    });
    return Array.from(map.values());
  }, [cuentas]);

  // Resuelve los totales a la moneda actualmente seleccionada (misma fuente que KpiCards).
  const paisRows = useMemo<PaisRow[]>(() => paisSummary.map((p) => ({
    pais: p.pais,
    asignado: moneda === 'USD' ? p.asignadoUsd : p.asignadoLocal,
    actual: moneda === 'USD' ? p.actualUsd : p.actualLocal,
    recuperado: moneda === 'USD' ? p.asignadoUsd - p.actualUsd : p.asignadoLocal - p.actualLocal
  })), [paisSummary, moneda]);

  const horizData = useMemo(() => {
    return [...paisRows].sort((a, b) => {
      const result = horizSortKey === 'nombre' ? byPaisNombre(a, b) : a.actual - b.actual;
      return horizSortDir === 'asc' ? result : -result;
    });
  }, [paisRows, horizSortKey, horizSortDir]);

  const comboData = useMemo(() => {
    return [...paisRows].sort((a, b) => {
      const result = comboSortKey === 'nombre' ? byPaisNombre(a, b) : a.asignado - b.asignado;
      return comboSortDir === 'asc' ? result : -result;
    });
  }, [paisRows, comboSortKey, comboSortDir]);

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

  const monedaLabel = moneda === 'USD' ? 'USD' : monedaCode;

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
        title="SALDO INICIAL Y ACTUAL POR PAÍS"
        subtitle="Comparativo de saldo inicial y saldo vigente"
        chartId="chart-horiz-pais-combo"
        fileBaseName="saldo-inicial-actual-por-pais"
        height={CHART_HEIGHT}
        sortOptions={horizSortOptions}
        csvHeaders={['País', `Saldo Inicial ${monedaLabel}`, `Saldo Actual ${monedaLabel}`]}
        csvRows={horizData.map((item) => [item.pais, item.asignado, item.actual])}
      >
        {(height) => (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={horizData} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
              <XAxis type="number" tickFormatter={formatCompact} tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="pais" width={112} tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value: number) => formatUsd(value)} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
              <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={legendStyle} />
              <Bar dataKey="asignado" name="Saldo Inicial" fill="#1E3A8A" radius={[0, 6, 6, 0]} barSize={10} />
              <Bar dataKey="actual" name="Saldo Actual" fill="#0EA5E9" radius={[0, 6, 6, 0]} barSize={10} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard
        title="INICIAL VS RECUPERADO"
        subtitle="Comparativo por país"
        chartId="chart-combo-pais"
        fileBaseName="asignado-vs-recuperado"
        height={CHART_HEIGHT}
        sortOptions={comboSortOptions}
        csvHeaders={['País', `Inicial ${monedaLabel}`, `Recuperado ${monedaLabel}`]}
        csvRows={comboData.map((item) => [item.pais, item.asignado, item.recuperado])}
      >
        {(height) => (
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={comboData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="pais" tick={axisTick} axisLine={false} tickLine={false} interval={0} />
              <YAxis tickFormatter={formatCompact} tick={axisTick} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value: number) => formatUsd(value)} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
              <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={legendStyle} />
              <Bar dataKey="asignado" name="Inicial" fill="#1E3A8A" radius={[6, 6, 0, 0]} barSize={18} />
              <Line type="monotone" dataKey="recuperado" name="Recuperado" stroke="#E6007E" strokeWidth={2.5} dot={{ r: 3, fill: '#E6007E' }} activeDot={{ r: 5 }} />
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
