import { useMemo, useState } from 'react';
import { Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, TextField, Typography } from '@mui/material';
import type { CampaniaSummary } from '../../types/cartera';
import TableActionsMenu from '../common/TableActionsMenu';
import { copyRowsToClipboard, exportRowsToCsv, exportRowsToExcel } from '../../utils/tableExport';

interface ResumenCampaniaTableProps {
  // Resumen por campaña ya agregado por el backend.
  data: CampaniaSummary[];
}

type ColumnId = 'campania' | 'cuentas' | 'saldoActualLocal' | 'saldoActualUsd' | 'recuperadoUsd' | 'porcentajeRecuperacion' | 'promesas' | 'pagos';

const columns: { id: ColumnId; label: string; align?: 'right' }[] = [
  { id: 'campania', label: 'Campaña' },
  { id: 'cuentas', label: 'Total Cuentas', align: 'right' },
  { id: 'saldoActualLocal', label: 'Saldo Local', align: 'right' },
  { id: 'saldoActualUsd', label: 'Saldo USD', align: 'right' },
  { id: 'recuperadoUsd', label: 'Recuperado', align: 'right' },
  { id: 'porcentajeRecuperacion', label: '%', align: 'right' },
  { id: 'promesas', label: 'Promesas', align: 'right' },
  { id: 'pagos', label: 'Pagos', align: 'right' }
];

const formatCurrency = (value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const formatLocal = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

const ResumenCampaniaTable = ({ data }: ResumenCampaniaTableProps) => {
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [orderBy, setOrderBy] = useState<ColumnId>('saldoActualUsd');
  const [search, setSearch] = useState('');
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);

  const aggregated = data;

  const filtered = useMemo(() => {
    const normalized = search.toLowerCase();
    return aggregated.filter((row) => row.campania.toLowerCase().includes(normalized));
  }, [aggregated, search]);

  const sortedData = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aValue = orderBy === 'campania' ? a.campania : a[orderBy as keyof CampaniaSummary];
      const bValue = orderBy === 'campania' ? b.campania : b[orderBy as keyof CampaniaSummary];
      const result = typeof aValue === 'number' && typeof bValue === 'number' ? aValue - bValue : String(aValue).localeCompare(String(bValue), 'es', { sensitivity: 'base' });
      return order === 'asc' ? result : -result;
    });
  }, [filtered, order, orderBy]);

  const visibleColumns = columns.filter((column) => !hiddenColumns.includes(column.id));

  const handleSort = (columnId: ColumnId) => {
    const isAsc = orderBy === columnId && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(columnId);
  };

  const toggleColumn = (id: string) => {
    setHiddenColumns((prev) => (prev.includes(id) ? prev.filter((columnId) => columnId !== id) : [...prev, id]));
  };

  const getRowValue = (row: CampaniaSummary, columnId: ColumnId): string | number => {
    switch (columnId) {
      case 'campania':
        return row.campania;
      case 'cuentas':
        return row.cuentas;
      case 'saldoActualLocal':
        return formatLocal(row.saldoActualLocal);
      case 'saldoActualUsd':
        return formatCurrency(row.saldoActualUsd);
      case 'recuperadoUsd':
        return formatCurrency(row.recuperadoUsd);
      case 'porcentajeRecuperacion':
        return `${row.porcentajeRecuperacion.toFixed(2)}%`;
      case 'promesas':
        return row.promesas;
      case 'pagos':
        return row.pagos;
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
    exportRowsToCsv('resumen-campania.csv', headers, rows);
  };

  const handleExportExcel = () => {
    const { headers, rows } = buildExportRows();
    exportRowsToExcel('resumen-campania.xls', 'Resumen por Campaña', headers, rows);
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
        bgcolor: 'background.paper',
        boxShadow: '0 10px 26px rgba(15, 23, 42, 0.06)',
        transition: 'box-shadow 220ms ease',
        '&:hover': { boxShadow: '0 14px 32px rgba(15, 23, 42, 0.1)' }
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 1, minHeight: 30 }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
          Resumen por Campaña
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TextField
            placeholder="Buscar"
            size="small"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            sx={{ width: 150, '& .MuiOutlinedInput-root': { borderRadius: 2, height: 28, fontSize: 11.5 } }}
          />
          <TableActionsMenu
            columns={columns.map((column) => ({ id: column.id, label: column.label }))}
            hiddenColumns={hiddenColumns}
            onToggleColumn={toggleColumn}
            onCopy={handleCopy}
            onExportCsv={handleExportCsv}
            onExportExcel={handleExportExcel}
          />
        </Box>
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
                  sortDirection={orderBy === column.id ? order : false}
                  sx={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, py: 0.75, whiteSpace: 'nowrap' }}
                >
                  <TableSortLabel active={orderBy === column.id} direction={orderBy === column.id ? order : 'asc'} onClick={() => handleSort(column.id)}>
                    {column.label}
                  </TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedData.map((row, index) => (
              <TableRow key={index} hover sx={{ transition: 'background-color 200ms ease-in-out' }}>
                {visibleColumns.map((column) => (
                  <TableCell key={column.id} align={column.align} sx={{ fontSize: 11.5, py: 0.6, whiteSpace: 'nowrap' }}>
                    {getRowValue(row, column.id)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};

export default ResumenCampaniaTable;
