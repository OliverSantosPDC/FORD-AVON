import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  InputAdornment,
  MenuItem,
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
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import { useCartera } from '../../hooks/useCartera';
import { useAuth } from '../../context/AuthContext';
import { exportRowsToCsv } from '../../utils/tableExport';
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

/** Dimensiones de filtro client-side (operan SOLO sobre datos ya autorizados por el backend). */
const FILTERS = [
  { key: 'pais', label: 'País' },
  { key: 'zona', label: 'Zona' },
  { key: 'gestor', label: 'Gestor' },
  { key: 'pd_actual', label: 'PD' }
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

const money = (value: unknown): string => {
  const n = typeof value === 'number' ? value : Number(str(value));
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/** Color del chip por PD (PD0 sano → PD7 crítico). Solo presentación; el dato es el PD real. */
const pdColor = (pd: string): string => {
  const map: Record<string, string> = {
    PD0: '#22C55E', PD1: '#84CC16', PD2: '#EAB308', PD3: '#F59E0B',
    PD4: '#F97316', PD5: '#EF4444', PD6: '#DC2626', PD7: '#991B1B'
  };
  return map[pd.toUpperCase()] ?? '#64748B';
};

const uniqueValues = (rows: CarteraRecord[], key: string): string[] =>
  [...new Set(rows.map((r) => str(r[key])).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));

const EMPTY_FILTERS: Record<FilterKey, string> = { pais: '', zona: '', gestor: '', pd_actual: '' };

const CarteraPage = () => {
  const { data, loading, error } = useCartera();
  const { hasPermission } = useAuth();
  const canExport = hasPermission('reporte.exportar');

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Record<FilterKey, string>>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // Opciones de filtro: SOLO valores presentes en los datos ya devueltos (scope backend).
  const options = useMemo(
    () => ({
      pais: uniqueValues(data, 'pais'),
      zona: uniqueValues(data, 'zona'),
      gestor: uniqueValues(data, 'gestor'),
      pd_actual: uniqueValues(data, 'pd_actual')
    }),
    [data]
  );

  const filtered = useMemo<CarteraRecord[]>(() => {
    const term = search.trim().toLowerCase();
    return data.filter((row) => {
      for (const f of FILTERS) {
        const sel = selected[f.key];
        if (sel && str(row[f.key]) !== sel) return false;
      }
      if (term && !COLUMNS.some((col) => str(row[col.key]).toLowerCase().includes(term))) return false;
      return true;
    });
  }, [data, search, selected]);

  const paged = useMemo(
    () => filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [filtered, page, rowsPerPage]
  );

  const resetPage = () => setPage(0);

  const handleExport = () => {
    // Exporta EXACTAMENTE lo visible (scope backend + filtros + búsqueda). Nunca consulta Supabase.
    const headers = COLUMNS.map((c) => c.label);
    const rows = filtered.map((row) =>
      COLUMNS.map((c) => (c.currency ? Number(str(row[c.key])) || 0 : str(row[c.key])))
    );
    exportRowsToCsv('cartera.csv', headers, rows);
  };

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
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
        <Box>
          <Typography sx={{ fontSize: 20, fontWeight: 700 }}>Cartera</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            Registros dentro de tu alcance. Mostrando {filtered.length.toLocaleString('es')} de {data.length.toLocaleString('es')} cuenta(s).
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {canExport && !isEmpty && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<FileDownloadOutlinedIcon />}
              onClick={handleExport}
              disabled={filtered.length === 0}
              sx={{ textTransform: 'none', borderRadius: 2 }}
            >
              Exportar CSV
            </Button>
          )}
          <TextField
            size="small"
            placeholder="Buscar por código, cliente, gestor..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetPage();
            }}
            sx={{ minWidth: 260 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              )
            }}
          />
        </Box>
      </Box>

      {isEmpty ? (
        <Paper sx={{ p: 6, textAlign: 'center', borderRadius: 3 }}>
          <InboxOutlinedIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
          <Typography sx={{ fontWeight: 600 }}>No hay datos disponibles para tu alcance actual.</Typography>
        </Paper>
      ) : (
        <>
          {/* Filtros de presentación (client-side) sobre los datos ya autorizados por el backend. */}
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 1.5 }}>
            {FILTERS.map((f) => (
              <TextField
                key={f.key}
                select
                size="small"
                label={f.label}
                value={selected[f.key]}
                onChange={(e) => {
                  setSelected((prev) => ({ ...prev, [f.key]: e.target.value }));
                  resetPage();
                }}
                sx={{ minWidth: 150 }}
              >
                <MenuItem value="">Todos</MenuItem>
                {options[f.key].map((opt) => (
                  <MenuItem key={opt} value={opt}>{opt}</MenuItem>
                ))}
              </TextField>
            ))}
          </Box>

          <Paper sx={{ borderRadius: 2.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
            <TableContainer sx={{ maxHeight: '62vh' }}>
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
                        Sin resultados para los filtros aplicados.
                      </TableCell>
                    </TableRow>
                  ) : (
                    paged.map((row, index) => (
                      <TableRow key={str(row['codigo']) || index} hover>
                        {COLUMNS.map((col) => (
                          <TableCell key={col.key} align={col.numeric ? 'right' : 'left'} sx={{ whiteSpace: 'nowrap' }}>
                            {col.key === 'pd_actual' && str(row[col.key]) ? (
                              <Chip
                                label={str(row[col.key])}
                                size="small"
                                sx={{ bgcolor: pdColor(str(row[col.key])), color: '#fff', fontWeight: 700, height: 20 }}
                              />
                            ) : col.currency ? (
                              money(row[col.key])
                            ) : (
                              str(row[col.key]) || '—'
                            )}
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
                resetPage();
              }}
              rowsPerPageOptions={[25, 50, 100]}
              labelRowsPerPage="Filas por página"
            />
          </Paper>
        </>
      )}
    </Box>
  );
};

export default CarteraPage;
