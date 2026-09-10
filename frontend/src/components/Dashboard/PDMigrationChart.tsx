import { useEffect, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { CarteraRecord, DashboardFilterParams } from '../../types/cartera';
import { fetchCartera } from '../../services/carteraService';
import ChartCard from './ChartCard';

const PD_COLORS: Record<string, string> = {
  PD0: '#22C55E', PD1: '#16A34A', PD2: '#EAB308', PD3: '#F59E0B',
  PD4: '#F97316', PD5: '#EA580C', PD6: '#EF4444', PD7: '#B91C1C'
};
const PD_ORDER = ['PD0', 'PD1', 'PD2', 'PD3', 'PD4', 'PD5', 'PD6', 'PD7'];

const normalizePd = (value: unknown) => {
  const raw = String(value ?? '').trim().toUpperCase();
  const match = raw.match(/(?:PD|A)([0-7])/);
  return match ? `PD${match[1]}` : null;
};

interface Props { filters: DashboardFilterParams; }
interface PivotRow { pdInicial: string; [key: string]: string | number; }
interface TooltipEntry { dataKey?: string | number; value?: string | number; }

const formatUsd = (value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const formatCompact = (value: number) => {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
};

const PDMigrationTooltip = ({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string | number }) => {
  if (!active || !payload?.length) return null;
  const entry = payload.find((item) => Number(item.value ?? 0) > 0) ?? payload[0];
  const actual = String(entry?.dataKey ?? '').toUpperCase();
  const value = Number(entry?.value ?? 0);

  return (
    <Box sx={{ borderRadius: 1.5, border: '1px solid #E2E8F0', boxShadow: '0 16px 40px rgba(15, 23, 42, 0.14)', backgroundColor: '#FFFFFF', px: 1.5, py: 1 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#0F172A', mb: 0.5 }}>PD Inicial: {label}</Typography>
      <Typography sx={{ fontSize: 12, color: '#475569' }}>PD Actual: {actual}</Typography>
      <Typography sx={{ fontSize: 12, color: '#475569' }}>Saldo actual USD: {formatUsd(value)}</Typography>
    </Box>
  );
};

const PDMigrationChart = ({ filters }: Props) => {
  const [cuentas, setCuentas] = useState<CarteraRecord[]>([]);

  useEffect(() => {
    let active = true;
    fetchCartera(filters).then((data) => { if (active) setCuentas(data); }).catch(() => { if (active) setCuentas([]); });
    return () => { active = false; };
  }, [filters]);

  const { chartData, activeSeries, totalSaldo, csvRows } = useMemo(() => {
    const flowMap = new Map<string, number>();
    cuentas.forEach((row) => {
      const inicial = normalizePd(row.pd_inicial);
      const actual = normalizePd(row.pd_actual);
      const saldo = Number(row.saldo_actual_usd ?? 0);
      if (!inicial || !actual || !Number.isFinite(saldo) || saldo <= 0) return;
      const key = `${inicial}|${actual}`;
      flowMap.set(key, (flowMap.get(key) ?? 0) + saldo);
    });

    const seriesSet = new Set<string>();
    const grouped = new Map<string, PivotRow>();
    PD_ORDER.forEach((pdInicial) => grouped.set(pdInicial, { pdInicial }));

    flowMap.forEach((value, key) => {
      const [pdInicial, pdActual] = key.split('|');
      const row = grouped.get(pdInicial);
      if (!row) return;
      row[pdActual] = value;
      seriesSet.add(pdActual);
    });

    const series = PD_ORDER.filter((pd) => seriesSet.has(pd));
    const rows = PD_ORDER.map((pdInicial) => {
      const row = grouped.get(pdInicial) ?? { pdInicial };
      series.forEach((pdActual) => { if (typeof row[pdActual] !== 'number') row[pdActual] = 0; });
      return row;
    });

    const flows = Array.from(flowMap.entries()).map(([key, value]) => {
      const [pdInicial, pdActual] = key.split('|');
      return [pdInicial, pdActual, value] as [string, string, number];
    }).sort((a, b) => {
      const initialDiff = PD_ORDER.indexOf(a[0]) - PD_ORDER.indexOf(b[0]);
      return initialDiff !== 0 ? initialDiff : PD_ORDER.indexOf(a[1]) - PD_ORDER.indexOf(b[1]);
    });

    return {
      chartData: rows,
      activeSeries: series,
      totalSaldo: flows.reduce((sum, [, , value]) => sum + value, 0),
      csvRows: flows
    };
  }, [cuentas]);

  return (
    <ChartCard title="Movimiento de cartera por PD" subtitle="PD inicial → PD actual · saldo actual USD" chartId="chart-pd-migration" fileBaseName="movimiento-cartera-pd" height={270} csvHeaders={['PD Inicial', 'PD Actual', 'Saldo Actual USD']} csvRows={csvRows}>
      {(height) => (
        <Box sx={{ width: '100%', height: '100%', position: 'relative' }}>
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="pdInicial" tick={{ fill: '#475569', fontSize: 10.5 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={formatCompact} tick={{ fill: '#475569', fontSize: 10.5 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'rgba(15, 23, 42, 0.04)' }} content={<PDMigrationTooltip />} />
              <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={{ paddingTop: 4, fontSize: 10.5, fontWeight: 600 }} />
              {activeSeries.map((pdActual) => (
                <Bar key={pdActual} dataKey={pdActual} name={pdActual} fill={PD_COLORS[pdActual]} radius={[4, 4, 0, 0]} barSize={14} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          {activeSeries.length === 0 && (
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <Typography sx={{ color: '#64748B', fontSize: 13 }}>No hay movimientos de cartera para los filtros seleccionados.</Typography>
            </Box>
          )}
          <Typography sx={{ textAlign: 'right', color: '#64748B', fontSize: 10.5, mt: -1 }}>Saldo trazado: {formatUsd(totalSaldo)}</Typography>
        </Box>
      )}
    </ChartCard>
  );
};

export default PDMigrationChart;
