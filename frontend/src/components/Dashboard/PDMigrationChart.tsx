import { useMemo } from 'react';
import { Box, Typography } from '@mui/material';
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

const PD_ORDER = ['PD0', 'PD1', 'PD2', 'PD3', 'PD4', 'PD5', 'PD6', 'PD7'];

const normalizePd = (value: unknown) => {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return null;
  const match = raw.match(/(?:PD|A)([0-7])/);
  return match ? `PD${match[1]}` : null;
};

interface Props {
  cuentas: CarteraRecord[];
}

interface Flow {
  inicial: string;
  actual: string;
  value: number;
}

const PDMigrationChart = ({ cuentas }: Props) => {
  const { flows, totalsInitial, totalsActual, totalSaldo, csvRows } = useMemo(() => {
    const flowMap = new Map<string, number>();
    const initialMap = new Map<string, number>();
    const actualMap = new Map<string, number>();

    for (const row of cuentas) {
      const inicial = normalizePd(row.pd_inicial);
      const actual = normalizePd(row.pd_actual);
      if (!inicial || !actual) continue;

      const saldo = Number(row.saldo_actual_usd ?? 0);
      if (!Number.isFinite(saldo) || saldo <= 0) continue;

      const key = `${inicial}|${actual}`;
      flowMap.set(key, (flowMap.get(key) ?? 0) + saldo);
      initialMap.set(inicial, (initialMap.get(inicial) ?? 0) + saldo);
      actualMap.set(actual, (actualMap.get(actual) ?? 0) + saldo);
    }

    const flowList: Flow[] = Array.from(flowMap.entries()).map(([key, value]) => {
      const [inicial, actual] = key.split('|');
      return { inicial, actual, value };
    });

    return {
      flows: flowList,
      totalsInitial: initialMap,
      totalsActual: actualMap,
      totalSaldo: flowList.reduce((sum, flow) => sum + flow.value, 0),
      csvRows: flowList.map((flow) => [flow.inicial, flow.actual, flow.value])
    };
  }, [cuentas]);

  const chart = useMemo(() => {
    const width = 1000;
    const height = 220;
    const nodeWidth = 14;
    const leftX = 130;
    const rightX = 856;
    const top = 26;
    const bottom = 190;
    const gap = 3;
    const usableHeight = bottom - top;
    const visibleInitial = PD_ORDER.filter((pd) => (totalsInitial.get(pd) ?? 0) > 0);
    const visibleActual = PD_ORDER.filter((pd) => (totalsActual.get(pd) ?? 0) > 0);
    const maxCount = Math.max(visibleInitial.length, visibleActual.length, 1);
    const scale = Math.max(0.12, (usableHeight - gap * (maxCount - 1)) / Math.max(totalSaldo, 1));

    const buildNodes = (pds: string[], totals: Map<string, number>) => {
      let y = top;
      const nodes = new Map<string, { y: number; height: number }>();
      for (const pd of pds) {
        const heightValue = Math.max(7, (totals.get(pd) ?? 0) * scale);
        nodes.set(pd, { y, height: heightValue });
        y += heightValue + gap;
      }
      return nodes;
    };

    const initialNodes = buildNodes(visibleInitial, totalsInitial);
    const actualNodes = buildNodes(visibleActual, totalsActual);
    const sourceOffsets = new Map<string, number>();
    const targetOffsets = new Map<string, number>();

    const sortedFlows = [...flows].sort((a, b) => PD_ORDER.indexOf(a.inicial) - PD_ORDER.indexOf(b.inicial) || PD_ORDER.indexOf(a.actual) - PD_ORDER.indexOf(b.actual));
    const ribbons = sortedFlows.map((flow) => {
      const source = initialNodes.get(flow.inicial);
      const target = actualNodes.get(flow.actual);
      if (!source || !target) return null;

      const thickness = Math.max(1.5, flow.value * scale);
      const sourceOffset = sourceOffsets.get(flow.inicial) ?? 0;
      const targetOffset = targetOffsets.get(flow.actual) ?? 0;
      const sy0 = source.y + sourceOffset;
      const sy1 = sy0 + thickness;
      const ty0 = target.y + targetOffset;
      const ty1 = ty0 + thickness;
      sourceOffsets.set(flow.inicial, sourceOffset + thickness);
      targetOffsets.set(flow.actual, targetOffset + thickness);

      const c1 = leftX + 230;
      const c2 = rightX - 230;
      const path = `M ${leftX + nodeWidth} ${sy0} C ${c1} ${sy0}, ${c2} ${ty0}, ${rightX} ${ty0} L ${rightX} ${ty1} C ${c2} ${ty1}, ${c1} ${sy1}, ${leftX + nodeWidth} ${sy1} Z`;
      return { ...flow, path };
    }).filter(Boolean) as Array<Flow & { path: string }>;

    return { width, height, leftX, rightX, nodeWidth, initialNodes, actualNodes, visibleInitial, visibleActual, ribbons };
  }, [flows, totalsInitial, totalsActual, totalSaldo]);

  const money = (value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

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
      {() => (
        <Box sx={{ width: '100%', height: '100%', position: 'relative' }}>
          <svg width="100%" height="100%" viewBox={`0 0 ${chart.width} ${chart.height}`} preserveAspectRatio="none" role="img" aria-label="Movimiento de cartera desde PD inicial hacia PD actual">
            <text x="130" y="15" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">PD INICIAL</text>
            <text x="856" y="15" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">PD ACTUAL</text>

            {chart.ribbons.map((ribbon) => (
              <path key={`${ribbon.inicial}-${ribbon.actual}`} d={ribbon.path} fill={PD_COLORS[ribbon.actual]} fillOpacity="0.24" stroke="none" />
            ))}

            {chart.visibleInitial.map((pd) => {
              const node = chart.initialNodes.get(pd)!;
              return <rect key={`initial-${pd}`} x={chart.leftX} y={node.y} width={chart.nodeWidth} height={node.height} rx="2" fill={PD_COLORS[pd]} />;
            })}
            {chart.visibleActual.map((pd) => {
              const node = chart.actualNodes.get(pd)!;
              return <rect key={`actual-${pd}`} x={chart.rightX} y={node.y} width={chart.nodeWidth} height={node.height} rx="2" fill={PD_COLORS[pd]} />;
            })}

            {chart.visibleInitial.map((pd) => {
              const node = chart.initialNodes.get(pd)!;
              return <text key={`label-initial-${pd}`} x={chart.leftX - 10} y={node.y + node.height / 2 + 3} textAnchor="end" fontSize="10" fill="currentColor">{pd}</text>;
            })}
            {chart.visibleActual.map((pd) => {
              const node = chart.actualNodes.get(pd)!;
              return <text key={`label-actual-${pd}`} x={chart.rightX + chart.nodeWidth + 10} y={node.y + node.height / 2 + 3} fontSize="10" fill="currentColor">{pd}</text>;
            })}
          </svg>

          <Box sx={{ position: 'absolute', left: '50%', bottom: 0, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 1.25, whiteSpace: 'nowrap' }}>
            <Typography sx={{ fontSize: 9.5, color: 'text.secondary' }}>Saldo trazado: {money(totalSaldo)}</Typography>
            <Box sx={{ display: 'flex', gap: 0.75 }}>
              {PD_ORDER.map((pd) => <Box key={pd} sx={{ display: 'flex', alignItems: 'center', gap: 0.35 }}><Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: PD_COLORS[pd] }} /><Typography sx={{ fontSize: 8.5 }}>{pd}</Typography></Box>)}
            </Box>
          </Box>
        </Box>
      )}
    </ChartCard>
  );
};

export default PDMigrationChart;
