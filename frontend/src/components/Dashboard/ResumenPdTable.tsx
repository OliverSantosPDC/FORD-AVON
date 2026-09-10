import { useEffect, useMemo, useState } from 'react';
import { Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, Typography } from '@mui/material';
import type { CarteraRecord, DashboardFilterParams } from '../../types/cartera';
import { fetchCartera } from '../../services/carteraService';
import TableActionsMenu from '../common/TableActionsMenu';
import { copyRowsToClipboard, exportRowsToCsv, exportRowsToExcel } from '../../utils/tableExport';
import { getPdEstado, getPdIndex } from '../../utils/carteraAggregations';
import { simboloMoneda } from '../../utils/monedaOptions';

interface ResumenPdTableProps {
  filters: DashboardFilterParams;
  moneda: 'USD' | 'LOCAL';
  monedaCode: string;
}

interface PdRow {
  pd: string;
  cuentas: number;
  saldoAsignadoUsd: number;
  saldoActualUsd: number;
  recuperadoUsd: number;
  porcentajeRecuperacionUsd: number;
  saldoAsignadoLocal: number;
  saldoActualLocal: number;
  recuperadoLocal: number;
}

const PD_ORDER = ['PD0', 'PD1', 'PD2', 'PD3', 'PD4', 'PD5', 'PD6', 'PD7'];

const normalizePd = (value: unknown) => {
  const raw = String(value ?? '').trim().toUpperCase();
  const match = raw.match(/(?:PD|A)([0-7])/);
  return match ? `PD${match[1]}` : null;
};

type ColumnId =
  | 'pd'
  | 'cuentas'
  | 'saldoInicial'
  | 'recuperadoUsd'
  | 'porcentajeRecuperacionUsd';

const columns: { id: ColumnId; label: string; align: 'center'; width: number }[] = [
  { id: 'pd', label: 'PD', align: 'center', width: 44 },
  { id: 'cuentas', label: 'Total Cuentas', align: 'center', width: 92 },
  { id: 'saldoInicial', label: 'Saldo Inicial', align: 'center', width: 118 },
  { id: 'recuperadoUsd', label: 'Recuperado', align: 'center', width: 100 },
  { id: 'porcentajeRecuperacionUsd', label: '%', align: 'center', width: 56 }
];

const formatCurrency = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
const formatPercent = (value: number) => `${value.toFixed(2)}%`;

