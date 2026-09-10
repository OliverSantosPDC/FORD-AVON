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
import { simboloMoneda } from '../../utils/monedaOptions';
import ChartCard, { type ChartSortOption } from './ChartCard';

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

interface Props { filters: DashboardFilterParams; moneda: 'USD' | 'LOCAL'; monedaCode: string; }
interface PivotRow { pdActual: string; [key: string]: string | number; }
interface PdActualDetalle { pdActual: string; saldo: number; cuentas: number; }
interface SeriesSummary { pdInicial: string; totalSaldo: number; totalCuentas: number; detalle: PdActualDetalle[]; }

const formatUsd = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });
const formatCompact = (value: number) => {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return `${value}`;
};

const PDMigrationTooltip = ({
  active,
  label,
  seriesSummary,
  monedaLabel
}: {
  active?: boolean;
  label?: string | number;
  seriesSummary: Map<string, SeriesSummary>;
  monedaLabel: string;
}) => {
  if (!active || label === undefined) return null;
  const summary = seriesSummary.get(String(label));
  if (!summary) return null;

  return (
    <Box sx={{ borderRadius: 1.5, border: '1px solid #E2E8F0', boxShadow: '0 16px 40px rgba(15, 23, 42, 0.14)', backgroundColor: '#FFFFFF', px: 1.5, py: 1, minWidth: 200 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 700, color: '#0F172A', mb: 0.25 }}>PD Inicial: {summary.pdInicial}</Typography>
      <Typography sx={{ fontSize: 12, color: '#475569' }}>Saldo Inicial Total: {formatUsd(summary.totalSaldo)} {monedaLabel}</Typography>
      <Typography sx={{ fontSize: 12, color: '#475569', mb: 0.5 }}>Total Cuentas: {summary.totalCuentas.toLocaleString()}</Typography>
      <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#0F172A', mb: 0.25 }}>PD Actual y Saldo Inicial:</Typography>
      {summary.detalle.map((d) => (
        <Typography key={d.pdActual} sx={{ fontSize: 11, color: '#475569' }}>
          {d.pdActual}: {formatUsd(d.saldo)} {monedaLabel} · Cuentas: {d.cuentas.toLocaleString()}
        </Typography>
      ))}
    </Box>
  );
};

type PdSortKey = 'pd' | 'valor';

