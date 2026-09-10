import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import type { GroupSummary } from '../../types/cartera';
import TableActionsMenu from '../common/TableActionsMenu';
import { copyRowsToClipboard, exportRowsToCsv, exportRowsToExcel } from '../../utils/tableExport';

interface TopZonasTableProps {
  // Datos ya agregados por el backend (Top 20 zonas, sin filtros).
  data: GroupSummary[];
  moneda: 'USD' | 'LOCAL';
  monedaCode: string;
}

type ColumnId = 'zona' | 'pais' | 'saldoActualUsd' | 'recuperadoUsd' | 'porcentajeRecuperacion';

const columns: { id: ColumnId; label: string; align?: 'right'; width: number }[] = [
  { id: 'zona', label: 'Zona', width: 120 },
  { id: 'pais', label: 'País', width: 78 },
  { id: 'saldoActualUsd', label: 'Saldo', align: 'right', width: 128 },
  { id: 'recuperadoUsd', label: 'Recuperado', align: 'right', width: 100 },
  { id: 'porcentajeRecuperacion', label: '%', align: 'right', width: 58 }
];

const formatCurrency = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

const TopZonasTable = ({ data, moneda, monedaCode }: TopZonasTableProps) => {
  const [expanded, setExpanded] = useState(false);
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [orderBy, setOrderBy] = useState<ColumnId>('saldoActualUsd');
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);

  // El Top Zonas llega ya agregado desde el backend (universo completo, sin filtros).
  const aggregated = data;

  const getSortValue = (row: GroupSummary, columnId: ColumnId): string | number => {
    switch (columnId) {
      case 'zona': return row.key;
      case 'pais': return row.pais;
      case 'saldoActualUsd': return moneda === 'USD' ? row.saldoActualUsd : row.saldoActualLocal;
      case 'recuperadoUsd': return moneda === 'USD' ? row.recuperadoUsd : row.recuperadoLocal;
      case 'porcentajeRecuperacion': return row.porcentajeRecuperacion;
      default: return '';
    }
  };

  const sortedData = useMemo(() => {
    return [...aggregated].sort((a, b) => {
      const aValue = getSortValue(a, orderBy);
      const bValue = getSortValue(b, orderBy);
      const result = typeof aValue === 'number' && typeof bValue === 'number' ? aValue - bValue : String(aValue).localeCompare(String(bValue), 'es', { sensitivity: 'base' });
      return order === 'asc' ? result : -result;
    });
  }, [aggregated, order, orderBy, moneda]);

  const visibleData = sortedData.slice(0, expanded ? 20 : 10);
  const visibleColumns = columns.filter((column) => !hiddenColumns.includes(column.id));

  const handleSort = (columnId: ColumnId) => {
    const isAsc = orderBy === columnId && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(columnId);
  };

  const toggleColumn = (id: string) => {
    setHiddenColumns((prev) => (prev.includes(id) ? prev.filter((columnId) => columnId !== id) : [...prev, id]));
  };

  const getRowValue = (row: GroupSummary, columnId: ColumnId): string | number => {
    switch (columnId) {
      case 'zona':
        return row.key;
      case 'pais':
        return row.pais;
      case 'saldoActualUsd':
        return moneda === 'USD' ? `${formatCurrency(row.saldoActualUsd)} (${row.paisAbbr})` : `${formatCurrency(row.saldoActualLocal)} ${monedaCode}`;
      case 'recuperadoUsd':
        return moneda === 'USD' ? formatCurrency(row.recuperadoUsd) : formatCurrency(row.recuperadoLocal);
      case 'porcentajeRecuperacion':
        return `${row.porcentajeRecuperacion.toFixed(2)}%`;
      default:
        return '';
    }
  };

  const buildExportRows = () => ({
    headers: visibleColumns.map((column) => column.label),
    rows: visibleData.map((row) => visibleColumns.map((column) => getRowValue(row, column.id)))
  });

  const handleExportCsv = () => {
    const { headers, rows } = buildExportRows();
    exportRowsToCsv('top-zonas.csv', headers, rows);
  };

  const handleExportExcel = () => {
    const { headers, rows } = buildExportRows();
    exportRowsToExcel('top-zonas.xls', 'Top Zonas', headers, rows);
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
          Top Zonas
        </Typography>
        <TableActionsMenu
          columns={columns.map((column) => ({ id: column.id, label: column.label }))}
          hiddenColumns={hiddenColumns}
          onToggleColumn={toggleColumn}
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
        <Table stickyHeader size="small" sx={{ minWidth: columns.reduce((sum, column) => sum + column.width, 0) }}>
          <TableHead>
            <TableRow>
              {visibleColumns.map((column) => (
                <TableCell
                  key={column.id}
                  align={column.align}
                  sortDirection={orderBy === column.id ? order : false}
                  sx={{ width: column.width, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, py: 0.75, whiteSpace: 'nowrap' }}
                >
                  <TableSortLabel active={orderBy === column.id} direction={orderBy === column.id ? order : 'asc'} onClick={() => handleSort(column.id)}>
                    {column.label}
                  </TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleData.map((row, index) => (
              <TableRow key={index} hover sx={{ transition: 'background-color 200ms ease-in-out' }}>
                {visibleColumns.map((column) => (
                  <TableCell key={column.id} align={column.align} sx={{ width: column.width, whiteSpace: 'nowrap', fontSize: 11.5, py: 0.6 }}>
                    {getRowValue(row, column.id)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {sortedData.length > 10 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1 }}>
          <Button
            size="small"
            variant="text"
            onClick={() => setExpanded((prev) => !prev)}
            endIcon={expanded ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
            sx={{ borderRadius: 2, fontSize: 11.5, py: 0.25, minHeight: 0, transition: 'all 200ms ease' }}
          >
            {expanded ? 'Ver 10' : 'Ver 20'}
          </Button>
        </Box>
      )}
    </Paper>
  );
};

export default TopZonasTable;
