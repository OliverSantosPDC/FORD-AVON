import { useEffect, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import type { CarteraRecord, DashboardFilterParams } from '../../types/cartera';
import { fetchCartera } from '../../services/carteraService';
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
  filters: DashboardFilterParams;
}

interface Flow {
  inicial: string;
  actual: string;
  value: number;
}

const PDMigrationChart = ({ filters }: Props) => {
  const [cuentas, setCuentas] = useState<CarteraRecord[]>([]);

  useEffect(() => {
    let active = true;
    fetchCartera(filters)
      .then((data) => { if (active) setCuentas(data); })
      .catch(() => { if (active) setCuentas([]); });
    return () => { active = false; };
  }, [filters]);

  const { flows, totalsInitial, totalSaldo, csvRows } = useMemo(() => {
    const flowMap = new Map<string, number>();
    const initialMap = new Map<string, number>();

    for (const row of cuentas) {
      const inicial = normalizePd(row.pd_inicial);
      const actual = normalizePd(row.pd_actual);
      if (!inicial || !actual) continue;

      const saldo = Number(row.saldo_actual_usd ?? 0);
      if (!Number.isFinite(saldo) || saldo <= 0) continue;

      const key = `${inicial}|${actual}`;
      flowMap.set(key, (flowMap.get(key) ?? 0) + saldo);
      initialMap.set(inicial, (initialMap.get(inicial) ?? 0) + saldo);
    }

    const flowList: Flow[] = Array.from(flowMap.entries()).map(([key, value]) => {
      const [inicial, actual] = key.split('|');
      return { inicial, actual, value };
    });

    return {
      flows: flowList,
      totalsInitial: initialMap,
      totalSaldo: flowList.reduce((sum, flow) => sum + flow.value, 0),
      csvRows: flowList.map((flow) => [flow.inicial, flow.actual, flow.value])
    };
  }, [cuentas]);

  const chart = useMemo(() => {
    const width = 1000;
    const height = 250;
    const left = 28;
    const right = 28;
    const top = 55;
    const nodeY = 72;
    const nodeWidth = 20;
    const nodeHeight = 112;
    const baseY = nodeY + nodeHeight;
    const contentWidth = width - left - right;
    const visibleInitial = PD_ORDER.filter((pd) => (totalsInitial.get(pd) ?? 0) > 0);
    const groupWidth = visibleInitial.length > 0 ? contentWidth / visibleInitial.length : contentWidth;
    const barWidth = Math.min(9, Math.max(5, groupWidth / 10));
    const barGap = 4;
    const maxFlow = Math.max(...flows.map((flow) => flow.value), 0);
    const maxBarHeight = 66;

    const initialNodes = visibleInitial.map((pd, index) => ({
      pd,
      x: left + groupWidth * index + groupWidth / 2 - nodeWidth / 2,
      cx: left + groupWidth * index + groupWidth / 2,
      total: totalsInitial.get(pd) ?? 0
    }));

    const bars = initialNodes.flatMap((node) => {
      const groupFlows = flows
        .filter((flow) => flow.inicial === node.pd && flow.value > 0)
        .sort((a, b) => PD_ORDER.indexOf(a.actual) - PD_ORDER.indexOf(b.actual));

      const totalBarsWidth = groupFlows.length * barWidth + Math.max(0, groupFlows.length - 1) * barGap;
      const startX = node.cx - totalBarsWidth / 2;

      return groupFlows.map((flow, index) => {
        const barHeight = maxFlow > 0 ? Math.max(7, (flow.value / maxFlow) * maxBarHeight) : 0;
        return {
          ...flow,
          x: startX + index * (barWidth + barGap),
          y: baseY - barHeight,
          width: barWidth,
          height: barHeight
        };
      });
    });

    const braceStart = Math.max(10, initialNodes.length ? initialNodes[0].x - 10 : left);
    const braceEnd = Math.min(width - 10, initialNodes.length ? initialNodes[initialNodes.length - 1].x + nodeWidth + 10 : width - right);
    const braceMid = (braceStart + braceEnd) / 2;
    const bracePath = `M ${braceStart} 48 C ${braceStart} 39, ${braceStart} 38, ${braceStart + 2} 34 C ${braceStart + 5} 29, ${braceStart + 5} 29, ${braceStart + 5} 23 M ${braceStart + 5} 23 L ${braceMid - 5} 23 C ${braceMid - 3} 23, ${braceMid - 3} 23, ${braceMid - 3} 29 C ${braceMid - 3} 35, ${braceMid} 39, ${braceMid} 42 C ${braceMid} 39, ${braceMid + 3} 35, ${braceMid + 3} 29 C ${braceMid + 3} 23, ${braceMid + 3} 23, ${braceMid + 5} 23 L ${braceEnd - 5} 23 M ${braceEnd - 5} 23 C ${braceEnd - 5} 29, ${braceEnd - 5} 29, ${braceEnd - 2} 34 C ${braceEnd} 38, ${braceEnd} 39, ${braceEnd} 48`;

    return { width, height, nodeY, nodeWidth, nodeHeight, baseY, initialNodes, bars, bracePath };
  }, [flows, totalsInitial]);

  const money = (value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <ChartCard
      title="Movimiento de cartera por PD"
      subtitle="PD inicial → PD actual · saldo actual USD"
      chartId="chart-pd-migration"
      fileBaseName="movimiento-cartera-pd"
      height={270}
      csvHeaders={['PD Inicial', 'PD Actual', 'Saldo Actual USD']}
      csvRows={csvRows}
    >
      {() => (
        <Box sx={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
          <svg width="100%" height="100%" viewBox={`0 0 ${chart.width} ${chart.height}`} preserveAspectRatio="none" role="img" aria-label="Movimiento de cartera desde PD inicial hacia PD actual">
            <path d={chart.bracePath} fill="none" stroke="#0F567E" strokeWidth="1.5" strokeLinecap="round" />
            <text x={chart.width / 2} y="14" textAnchor="middle" fontSize="15" fontWeight="500" fill="currentColor">PD_INICIAL</text>

            {chart.initialNodes.map((node) => (
              <g key={`node-${node.pd}`}>
                <rect x={node.x} y={chart.nodeY} width={chart.nodeWidth} height={chart.nodeHeight} fill="#707070" stroke="#17384A" strokeWidth="1.5" />
                <text x={node.x + node.nodeWidth / 2} y={chart.nodeY + 34} textAnchor="middle" fontSize="14" fill="white">P</text>
                <text x={node.x + node.nodeWidth / 2} y={chart.nodeY + 53} textAnchor="middle" fontSize="14" fill="white">D</text>
                <text x={node.x + node.nodeWidth / 2} y={chart.nodeY + 78} textAnchor="middle" fontSize="15" fill="white">{node.pd.replace('PD', '')}</text>
              </g>
            ))}

            {chart.bars.map((bar) => (
              <rect
                key={`${bar.inicial}-${bar.actual}`}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                fill={PD_COLORS[bar.actual]}
                stroke="#17384A"
                strokeWidth="1.2"
              >
                <title>{`${bar.inicial} → ${bar.actual}: ${money(bar.value)}`}</title>
              </rect>
            ))}

            <text x={chart.width / 2} y="218" textAnchor="middle" fontSize="15" fontWeight="500" fill="currentColor">PD_ACTUAL</text>
          </svg>

          <Box sx={{ position: 'absolute', left: '50%', bottom: 2, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 1.2, whiteSpace: 'nowrap' }}>
            {PD_ORDER.map((pd) => (
              <Box key={pd} sx={{ display: 'flex', alignItems: 'center', gap: 0.35 }}>
                <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: PD_COLORS[pd] }} />
                <Typography sx={{ fontSize: 9.5, color: PD_COLORS[pd], fontWeight: 600 }}>{pd}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </ChartCard>
  );
};

export default PDMigrationChart;
