import React, { useMemo, useState } from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  Paper,
  Typography,
  Button
} from '@mui/material';
import type { InteligenciaAccount } from '../../types/cartera';

interface InteligenciaTopCuentasTableProps {
  data: InteligenciaAccount[];
}

const headCells = [
  { id: 'codigo', label: 'Código' },
  { id: 'nombre', label: 'Nombre' },
  { id: 'pais', label: 'País' },
  { id: 'gestor', label: 'Gestor' },
  { id: 'pd', label: 'PD' },
  { id: 'saldoActual', label: 'Saldo Actual', numeric: true }
];

const InteligenciaTopCuentasTable = ({ data }: InteligenciaTopCuentasTableProps) => {
  const [orderBy, setOrderBy] = useState('saldoActual');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      const aValue = a[orderBy as keyof InteligenciaAccount];
      const bValue = b[orderBy as keyof InteligenciaAccount];
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return order === 'asc' ? aValue - bValue : bValue - aValue;
      }
      return order === 'asc'
        ? String(aValue).localeCompare(String(bValue))
        : String(bValue).localeCompare(String(aValue));
    });
  }, [data, order, orderBy]);

  const handleRequestSort = (property: string) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const exportToExcel = () => {
    const rows = [headCells.map((header) => header.label)];
    sortedData.forEach((row) => {
      rows.push([
        row.codigo,
        row.nombre,
        row.pais,
        row.gestor,
        row.pd,
        row.saldoActual.toFixed(2)
      ]);
    });

    const csvContent = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'top_cuentas.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const paginatedData = sortedData.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Paper sx={{ p: 3, borderRadius: 3, boxShadow: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={700}>
          Top 20 cuentas
        </Typography>
        <Button variant="outlined" onClick={exportToExcel}>
          Exportar a Excel
        </Button>
      </Box>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              {headCells.map((headCell) => (
                <TableCell key={headCell.id} align={headCell.numeric ? 'right' : 'left'}>
                  <TableSortLabel
                    active={orderBy === headCell.id}
                    direction={orderBy === headCell.id ? order : 'asc'}
                    onClick={() => handleRequestSort(headCell.id)}
                  >
                    {headCell.label}
                  </TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedData.map((row, index) => (
              <TableRow key={index} hover>
                <TableCell>{row.codigo}</TableCell>
                <TableCell>{row.nombre}</TableCell>
                <TableCell>{row.pais}</TableCell>
                <TableCell>{row.gestor}</TableCell>
                <TableCell>{row.pd}</TableCell>
                <TableCell align="right">${row.saldoActual.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
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
        rowsPerPageOptions={[10, 20]}
      />
    </Paper>
  );
};

export default InteligenciaTopCuentasTable;
