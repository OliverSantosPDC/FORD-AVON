import React, { useMemo, useState } from 'react';
import {
  Box,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Typography
} from '@mui/material';
import type { CarteraRecord } from '../../types/cartera';
import TableActionsMenu from '../common/TableActionsMenu';
import { copyRowsToClipboard, exportRowsToCsv, exportRowsToExcel } from '../../utils/tableExport';
import { getCarteraField, resolveCountry, type CountryInfo } from '../../utils/carteraAggregations';

interface DashboardTableProps {
  data: CarteraRecord[];
}

const headCells = [
  { id: 'codigo', label: 'Código' },
  { id: 'pais', label: 'País' },
  { id: 'sector', label: 'Sector' },
  { id: 'cliente', label: 'Cliente' },
  { id: 'gestor', label: 'Gestor' },
  { id: 'gerente', label: 'Gerente' },
  { id: 'zona', label: 'Zona' },
  { id: 'pd', label: 'PD' },
  { id: 'campania', label: 'Campaña' },
  { id: 'saldoActualUsd', label: 'Saldo USD' },
  { id: 'saldoActualLocal', label: 'Saldo Local' }
];

const pdColor = (pd: string) => {
  if (pd.startsWith('PD0')) return '#22C55E';
  if (pd.startsWith('PD1')) return '#0EA5E9';
  if (pd.startsWith('PD2')) return '#F59E0B';
  if (pd.startsWith('PD3')) return '#F97316';
  return '#EF4444';
};