// Resumen agrupado por PD INICIAL (pd_inicial), calculado en el cliente a partir de la
// cartera completa (mismo patrón/fuente que "Movimiento de Cartera por PD"), ya que el
// resumen agregado por el backend agrupa por pd_actual.
const ResumenPdTable = ({ filters, moneda, monedaCode }: ResumenPdTableProps) => {
  const [cuentasRaw, setCuentasRaw] = useState<CarteraRecord[]>([]);
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [orderBy, setOrderBy] = useState<ColumnId>('pd');

  useEffect(() => {
    let active = true;
    fetchCartera(filters).then((data) => { if (active) setCuentasRaw(data); }).catch(() => { if (active) setCuentasRaw([]); });
    return () => { active = false; };
  }, [filters]);

  const data = useMemo<PdRow[]>(() => {
    const totals = new Map<string, { asignadoUsd: number; actualUsd: number; asignadoLocal: number; actualLocal: number; cuentas: number }>();
    cuentasRaw.forEach((row) => {
      const pdInicial = normalizePd(row.pd_inicial);
      if (!pdInicial) return;
      const asignadoUsd = Number(row.saldo_inicial_usd ?? 0);
      const actualUsd = Number(row.saldo_actual_usd ?? 0);
      const asignadoLocal = Number(row.saldo_inicial ?? 0);
      const actualLocal = Number(row.saldo_actual ?? 0);
      const existing = totals.get(pdInicial) ?? { asignadoUsd: 0, actualUsd: 0, asignadoLocal: 0, actualLocal: 0, cuentas: 0 };
      existing.asignadoUsd += Number.isFinite(asignadoUsd) ? asignadoUsd : 0;
      existing.actualUsd += Number.isFinite(actualUsd) ? actualUsd : 0;
      existing.asignadoLocal += Number.isFinite(asignadoLocal) ? asignadoLocal : 0;
      existing.actualLocal += Number.isFinite(actualLocal) ? actualLocal : 0;
      existing.cuentas += 1;
      totals.set(pdInicial, existing);
    });

    return PD_ORDER.filter((pd) => totals.has(pd)).map((pd) => {
      const values = totals.get(pd)!;
      const recuperadoUsd = values.asignadoUsd - values.actualUsd;
      const porcentajeRecuperacionUsd = values.asignadoUsd === 0 ? 0 : Number(((recuperadoUsd / values.asignadoUsd) * 100).toFixed(2));
      const recuperadoLocal = values.asignadoLocal - values.actualLocal;
      return {
        pd,
        cuentas: values.cuentas,
        saldoAsignadoUsd: values.asignadoUsd,
        saldoActualUsd: values.actualUsd,
        recuperadoUsd,
        porcentajeRecuperacionUsd,
        saldoAsignadoLocal: values.asignadoLocal,
        saldoActualLocal: values.actualLocal,
        recuperadoLocal
      };
    });
  }, [cuentasRaw]);

  const getSortValue = (row: PdRow, columnId: ColumnId): number => {
    switch (columnId) {
      case 'cuentas': return row.cuentas;
      case 'saldoInicial': return moneda === 'USD' ? row.saldoAsignadoUsd : row.saldoAsignadoLocal;
      case 'recuperadoUsd': return moneda === 'USD' ? row.recuperadoUsd : row.recuperadoLocal;
      case 'porcentajeRecuperacionUsd': return row.porcentajeRecuperacionUsd;
      default: return 0;
    }
  };

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      const result =
        orderBy === 'pd'
          ? getPdIndex(String(a.pd)) - getPdIndex(String(b.pd))
          : getSortValue(a, orderBy) - getSortValue(b, orderBy);
      return order === 'asc' ? result : -result;
    });
  }, [data, order, orderBy, moneda]);

  const visibleColumns = columns;

  const handleSort = (columnId: ColumnId) => {
    const isAsc = orderBy === columnId && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(columnId);
  };

  const getRowValue = (row: PdRow, columnId: ColumnId) => {
    switch (columnId) {
      case 'pd':
        return row.pd;
      case 'cuentas':
        return row.cuentas;
      case 'saldoInicial':
        return formatCurrency(moneda === 'USD' ? row.saldoAsignadoUsd : row.saldoAsignadoLocal);
      case 'recuperadoUsd':
        return formatCurrency(moneda === 'USD' ? row.recuperadoUsd : row.recuperadoLocal);
      case 'porcentajeRecuperacionUsd':
        return formatPercent(row.porcentajeRecuperacionUsd);
      default:
        return '';
    }
  };

  const buildExportRows = () => ({
    headers: visibleColumns.map((column) => column.label),
    rows: sortedData.map((row) => visibleColumns.map((column) => getRowValue(row, column.id)))
  });

  const handleExportCsv = () => {
    const { headers, rows } = buildExportRows();
    exportRowsToCsv('resumen-pd.csv', headers, rows);
  };

  const handleExportExcel = () => {
    const { headers, rows } = buildExportRows();
    exportRowsToExcel('resumen-pd.xls', 'Resumen PD', headers, rows);
  };

  const handleCopy = () => {
    const { headers, rows } = buildExportRows();
    void copyRowsToClipboard(headers, rows);
  };

  const simbolo = simboloMoneda(monedaCode);

  return (
    <Paper
      sx={{
        px: 2,
        py: 1.5,
        borderRadius: 2.5,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid',
        borderColor: 'divider',
        boxShadow: '0 10px 26px rgba(15, 23, 42, 0.06)',
        transition: 'box-shadow 220ms ease',
        '&:hover': { boxShadow: '0 14px 32px rgba(15, 23, 42, 0.1)' }
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, gap: 1, minHeight: 30 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.25 }}>
            Resumen por PD
          </Typography>
          <Typography sx={{ fontSize: 10.5, color: 'text.secondary', lineHeight: 1.2 }}>
            Moneda: {simbolo}
          </Typography>
        </Box>
        <TableActionsMenu
          onCopy={handleCopy}
          onExportCsv={handleExportCsv}
          onExportExcel={handleExportExcel}
        />
      </Box>
      <TableContainer
        sx={{
          overflowX: 'auto',
          overflowY: 'auto',
          flexGrow: 1,
          minHeight: 0,
          '&::-webkit-scrollbar': { height: 6, width: 6 },
          '&::-webkit-scrollbar-track': { background: 'transparent' },
          '&::-webkit-scrollbar-thumb': { background: '#C7CDD8', borderRadius: 99 }
        }}
      >
        <Table stickyHeader size="small" sx={{ width: '100%', tableLayout: 'fixed' }}>
          <TableHead>
            <TableRow>
              {visibleColumns.map((column) => (
                <TableCell
                  key={column.id}
                  align={column.align}
                  sortDirection={orderBy === column.id ? order : false}
                  sx={{ width: column.width, px: 1, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, py: 0.4, whiteSpace: 'nowrap', lineHeight: 1.15 }}
                >
                  <TableSortLabel active={orderBy === column.id} direction={orderBy === column.id ? order : 'asc'} onClick={() => handleSort(column.id)}>
                    {column.label}
                  </TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedData.map((row, index) => {
              const estado = getPdEstado(row.pd);
              return (
                <TableRow key={index} hover sx={{ transition: 'background-color 200ms ease-in-out' }}>
                  {visibleColumns.map((column) => {
                    if (column.id === 'pd') {
                      // El PD conserva el color de texto según su nivel de riesgo.
                      return (
                        <TableCell key={column.id} align={column.align} sx={{ width: column.width, px: 1, fontSize: 10.5, py: 0.3, whiteSpace: 'nowrap', lineHeight: 1.2, color: estado.color, fontWeight: 700 }}>
                          {row.pd}
                        </TableCell>
                      );
                    }
                    return (
                      <TableCell key={column.id} align={column.align} sx={{ width: column.width, px: 1, fontSize: 10.5, py: 0.3, whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                        {getRowValue(row, column.id)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};

export default ResumenPdTable;
