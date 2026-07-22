import { Box, Typography } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import DashboardFilters from '../../components/Dashboard/DashboardFilters';
import KpiCards from '../../components/Dashboard/KpiCards';
import DashboardCharts from '../../components/Dashboard/DashboardCharts';
import DashboardTable from '../../components/Dashboard/DashboardTable';
import TopGestoresTable from '../../components/Dashboard/TopGestoresTable';
import TopZonasTable from '../../components/Dashboard/TopZonasTable';
import ResumenPdTable from '../../components/Dashboard/ResumenPdTable';
import ResumenCampaniaTable from '../../components/Dashboard/ResumenCampaniaTable';
import { useCartera } from '../../hooks/useCartera';
import { useDashboard } from '../../hooks/useDashboard';
import type { DashboardFilterParams, DashboardMultiFilterParams } from '../../types/cartera';
import { aggregateCountrySummary } from '../../utils/carteraAggregations';

// Alturas de tile compartidas: garantizan que las tarjetas de una misma fila midan igual.
const TABLE_TILE = 300;
const DETAIL_TILE = 360;

const normalizeValue = (value: unknown) => String(value ?? '').trim();

const getFieldValue = (row: Record<string, unknown>, keys: string[]) => {
  const value = keys.map((key) => row[key]).find((item) => item !== undefined && item !== null);
  return normalizeValue(value);
};

const rowMatchesFilter = (row: Record<string, unknown>, values: string[], keys: string[]) => {
  if (!values.length) return true;
  const normalizedValues = values.map((value) => value.trim().toLocaleLowerCase());
  const fieldValue = getFieldValue(row, keys).toLocaleLowerCase();
  return normalizedValues.includes(fieldValue);
};

const filterRows = (rows: Record<string, unknown>[], filters: DashboardMultiFilterParams, excludeField?: keyof DashboardMultiFilterParams) => {
  return rows.filter((row) => {
    if (excludeField !== 'pais' && !rowMatchesFilter(row, filters.pais, ['pais'])) return false;
    if (excludeField !== 'zona' && !rowMatchesFilter(row, filters.zona, ['zona'])) return false;
    if (excludeField !== 'gestor' && !rowMatchesFilter(row, filters.gestor, ['gestor'])) return false;
    if (excludeField !== 'gerente' && !rowMatchesFilter(row, filters.gerente, ['gerente', 'gerente_zona'])) return false;
    if (excludeField !== 'pd' && !rowMatchesFilter(row, filters.pd, ['pd_actual', 'pd'])) return false;
    if (excludeField !== 'campania' && !rowMatchesFilter(row, filters.campania, ['campania_adeuda', 'campania', 'campaña', 'campaign'])) return false;
    return true;
  });
};

const getUniqueOptions = (rows: Record<string, unknown>[], keyVariants: string[]) => {
  const values = rows
    .map((row) => getFieldValue(row, keyVariants))
    .filter((value) => value !== '');
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
};

const buildFilteredOptions = (rows: Record<string, unknown>[], filters: DashboardMultiFilterParams) => ({
  pais: getUniqueOptions(filterRows(rows, filters, 'pais'), ['pais']),
  zona: getUniqueOptions(filterRows(rows, filters, 'zona'), ['zona']),
  gestor: getUniqueOptions(filterRows(rows, filters, 'gestor'), ['gestor']),
  gerente: getUniqueOptions(filterRows(rows, filters, 'gerente'), ['gerente', 'gerente_zona']),
  pd: getUniqueOptions(filterRows(rows, filters, 'pd'), ['pd_actual', 'pd']),
  campania: getUniqueOptions(filterRows(rows, filters, 'campania'), ['campania_adeuda', 'campania', 'campaña', 'campaign'])
});

const sanitizeSelectedValues = (
  values: string[],
  availableOptions: string[]
) => values.filter((value) => availableOptions.includes(value));

