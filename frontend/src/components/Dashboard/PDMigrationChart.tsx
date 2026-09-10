import { useMemo } from 'react';
import { Sankey, Tooltip, ResponsiveContainer } from 'recharts';
import { Box } from '@mui/material';
import type { CarteraRecord } from '../../types/cartera';
import ChartCard from './ChartCard';

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

const normalizePd = (value: unknown) => {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return null;
  const match = raw.match(/(?:PD|A)([0-7])/);
  return match ? `PD${match[1]}` : raw.startsWith('PD') ? raw : null;
};

interface Props {
  cuentas: CarteraRecord[];
}

const PDMigrationChart = ({ cuentas }: Props) => {
  const { data, csvRows } = useMemo(() => {
    const flows = new Map<string, number>();
    for (const row of cuentas) {
      const inicial = normalizePd(row.pd_inicial);
      const actual = normalizePd(row.pd_actual);
      if (!inicial || !actual) continue;
      const saldo = Number(row.saldo_actual_usd ?? 0);
      if (!Number.isFinite(saldo) || saldo <= 0) continue;
      const key = `${inicial}|${actual}`;
      flows.set(key, (flows.get(key) ?? 0) + saldo);
    }

    const initialPds = Array.from(new Set(Array.from(flows.keys()).map((key) => key.split('|')[0]))).sort();
    const actualPds = Array.from(new Set(Array.from(flows.keys()).map((key) => key.split('|')[1]))).sort();
    const nodes = [
      ...initialPds.map((pd) => ({ name: `Inicial ${pd}`, pd, side: 'initial' })),
      ...actualPds.map((pd) => ({ name: `Actual ${pd}`, pd, side: 'actual' }))
    ];
    const initialIndex = new Map(initialPds.map((pd, index) => [pd, index]));
    const actualIndex = new Map(actualPds.map((pd, index) => [pd, initialPds.length + index]));
    const links = Array.from(flows.entries()).map(([key, value]) => {
      const [inicial, actual] = key.split('|');
      return { source: initialIndex.get(inicial)!, target: actualIndex.get(actual)!, value };
    });

    return {
      data: { nodes, links },
      csvRows: Array.from(flows.entries()).map(([key, value]) => {
        const [inicial, actual] = key.split('|');
        return [inicial, actual, value];
      })
    };
  }, [cuentas]);

  return (
    <ChartCard
      title="Movimiento de cartera por PD"
      subtitle="PD inicial → PD actual · saldo actual USD"
      chartId="chart-pd-migration"
      fileBaseName="movimiento-cartera-pd"
      height={240}
      csvHeaders={['PD Inicial', 'PD Actual', 'Saldo Actual USD']}
      csvRows={csvRows}
    >
      {(height) => (
        <ResponsiveContainer width="100%" height={height}>
          <Sankey
            data={data}
            nodePadding={8}
            nodeWidth={12}
            node={{ fill: '#64748B', stroke: '#FFFFFF', strokeWidth: 1 }}
            link={{ fill: 'none', stroke: '#CBD5E1', strokeOpacity: 0.55 }}
            sort={false}
            margin={{ top: 18, right: 50, bottom: 10, left: 50 }}
          >
            <Tooltip formatter={(value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
          </Sankey>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
};

export default PDMigrationChart;
