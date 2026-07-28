import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  CircularProgress,
  InputAdornment,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import { useCartera } from '../../hooks/useCartera';
import type { CarteraRecord } from '../../types/cartera';

/** Columnas mostradas (claves reales que devuelve /api/cartera). */
interface Column {
  key: string;
  label: string;
  numeric?: boolean;
  currency?: boolean;
}

const COLUMNS: Column[] = [
  { key: 'codigo', label: 'Código' },
  { key: 'nombre', label: 'Cliente' },
  { key: 'pais', label: 'País' },
  { key: 'zona', label: 'Zona' },
  { key: 'gestor', label: 'Gestor' },
  { key: 'pd_actual', label: 'PD' },
  { key: 'campania_adeuda', label: 'Campaña' },
  { key: 'saldo_inicial_usd', label: 'Saldo asignado USD', numeric: true, currency: true },
  { key: 'saldo_actual_usd', label: 'Saldo actual USD', numeric: true, currency: true }
];

const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

const money = (value: unknown): string => {
  const n = typeof value === 'number' ? value : Number(str(value));
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const CarteraPage = () => {
  const { data, loading, error } = useCartera();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const filtered = useMemo<CarteraRecord[]>(() => {
    const term = search.trim().toLowerCase();
    if (!term) return data;
    return data.filter((row) =>
      COLUMNS.some((col) => str(row[col.key]).toLowerCase().includes(term))
    );
  }, [data, search]);

  const paged = useMemo(
    () => filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [filtered, page, rowsPerPage]
  );

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 3 }}>
        <CircularProgress size={22} />
        <Typography sx={{ fontSize: 14 }}>Cargando cartera...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  const isEmpty = data.length === 0;

  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
        <Box>
          <Typography sx={{ fontSize: 20, fontWeight: 700 }}>Cartera</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            Registros dentro de tu alcance. {data.length.toLocaleString('es')} cuenta(s) en total.
          </Typography>
        </Box>
        <TextField
          size="small"
          placeholder="Buscar por código, cliente, gestor..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 280 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            )
          }}
        />
      </Box>

      {isEmpty ? (
        <Paper sx={{ p: 6, textAlign: 'center', borderRadius: 3 }}>
          <InboxOutlinedIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
          <Typography sx={{ fontWeight: 600 }}>No tienes registros disponibles para tu alcance actual.</Typography>
        </Paper>
      ) : (
        <Paper sx={{ borderRadius: 2.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
          <TableContainer sx={{ maxHeight: '65vh' }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  {COLUMNS.map((col) => (
                    <TableCell key={col.key} align={col.numeric ? 'right' : 'left'} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {col.label}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {paged.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={COLUMNS.length} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      Sin resultados para la búsqueda.
                    </TableCell>
                  </TableRow>
                ) : (
                  paged.map((row, index) => (
                    <TableRow key={str(row['codigo']) || index} hover>
                      {COLUMNS.map((col) => (
                        <TableCell key={col.key} align={col.numeric ? 'right' : 'left'} sx={{ whiteSpace: 'nowrap' }}>
                          {col.currency ? money(row[col.key]) : str(row[col.key]) || '—'}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={filtered.length}
            page={page}
            onPageChange={(_e, next) => setPage(next)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
            rowsPerPageOptions={[25, 50, 100]}
            labelRowsPerPage="Filas por página"
          />
        </Paper>
      )}
    </Box>
  );
};

export default CarteraPage;