const DashboardPage = () => {
  const [filters, setFilters] = useState<DashboardMultiFilterParams>({ pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] });
  const { data, loading: loadingCartera, error: errorCartera } = useCartera();

  const availableOptions = useMemo(() => buildFilteredOptions(data, filters), [data, filters]);

  useEffect(() => {
    const sanitized = {
      pais: sanitizeSelectedValues(filters.pais, availableOptions.pais),
      zona: sanitizeSelectedValues(filters.zona, availableOptions.zona),
      gestor: sanitizeSelectedValues(filters.gestor, availableOptions.gestor),
      gerente: sanitizeSelectedValues(filters.gerente, availableOptions.gerente),
      pd: sanitizeSelectedValues(filters.pd, availableOptions.pd),
      campania: sanitizeSelectedValues(filters.campania, availableOptions.campania)
    };

    const isSame = (a: string[], b: string[]) => a.length === b.length && a.every((value, index) => value === b[index]);

    if (
      !isSame(sanitized.pais, filters.pais) ||
      !isSame(sanitized.zona, filters.zona) ||
      !isSame(sanitized.gestor, filters.gestor) ||
      !isSame(sanitized.gerente, filters.gerente) ||
      !isSame(sanitized.pd, filters.pd) ||
      !isSame(sanitized.campania, filters.campania)
    ) {
      setFilters(sanitized);
    }
  }, [availableOptions, filters]);

  const filterOptions = {
    pais: availableOptions.pais,
    gestor: availableOptions.gestor,
    gerente: availableOptions.gerente,
    zona: availableOptions.zona,
    pd: availableOptions.pd,
    campania: availableOptions.campania
  };

  const handleChangeFilters = (nextFilters: DashboardMultiFilterParams) => {
    const sanitized = {
      pais: sanitizeSelectedValues(nextFilters.pais, availableOptions.pais),
      zona: sanitizeSelectedValues(nextFilters.zona, availableOptions.zona),
      gestor: sanitizeSelectedValues(nextFilters.gestor, availableOptions.gestor),
      gerente: sanitizeSelectedValues(nextFilters.gerente, availableOptions.gerente),
      pd: sanitizeSelectedValues(nextFilters.pd, availableOptions.pd),
      campania: sanitizeSelectedValues(nextFilters.campania, availableOptions.campania)
    };

    setFilters(sanitized);
  };

  const handleClearFilters = () => setFilters({ pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] });

  const dashboardFilters: DashboardFilterParams = {
    pais: filters.pais,
    gestor: filters.gestor,
    gerente: filters.gerente,
    zona: filters.zona,
    pd: filters.pd,
    campania: filters.campania
  };

  const { data: dashboard, loading: loadingDashboard, error: errorDashboard } = useDashboard(dashboardFilters);
  const loading = loadingCartera || loadingDashboard;
  const error = errorCartera ?? errorDashboard;

  const filteredTableData = useMemo(() => {
    const normalize = (value: unknown) => String(value ?? '').toLocaleLowerCase().trim();

    return data.filter((row) => {
      const rowPais = normalize(row.pais);
      const rowGestor = normalize(row.gestor);
      const rowGerente = normalize(row.gerente ?? row.gerente_zona);
      const rowZona = normalize(row.zona);
      const rowPd = normalize(row.pd_actual ?? row.pd);
      const rowCampania = normalize(row.campania_adeuda ?? row.campania ?? row.campaña ?? row.campaign);

      if (filters.pais.length && !filters.pais.map((value) => value.toLocaleLowerCase()).includes(rowPais)) {
        return false;
      }
      if (filters.gestor.length && !filters.gestor.map((value) => value.toLocaleLowerCase()).includes(rowGestor)) {
        return false;
      }
      if (filters.gerente.length && !filters.gerente.map((value) => value.toLocaleLowerCase()).includes(rowGerente)) {
        return false;
      }
      if (filters.zona.length && !filters.zona.map((value) => value.toLocaleLowerCase()).includes(rowZona)) {
        return false;
      }
      if (filters.pd.length && !filters.pd.map((value) => value.toLocaleLowerCase()).includes(rowPd)) {
        return false;
      }
      if (filters.campania.length && !filters.campania.map((value) => value.toLocaleLowerCase()).includes(rowCampania)) {
        return false;
      }
      return true;
    });
  }, [data, filters]);

  const countrySummary = useMemo(() => aggregateCountrySummary(filteredTableData), [filteredTableData]);

  if (loading) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography sx={{ fontSize: 14 }}>Cargando información del dashboard...</Typography>
      </Box>
    );
  }

  if (error || !dashboard) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography sx={{ fontSize: 14 }} color="error">
          {error ?? 'No se pudo cargar la información del dashboard.'}
        </Typography>
      </Box>
    );
  }

  return (
    /*
     * Lienzo ejecutivo: una sola rejilla CSS de 12 columnas con gap uniforme.
     * Todas las bandas comparten el mismo sistema, por lo que cada tarjeta
     * queda alineada con las de arriba y abajo, sin bloques desproporcionados.
     */
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
        gap: 2,
        alignItems: 'stretch',
        width: '100%'
      }}
    >
      {/* Banda 1 · Filtros — primer bloque del dashboard */}
      <Box sx={{ gridColumn: '1 / -1' }}>
        <DashboardFilters filters={filters} onChange={handleChangeFilters} onClear={handleClearFilters} options={filterOptions} />
      </Box>

      {/* Banda 2 · KPIs — una sola fila */}
      <Box sx={{ gridColumn: '1 / -1' }}>
        <KpiCards kpis={dashboard.kpis} />
      </Box>

      {/* Banda 3 · Gráficos — 6 tarjetas idénticas en 2 columnas × 3 filas */}
      <Box sx={{ gridColumn: '1 / -1' }}>
        <DashboardCharts pds={dashboard.pds} resumenPD={dashboard.resumenPD} countrySummary={countrySummary} />
      </Box>

      {/* Banda 4 · Top Gestores + Top Zonas — sin filtros aplicados */}
      <Box sx={{ gridColumn: { xs: '1 / -1', md: 'span 6' }, height: TABLE_TILE }}>
        <TopGestoresTable data={data} />
      </Box>
      <Box sx={{ gridColumn: { xs: '1 / -1', md: 'span 6' }, height: TABLE_TILE }}>
        <TopZonasTable data={data} />
      </Box>

      {/* Banda 5 · Resumen por PD + Resumen por Campaña */}
      <Box sx={{ gridColumn: { xs: '1 / -1', md: 'span 6' }, height: TABLE_TILE }}>
        <ResumenPdTable data={dashboard.resumenPD} />
      </Box>
      <Box sx={{ gridColumn: { xs: '1 / -1', md: 'span 6' }, height: TABLE_TILE }}>
        <ResumenCampaniaTable data={filteredTableData} />
      </Box>

      {/* Banda 6 · Detalle de cuentas */}
      <Box sx={{ gridColumn: '1 / -1', height: DETAIL_TILE }}>
        <DashboardTable data={filteredTableData.slice(0, 100)} />
      </Box>
    </Box>
  );
};

export default DashboardPage;
