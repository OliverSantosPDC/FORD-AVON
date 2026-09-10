import { useMemo, useState } from 'react';
import { Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, TextField, Typography } from '@mui/material';
import type { CampaniaSummary } from '../../types/cartera';
import TableActionsMenu from '../common/TableActionsMenu';
import { copyRowsToClipboard, exportRowsToCsv, exportRowsToExcel } from '../../utils/tableExport';

interface ResumenCampaniaTableProps {
  // Resumen por campaña ya agregado por el backend.
  data: CampaniaSummary[];
  moneda: 'USD' | 'LOCAL';
  monedaCode: string;
}

type ColumnId = 'campania' | 'cuentas' | 'saldoInicial' | 'recuperadoUsd' | 'porcentajeRecuperacion';

const columns: { id: ColumnId; label: string; align: 'center'; width: number; wrap?: boolean }[] = [
  { id: 'campania', label: 'Campaña', align: 'center', width: 130, wrap: true },
  { id: 'cuentas', label: 'Total Cuentas', align: 'center', width: 92 },
  { id: 'saldoInicial', label: 'Saldo Inicial', align: 'center', width: 118 },
  { id: 'recuperadoUsd', label: 'Recuperado', align: 'center', width: 100 },
  { id: 'porcentajeRecuperacion', label: '%', align: 'center', width: 56 }
];

const formatCurrency = (value: number, moneda: 'USD' | 'LOCAL', code: string) =>
  moneda === 'USD'
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${code}`;

// recuperadoLocal no existe en CampaniaSummary: se deriva con la misma fórmula usada en todo el proyecto (asignado - actual).
const recuperadoLocalDe = (row: CampaniaSummary) => row.saldoAsignadoLocal - row.saldoActualLocal;

const ResumenCampaniaTable = ({ data, moneda, monedaCode }: ResumenCampaniaTableProps) => {
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [orderBy, setOrderBy] = useState<ColumnId>('saldoInicial');
  const [search, setSearch] = useState('');

  const aggregated = data;

  const filtered = useMemo(() => {
    const normalized = search.toLowerCase();
    return aggregated.filter((row) => row.campania.toLowerCase().includes(normalized));
  }, [aggregated, search]);

  const getSortValue = (row: CampaniaSummary, columnId: ColumnId): string | number => {
    switch (columnId) {
      case 'campania': return row.campania;
      case 'cuentas': return row.cuentas;
      case 'saldoInicial': return moneda === 'USD' ? row.saldoAsignadoUsd : row.saldoAsignadoLocal;
      case 'recuperadoUsd': return moneda === 'USD' ? row.recuperadoUsd : recuperadoLocalDe(row);
      case 'porcentajeRecuperacion': return row.porcentajeRecuperacion;
      default: return '';
    }
  };

  const sortedData = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aValue = getSortValue(a, orderBy);
      const bValue = getSortValue(b, orderBy);
      const result = typeof aValue === 'number' && typeof bValue === 'number' ? aValue - bValue : String(aValue).localeCompare(String(bValue), 'es', { sensitivity: 'base' });
      return order === 'asc' ? result : -result;
    });
  }, [filtered, order, orderBy, moneda]);

  const visibleColumns = columns;

  const handleSort = (columnId: ColumnId) => {
    const isAsc = orderBy === columnId && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(columnId);
  };

  const getRowValue = (row: CampaniaSummary, columnId: ColumnId): string | number => {
    switch (columnId) {
      case 'campania':
        return row.campania;
      case 'cuentas':
        return row.cuentas;
      case 'saldoInicial':
        return formatCurrency(moneda === 'USD' ? row.saldoAsignadoUsd : row.saldoAsignadoLocal, moneda, monedaCode);
      case 'recuperadoUsd':
        return formatCurrency(moneda === 'USD' ? row.recuperadoUsd : recuperadoLocalDe(row), moneda, monedaCode);
      case 'porcentajeRecuperacion':
        return `${row.porcentajeRecuperacion.toFixed(2)}%`;
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
            {sortedData.map((row, index) => (
              <TableRow key={index} hover sx={{ transition: 'background-color 200ms ease-in-out' }}>
                {visibleColumns.map((column) => (
                  <TableCell key={column.id} align={column.align} sx={{ width: column.width, px: 1, fontSize: 10.5, py: 0.3, whiteSpace: column.wrap ? 'normal' : 'nowrap', lineHeight: 1.2 }}>
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
