import { Box, Button, MenuItem, TextField, Typography } from '@mui/material';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import { useEffect, useMemo, useState } from 'react';
import DashboardFilters from '../../components/Dashboard/DashboardFilters';
import KpiCards from '../../components/Dashboard/KpiCards';
import DashboardCharts from '../../components/Dashboard/DashboardCharts';
import DashboardZonaSector from '../../components/Dashboard/DashboardZonaSector';
import DashboardOnePage from '../../components/Dashboard/DashboardOnePage';
import DashboardTable from '../../components/Dashboard/DashboardTable';
import TopGestoresTable from '../../components/Dashboard/TopGestoresTable';
import TopZonasTable from '../../components/Dashboard/TopZonasTable';
import ResumenPdTable from '../../components/Dashboard/ResumenPdTable';
import ResumenCampaniaTable from '../../components/Dashboard/ResumenCampaniaTable';
import { useDashboard } from '../../hooks/useDashboard';
import { useAuth } from '../../context/AuthContext';
import { getCalidadResumen } from '../../services/controlService';
import { MONEDA_POR_PAIS } from '../../services/gestionService';
import type { DashboardFilterOptions, DashboardFilterParams, DashboardMultiFilterParams, DashboardKpi } from '../../types/cartera';

// Alturas de tile compartidas: garantizan que las tarjetas de una misma fila midan igual.
const TABLE_TILE = 300;
const DETAIL_TILE = 360;

const EMPTY_OPTIONS: DashboardFilterOptions = { pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] };

const sanitizeSelectedValues = (values: string[], availableOptions: string[]) =>
  values.filter((value) => availableOptions.includes(value));

const DashboardPage = () => {
  const [filters, setFilters] = useState<DashboardMultiFilterParams>({ pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] });
  const [moneda, setMoneda] = useState<'USD' | 'LOCAL'>('USD');
  const [onePageOpen, setOnePageOpen] = useState(false);

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

  // Nota de calidad de llamada global (fuente: Control Operativo). Solo si el usuario tiene permiso.
  const { hasPermission } = useAuth();
  const canCalidadVer = hasPermission('control_operativo.calidad.ver');
  const [calNota, setCalNota] = useState<{ nota: number; evaluaciones: number } | null>(null);
  useEffect(() => {
    if (!canCalidadVer) { setCalNota(null); return; }
    let active = true;
    getCalidadResumen(dashboardFilters)
      .then((r) => { if (active) setCalNota({ nota: r.notaGlobal, evaluaciones: r.evaluaciones }); })
      .catch(() => { if (active) setCalNota(null); });
    return () => { active = false; };
  }, [canCalidadVer, dashboardFilters]);

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

  // Estado "sin datos" para el alcance actual (p. ej. usuario sin asignaciones).
  const hasFiltersApplied = Object.values(filters).some((list) => list.length > 0);
  if (!hasFiltersApplied && (dashboard.kpis?.totalCuentas ?? 0) === 0) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography sx={{ fontSize: 16, fontWeight: 600 }}>No hay datos disponibles para tu alcance actual.</Typography>
        <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.5 }}>
          No tienes cuentas asignadas dentro de tu alcance de acceso.
        </Typography>
      </Box>
    );
  }

  // Selector de moneda: solo cuando hay exactamente un país seleccionado.
  const singlePais = filters.pais.length === 1;
  const monedaCode = singlePais ? (MONEDA_POR_PAIS[filters.pais[0].toUpperCase()] ?? 'USD') : 'USD';
  const monedaSel: 'USD' | 'LOCAL' = singlePais && moneda === 'LOCAL' ? 'LOCAL' : 'USD';
  const monedaLabel = monedaSel === 'LOCAL' ? monedaCode : 'USD';
  // KPIs monetarios en moneda local (datos reales del resumen por PD ya filtrado). No altera % ni cuentas.
  const localTotals = dashboard.resumenPD.reduce(
    (a, p) => ({ asignado: a.asignado + p.saldoAsignadoLocal, actual: a.actual + p.saldoActualLocal, recuperado: a.recuperado + p.recuperadoLocal }),
    { asignado: 0, actual: 0, recuperado: 0 }
  );
  const kpisDisplay: DashboardKpi = monedaSel === 'LOCAL'
    ? { saldoAsignado: localTotals.asignado, saldoActual: localTotals.actual, recuperado: localTotals.recuperado, porcentajeRecuperacion: dashboard.kpis.porcentajeRecuperacion, totalCuentas: dashboard.kpis.totalCuentas }
    : dashboard.kpis;

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

      {/* Banda 2 · Barra de acciones (moneda + OnePage) */}
      <Box sx={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 1.5 }}>
        {singlePais && (
          <TextField select size="small" label="Moneda" value={moneda} onChange={(e) => setMoneda(e.target.value as 'USD' | 'LOCAL')} sx={{ minWidth: 170 }}>
            <MenuItem value="USD">USD</MenuItem>
            <MenuItem value="LOCAL">Moneda Local ({monedaCode})</MenuItem>
          </TextField>
        )}
        <Button variant="outlined" startIcon={<DescriptionOutlinedIcon />} onClick={() => setOnePageOpen(true)} sx={{ textTransform: 'none' }}>Generar OnePage</Button>
      </Box>

      {/* Banda 2 · KPIs — una sola fila */}
      <Box sx={{ gridColumn: '1 / -1' }}>
        <KpiCards kpis={kpisDisplay} moneda={monedaLabel} />
      </Box>

      {canCalidadVer && (
        <Box sx={{ gridColumn: '1 / -1' }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.5, px: 2, py: 1, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
            <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase' }}>Calidad de llamada global</Typography>
            {calNota && calNota.evaluaciones > 0 ? (
              <>
                <Typography sx={{ fontSize: 20, fontWeight: 800 }}>{calNota.nota}</Typography>
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: calNota.nota >= 75 ? 'success.main' : calNota.nota >= 60 ? 'warning.main' : 'error.main' }}>
                  {calNota.nota >= 90 ? 'Excelente' : calNota.nota >= 75 ? 'Bueno' : calNota.nota >= 60 ? 'Aceptable' : 'Requiere mejora'}
                </Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>/ 100 · {calNota.evaluaciones} evaluaciones · fuente: Control Operativo</Typography>
              </>
            ) : (
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Sin evaluaciones disponibles</Typography>
            )}
          </Box>
        </Box>
      )}

      {/* Banda 3 · Gráficos — 6 tarjetas idénticas en 2 columnas × 3 filas */}
      <Box sx={{ gridColumn: '1 / -1' }}>
        <DashboardCharts pds={dashboard.pds} resumenPD={dashboard.resumenPD} countrySummary={dashboard.countrySummary} />
      </Box>

      {/* Banda 3.5 · Saldos por Zona y Sector (después de PD/Riesgo, antes de Tops) */}
      <Box sx={{ gridColumn: '1 / -1' }}>
        <DashboardZonaSector data={dashboard.zonaSectorSummary} moneda={monedaSel} monedaCode={monedaCode} />
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

      <DashboardOnePage
        open={onePageOpen}
        onClose={() => setOnePageOpen(false)}
        filters={filters}
        kpis={kpisDisplay}
        moneda={monedaLabel}
        calidad={calNota}
        puedeCalidad={canCalidadVer}
        zonaSector={dashboard.zonaSectorSummary}
        resumenPD={dashboard.resumenPD}
      />
    </Box>
  );
};

export default DashboardPage;
