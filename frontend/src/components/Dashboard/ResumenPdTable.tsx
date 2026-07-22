import { useMemo, useState } from 'react';
import { Box, Chip, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import type { ResumenPdItem } from '../../types/cartera';
import TableActionsMenu from '../common/TableActionsMenu';
import { copyRowsToClipboard, exportRowsToCsv, exportRowsToExcel } from '../../utils/tableExport';
import { getPdEstado, getPdIndex } from '../../utils/carteraAggregations';

interface ResumenPdTableProps {
  data: ResumenPdItem[];
}

type ColumnId =
  | 'pd'
  | 'estado'
  | 'cuentas'
  | 'saldoActualUsd'
  | 'saldoActualLocal'
  | 'recuperadoUsd'
  | 'recuperadoLocal'
  | 'porcentajeRecuperacionUsd'
  | 'porcentajeRecuperacionLocal';

const columns: { id: ColumnId; label: string; align?: 'right' }[] = [
  { id: 'pd', label: 'PD' },
  { id: 'estado', label: 'Estado' },
  { id: 'cuentas', label: 'Cuentas', align: 'right' },
  { id: 'saldoActualUsd', label: 'Saldo USD', align: 'right' },
  { id: 'saldoActualLocal', label: 'Saldo Local', align: 'right' },
  { id: 'recuperadoUsd', label: 'Recuperado USD', align: 'right' },
  { id: 'recuperadoLocal', label: 'Recuperado Local', align: 'right' },
  { id: 'porcentajeRecuperacionUsd', label: '% USD', align: 'right' },
  { id: 'porcentajeRecuperacionLocal', label: '% Local', align: 'right' }
];

const formatCurrency = (value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const formatPercent = (value: number) => `${value.toFixed(2)}%`;

const ResumenPdTable = ({ data }: ResumenPdTableProps) => {
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);

  const sortedData = useMemo(() => {
    const withIndex = data.map((row, index) => ({ row, index, pdIndex: getPdIndex(String(row.pd)) }));
    withIndex.sort((a, b) => {
      const result = a.pdIndex - b.pdIndex || a.index - b.index;
      return order === 'asc' ? result : -result;
    });
    return withIndex.map((entry) => entry.row);
  }, [data, order]);

  const visibleColumns = columns.filter((column) => !hiddenColumns.includes(column.id));

  const toggleColumn = (id: string) => {
    setHiddenColumns((prev) => (prev.includes(id) ? prev.filter((columnId) => columnId !== id) : [...prev, id]));
  };

  const getRowValue = (row: ResumenPdItem, columnId: ColumnId) => {
    switch (columnId) {
      case 'pd':
        return row.pd;
      case 'estado':
        return `${getPdEstado(row.pd).dot} ${getPdEstado(row.pd).label}`;
      case 'cuentas':
        return row.cuentas;
      case 'saldoActualUsd':
        return formatCurrency(row.saldoActualUsd);
      case 'saldoActualLocal':
        return formatCurrency(row.saldoActualLocal);
      case 'recuperadoUsd':
        return formatCurrency(row.recuperadoUsd);
      case 'recuperadoLocal':
        return formatCurrency(row.recuperadoLocal);
      case 'porcentajeRecuperacionUsd':
        return formatPercent(row.porcentajeRecuperacionUsd);
      case 'porcentajeRecuperacionLocal':
        return formatPercent(row.porcentajeRecuperacionLocal);
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
          columns={columns.map((column) => ({ id: column.id, label: column.label }))}
          hiddenColumns={hiddenColumns}
          onToggleColumn={toggleColumn}
          onCopy={handleCopy}
          onExportCsv={handleExportCsv}
          onExportExcel={handleExportExcel}
          onToggleSort={() => setOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
          sortLabel={order === 'asc' ? 'Orden: PD0 → PD7 (invertir a PD7 → PD0)' : 'Orden: PD7 → PD0 (invertir a PD0 → PD7)'}
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
        <Table stickyHeader size="small" sx={{ minWidth: 760 }}>
          <TableHead>
            <TableRow>
              {visibleColumns.map((column) => (
                <TableCell
                  key={column.id}
                  align={column.align}
                  sx={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, py: 0.75, whiteSpace: 'nowrap' }}
                >
                  {column.label}
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
                    if (column.id === 'estado') {
                      return (
                        <TableCell key={column.id} align={column.align} sx={{ py: 0.6, whiteSpace: 'nowrap' }}>
                          <Chip
                            label={`${estado.dot} ${estado.label}`}
                            size="small"
                            sx={{
                              height: 20,
                              fontSize: 10,
                              fontWeight: 700,
                              textTransform: 'none',
                              color: estado.color,
                              backgroundColor: `${estado.color}1F`,
                              border: '1px solid',
                              borderColor: `${estado.color}45`
                            }}
                          />
                        </TableCell>
                      );
                    }
                    return (
                      <TableCell key={column.id} align={column.align} sx={{ fontSize: 11.5, py: 0.6, whiteSpace: 'nowrap' }}>
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