const formatNumber = (value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const getCellValue = (row: CarteraRecord, key: string, country: CountryInfo | null) => {
  const resolve = (keys: string[]) => getCarteraField(row, keys);

  switch (key) {
    case 'codigo':
      return String(resolve(['codigo', 'code', 'id']) ?? '');
    case 'pais':
      return country?.name ?? String(resolve(['pais']) ?? '');
    case 'sector':
      return String(resolve(['sector']) ?? '');
    case 'cliente':
      return String(resolve(['cliente', 'nombre', 'nombre_cliente', 'deudor']) ?? '');
    case 'gestor':
      return String(resolve(['gestor']) ?? '');
    case 'gerente':
      return String(resolve(['gerente', 'gerente_zona']) ?? '');
    case 'pd':
      return String(resolve(['pd_actual', 'pd']) ?? '');
    case 'campania':
      return String(resolve(['campania_adeuda', 'campania', 'campaña', 'campaign']) ?? '');
    case 'saldoActualUsd':
      return typeof resolve(['saldo_actual_usd', 'saldoActualUsd', 'saldoActual', 'saldo_actual']) === 'number'
        ? (resolve(['saldo_actual_usd', 'saldoActualUsd', 'saldoActual', 'saldo_actual']) as number)
        : String(resolve(['saldo_actual_usd', 'saldoActualUsd', 'saldoActual', 'saldo_actual']) ?? '');
    case 'saldoActualLocal':
      return typeof resolve(['saldo_actual', 'saldoActualLocal', 'saldoActual']) === 'number'
        ? (resolve(['saldo_actual', 'saldoActualLocal', 'saldoActual']) as number)
        : String(resolve(['saldo_actual', 'saldoActualLocal', 'saldoActual']) ?? '');
    default:
      return String(row[key] ?? '');
  }
};

const DashboardTable = ({ data }: DashboardTableProps) => {
  const [orderBy, setOrderBy] = useState('codigo');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [search, setSearch] = useState('');
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);

  // Sólo se muestran cuentas de los países soportados por la operación ejecutiva.
  const countryScopedData = useMemo(() => {
    return data
      .map((row) => ({ row, country: resolveCountry(getCarteraField(row, ['pais'])) }))
      .filter((entry): entry is { row: CarteraRecord; country: CountryInfo } => entry.country !== null);
  }, [data]);

  const filteredData = useMemo(() => {
    const normalized = search.toLowerCase();
    return countryScopedData.filter(({ row, country }) =>
      [...Object.values(row), country.name].some((value) => String(value ?? '').toLowerCase().includes(normalized))
    );
  }, [countryScopedData, search]);

  const sortedData = useMemo(() => {
    return [...filteredData].sort((a, b) => {
      const aValue = getCellValue(a.row, orderBy, a.country);
      const bValue = getCellValue(b.row, orderBy, b.country);
      return order === 'asc' ? String(aValue).localeCompare(String(bValue)) : String(bValue).localeCompare(String(aValue));
    });
  }, [filteredData, orderBy, order]);

  const visibleHeadCells = headCells.filter((headCell) => !hiddenColumns.includes(headCell.id));

  const handleRequestSort = (property: string) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const toggleColumn = (id: string) => {
    setHiddenColumns((prev) => (prev.includes(id) ? prev.filter((columnId) => columnId !== id) : [...prev, id]));
  };

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const paginatedData = sortedData.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const buildExportRows = () => ({
    headers: visibleHeadCells.map((headCell) => headCell.label),
    rows: sortedData.map(({ row, country }) =>
      visibleHeadCells.map((headCell) => {
        const value = getCellValue(row, headCell.id, country);
        if ((headCell.id === 'saldoActualUsd' || headCell.id === 'saldoActualLocal') && typeof value === 'number') {
          return formatNumber(value);
        }
        return value;
      })
    )
  });

  const handleExportCsv = () => {
    const { headers, rows } = buildExportRows();
    exportRowsToCsv('cuentas.csv', headers, rows);
  };

  const handleExportExcel = () => {
    const { headers, rows } = buildExportRows();
    exportRowsToExcel('cuentas.xls', 'Cuentas', headers, rows);
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
        <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>
          Cuentas
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TextField
            placeholder="Buscar cuentas"
            size="small"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            sx={{ width: 200, '& .MuiOutlinedInput-root': { borderRadius: 2, height: 28, fontSize: 11.5 } }}
          />
          <TableActionsMenu
            columns={headCells}
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
        <Table stickyHeader size="small" sx={{ minWidth: 1180 }}>
          <TableHead>
            <TableRow sx={{ backgroundColor: 'action.selected' }}>
              {visibleHeadCells.map((headCell) => (
                <TableCell
                  key={headCell.id}
                  sortDirection={orderBy === headCell.id ? order : false}
                  sx={{
                    fontSize: 10,
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    color: 'text.secondary',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    py: 0.75,
                    whiteSpace: 'nowrap'
                  }}
                >
                  <TableSortLabel active={orderBy === headCell.id} direction={orderBy === headCell.id ? order : 'asc'} onClick={() => handleRequestSort(headCell.id)}>
                    {headCell.label}
                  </TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedData.map(({ row, country }, index) => (
              <TableRow
                key={index}
                hover
                sx={{
                  '&:nth-of-type(odd)': {
                    backgroundColor: 'action.hover'
                  },
                  transition: 'background-color 220ms ease-in-out'
                }}
              >
                {visibleHeadCells.map((headCell) => {
                  const value = getCellValue(row, headCell.id, country);
                  const isCurrency = headCell.id === 'saldoActualUsd' || headCell.id === 'saldoActualLocal';
                  const isRightAligned = headCell.id === 'saldoActualUsd' || headCell.id === 'saldoActualLocal';

                  if (headCell.id === 'pais') {
                    return (
                      <TableCell key={headCell.id} sx={{ py: 0.6, fontSize: 11.5, whiteSpace: 'nowrap' }}>
                        {country.name}
                      </TableCell>
                    );
                  }

                  if (headCell.id === 'pd') {
                    const pdValue = String(value || 'PD4');
                    return (
                      <TableCell key={headCell.id} sx={{ py: 0.6, fontSize: 11.5 }}>
                        <Chip
                          label={pdValue}
                          size="small"
                          sx={{
                            height: 19,
                            fontSize: 10,
                            backgroundColor: pdColor(pdValue),
                            color: '#fff',
                            fontWeight: 700,
                            minWidth: 46
                          }}
                        />
                      </TableCell>
                    );
                  }

                  return (
                    <TableCell
                      key={headCell.id}
                      align={isRightAligned ? 'right' : 'left'}
                      sx={{
                        py: 0.6,
                        fontSize: 11.5,
                        maxWidth: 190,
                        fontFamily: headCell.id === 'codigo' ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace' : 'inherit',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {isCurrency && typeof value === 'number' ? formatNumber(value) : String(value)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={sortedData.length}
        page={page}
        onPageChange={handleChangePage}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={handleChangeRowsPerPage}
        rowsPerPageOptions={[10, 25, 50]}
        sx={{
          flexShrink: 0,
          minHeight: 36,
          '& .MuiTablePagination-toolbar': { minHeight: 36, px: 0 },
          '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: 11 }
        }}
      />
    </Paper>
  );
};

export default DashboardTable;
