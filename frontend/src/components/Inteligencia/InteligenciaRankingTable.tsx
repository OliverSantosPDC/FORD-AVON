import React from 'react';
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Box
} from '@mui/material';
import type { RankingGestorItem, RankingPaisItem } from '../../types/cartera';

interface InteligenciaRankingTableProps<T> {
  title: string;
  columns: string[];
  data: T[];
  type: 'gestores' | 'paises';
}

const InteligenciaRankingTable = <T extends RankingGestorItem | RankingPaisItem>({
  title,
  columns,
  data,
  type
}: InteligenciaRankingTableProps<T>) => {
  return (
    <Paper sx={{ p: 3, borderRadius: 3, boxShadow: 1, height: '100%' }}>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h6" fontWeight={700}>
          {title}
        </Typography>
      </Box>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              {columns.map((column) => (
                <TableCell key={column}>{column}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {data.map((row, index) => (
              <TableRow key={index} hover>
                {type === 'gestores' ? (
                  <>
                    <TableCell>{(row as RankingGestorItem).nombre}</TableCell>
                    <TableCell>{(row as RankingGestorItem).cuentas}</TableCell>
                    <TableCell>${(row as RankingGestorItem).saldoAsignado.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                    <TableCell>${(row as RankingGestorItem).saldoActual.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                    <TableCell>${(row as RankingGestorItem).recuperado.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                    <TableCell>{(row as RankingGestorItem).porcentajeRecuperacion.toFixed(2)}%</TableCell>
                  </>
                ) : (
                  <>
                    <TableCell>{(row as RankingPaisItem).pais}</TableCell>
                    <TableCell>{(row as RankingPaisItem).cuentas}</TableCell>
                    <TableCell>${(row as RankingPaisItem).saldoActual.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                    <TableCell>${(row as RankingPaisItem).recuperado.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                    <TableCell>{(row as RankingPaisItem).porcentajeRecuperacion.toFixed(2)}%</TableCell>
                  </>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};

export default InteligenciaRankingTable;
