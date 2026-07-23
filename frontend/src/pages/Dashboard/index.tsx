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
import { useDashboard } from '../../hooks/useDashboard';
import type { DashboardFilterOptions, DashboardFilterParams, DashboardMultiFilterParams } from '../../types/cartera';

// Alturas de tile compartidas: garantizan que las tarjetas de una misma fila midan igual.
const TABLE_TILE = 300;
const DETAIL_TILE = 360;

const EMPTY_OPTIONS: DashboardFilterOptions = { pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] };

const sanitizeSelectedValues = (values: string[], availableOptions: string[]) =>
  values.filter((value) => availableOptions.includes(value));

const DashboardPage = () => {
  const [filters, setFilters] = useState<DashboardMultiFilterParams>({ pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] });

  // La carga inicial del dashboard usa ÚNICAMENTE /api/dashboard.
  // Los filtros se memoizan para que sólo se vuelva a consultar cuando cambian
  // sus valores (no en cada render), evitando refetch innecesarios.
  const dashboardFilters: DashboardFilterParams = useMemo(
    () => ({
      pais: filters.pais,
      gestor: filters.gestor,
      gerente: filters.gerente,
      zona: filters.zona,
      pd: filters.pd,
      campania: filters.campania
    }),
    [filters]
  );

  const { data: dashboard, loading, error } = useDashboard(dashboardFilters);

  // Las opciones de filtros (con cascada) llegan ya calculadas desde el backend.
  const availableOptions = dashboard?.filterOptions ?? EMPTY_OPTIONS;

  // Depura los valores seleccionados que ya no existan en las opciones disponibles.
  useEffect(() => {
    if (!dashboard) return;

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
  }, [dashboard, availableOptions, filters]);

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

  if (loading && !dashboard) {
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
        <DashboardFilters filters={filters} onChange={handleChangeFilters} onClear={handleClearFilters} options={availableOptions} />
      </Box>

      {/* Banda 2 · KPIs — una sola fila */}
      <Box sx={{ gridColumn: '1 / -1' }}>
        <KpiCards kpis={dashboard.kpis} />
      </Box>

      {/* Banda 3 · Gráficos — 6 tarjetas idénticas en 2 columnas × 3 filas */}
      <Box sx={{ gridColumn: '1 / -1' }}>
        <DashboardCharts pds={dashboard.pds} resumenPD={dashboard.resumenPD} countrySummary={dashboard.countrySummary} />
      </Box>

      {/* Banda 4 · Top Gestores + Top Zonas — sin filtros aplicados */}
      <Box sx={{ gridColumn: { xs: '1 / -1', md: 'span 6' }, height: TABLE_TILE }}>
        <TopGestoresTable data={dashboard.topGestoresDetalle} />
      </Box>
      <Box sx={{ gridColumn: { xs: '1 / -1', md: 'span 6' }, height: TABLE_TILE }}>
        <TopZonasTable data={dashboard.topZonasDetalle} />
      </Box>

      {/* Banda 5 · Resumen por PD + Resumen por Campaña */}
      <Box sx={{ gridColumn: { xs: '1 / -1', md: 'span 6' }, height: TABLE_TILE }}>
        <ResumenPdTable data={dashboard.resumenPD} />
      </Box>
      <Box sx={{ gridColumn: { xs: '1 / -1', md: 'span 6' }, height: TABLE_TILE }}>
        <ResumenCampaniaTable data={dashboard.resumenCampania} />
      </Box>

      {/* Banda 6 · Detalle de cuentas */}
      <Box sx={{ gridColumn: '1 / -1', height: DETAIL_TILE }}>
        <DashboardTable data={dashboard.cuentas} />
      </Box>
    </Box>
  );
};

export default DashboardPage;
