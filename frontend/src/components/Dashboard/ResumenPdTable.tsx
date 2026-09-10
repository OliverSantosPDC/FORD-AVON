import { useMemo, useState } from 'react';
import { Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, Typography } from '@mui/material';
import type { ResumenPdItem } from '../../types/cartera';
import TableActionsMenu from '../common/TableActionsMenu';
import { copyRowsToClipboard, exportRowsToCsv, exportRowsToExcel } from '../../utils/tableExport';
import { getPdEstado, getPdIndex } from '../../utils/carteraAggregations';

interface ResumenPdTableProps {
  data: ResumenPdItem[];
  moneda: 'USD' | 'LOCAL';
  monedaCode: string;
}

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

const formatCurrency = (value: number, moneda: 'USD' | 'LOCAL', code: string) =>
  moneda === 'USD'
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${code}`;
const formatPercent = (value: number) => `${value.toFixed(2)}%`;

const ResumenPdTable = ({ data, moneda, monedaCode }: ResumenPdTableProps) => {
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [orderBy, setOrderBy] = useState<ColumnId>('pd');

  const getSortValue = (row: ResumenPdItem, columnId: ColumnId): number => {
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

  const getRowValue = (row: ResumenPdItem, columnId: ColumnId) => {
    switch (columnId) {
      case 'pd':
        return row.pd;
      case 'cuentas':
        return row.cuentas;
      case 'saldoInicial':
        return formatCurrency(moneda === 'USD' ? row.saldoAsignadoUsd : row.saldoAsignadoLocal, moneda, monedaCode);
      case 'recuperadoUsd':
        return formatCurrency(moneda === 'USD' ? row.recuperadoUsd : row.recuperadoLocal, moneda, monedaCode);
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
        <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>
          Resumen por PD
        </Typography>
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