const PDMigrationChart = ({ filters, moneda, monedaCode }: Props) => {
  const [cuentas, setCuentas] = useState<CarteraRecord[]>([]);
  const [sortKey, setSortKey] = useState<PdSortKey>('pd');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    let active = true;
    fetchCartera(filters).then((data) => { if (active) setCuentas(data); }).catch(() => { if (active) setCuentas([]); });
    return () => { active = false; };
  }, [filters]);

  const { chartData, activeSeries, totalSaldo, csvRows, seriesSummary } = useMemo(() => {
    const flowMap = new Map<string, number>();
    const countMap = new Map<string, number>();
    cuentas.forEach((row) => {
      const inicial = normalizePd(row.pd_inicial);
      const actual = normalizePd(row.pd_actual);
      const saldo = Number((moneda === 'USD' ? row.saldo_inicial_usd : row.saldo_inicial) ?? 0);
      if (!inicial || !actual || !Number.isFinite(saldo) || saldo <= 0) return;
      const key = `${inicial}|${actual}`;
      flowMap.set(key, (flowMap.get(key) ?? 0) + saldo);
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
    });

    const summaryMap = new Map<string, SeriesSummary>();
    PD_ORDER.forEach((pdInicial) => {
      const detalle: PdActualDetalle[] = [];
      let totalSaldo = 0;
      let totalCuentas = 0;
      PD_ORDER.forEach((pdActual) => {
        const key = `${pdInicial}|${pdActual}`;
        const saldo = flowMap.get(key) ?? 0;
        const cnt = countMap.get(key) ?? 0;
        if (saldo <= 0 && cnt <= 0) return;
        detalle.push({ pdActual, saldo, cuentas: cnt });
        totalSaldo += saldo;
        totalCuentas += cnt;
      });
      summaryMap.set(pdInicial, { pdInicial, totalSaldo, totalCuentas, detalle });
    });

    const seriesSet = new Set<string>();
    const grouped = new Map<string, PivotRow>();
    PD_ORDER.forEach((pdActual) => grouped.set(pdActual, { pdActual }));

    flowMap.forEach((value, key) => {
      const [pdInicial, pdActual] = key.split('|');
      const row = grouped.get(pdActual);
      if (!row) return;
      row[pdInicial] = value;
      seriesSet.add(pdInicial);
    });

    const series = PD_ORDER.filter((pd) => seriesSet.has(pd));
    const unorderedRows = PD_ORDER.map((pdActual) => {
      const row = grouped.get(pdActual) ?? { pdActual };
      series.forEach((pdInicial) => { if (typeof row[pdInicial] !== 'number') row[pdInicial] = 0; });
      return row;
    });

    const rowTotal = (row: PivotRow) =>
      Object.entries(row).reduce((sum, [key, value]) => (key === 'pdActual' || typeof value !== 'number' ? sum : sum + value), 0);

    const rows = [...unorderedRows].sort((a, b) => {
      const result = sortKey === 'valor' ? rowTotal(a) - rowTotal(b) : PD_ORDER.indexOf(a.pdActual) - PD_ORDER.indexOf(b.pdActual);
      return sortDir === 'asc' ? result : -result;
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
      csvRows: flows,
      seriesSummary: summaryMap
    };
  }, [cuentas, sortKey, sortDir, moneda]);

  const monedaLabel = simboloMoneda(monedaCode);

  const sortOptions: ChartSortOption[] = [
    { id: 'menor-mayor', label: 'Menor a mayor', ascending: true, active: sortKey === 'valor' && sortDir === 'asc', onClick: () => { setSortKey('valor'); setSortDir('asc'); } },
    { id: 'mayor-menor', label: 'Mayor a menor', ascending: false, active: sortKey === 'valor' && sortDir === 'desc', onClick: () => { setSortKey('valor'); setSortDir('desc'); } },
    { id: 'az', label: 'A-Z (PD0 → PD7)', ascending: true, active: sortKey === 'pd' && sortDir === 'asc', onClick: () => { setSortKey('pd'); setSortDir('asc'); } },
    { id: 'za', label: 'Z-A (PD7 → PD0)', ascending: false, active: sortKey === 'pd' && sortDir === 'desc', onClick: () => { setSortKey('pd'); setSortDir('desc'); } }
  ];

  return (
    <ChartCard title="MOVIMIENTO DE CARTERA POR PD" subtitle="PD actual → PD inicial · saldo inicial" chartId="chart-pd-migration" fileBaseName="movimiento-cartera-pd" height={240} sortOptions={sortOptions} csvHeaders={['PD Inicial', 'PD Actual', `Saldo Inicial ${monedaLabel}`]} csvRows={csvRows}>
      {(height) => (
        <Box sx={{ width: '100%', height: '100%', position: 'relative' }}>
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="pdActual" tick={{ fill: '#475569', fontSize: 10.5 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={formatCompact} tick={{ fill: '#475569', fontSize: 10.5 }} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: 'rgba(15, 23, 42, 0.04)' }}
                content={<PDMigrationTooltip seriesSummary={seriesSummary} monedaLabel={monedaLabel} />}
              />
              <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={{ paddingTop: 4, fontSize: 10.5, fontWeight: 600 }} />
              {activeSeries.map((pdInicial) => (
                <Bar key={pdInicial} dataKey={pdInicial} name={pdInicial} fill={PD_COLORS[pdInicial]} radius={[4, 4, 0, 0]} barSize={14} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          {activeSeries.length === 0 && (
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <Typography sx={{ color: '#64748B', fontSize: 13 }}>No hay movimientos de cartera para los filtros seleccionados.</Typography>
            </Box>
          )}
          <Typography sx={{ textAlign: 'right', color: '#64748B', fontSize: 10.5, mt: -1 }}>Saldo trazado: {formatUsd(totalSaldo)} {monedaLabel}</Typography>
        </Box>
      )}
    </ChartCard>
  );
};

export default PDMigrationChart;
