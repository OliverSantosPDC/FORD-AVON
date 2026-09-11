import { Alert, Box, Button, Typography } from '@mui/material';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import { useEffect, useMemo, useState } from 'react';
import DashboardFilters from '../../components/Dashboard/DashboardFilters';
import ConversionRates from '../../components/Dashboard/ConversionRates';
import KpiCards from '../../components/Dashboard/KpiCards';
import DashboardCharts from '../../components/Dashboard/DashboardCharts';
import PDMigrationChart from '../../components/Dashboard/PDMigrationChart';
import DashboardZonaSector from '../../components/Dashboard/DashboardZonaSector';
import DashboardOnePage from '../../components/Dashboard/DashboardOnePage';
import DashboardTable from '../../components/Dashboard/DashboardTable';
import TopGestoresTable from '../../components/Dashboard/TopGestoresTable';
import TopZonasTable from '../../components/Dashboard/TopZonasTable';
import ResumenPdTable from '../../components/Dashboard/ResumenPdTable';
import ResumenCampaniaTable from '../../components/Dashboard/ResumenCampaniaTable';
import { useDashboard } from '../../hooks/useDashboard';
import { useTasasConversion } from '../../hooks/useTasasConversion';
import { useAuth } from '../../context/AuthContext';
import { getCalidadResumen } from '../../services/controlService';
import { MONEDA_OPTIONS } from '../../utils/monedaOptions';
import type { DashboardFilterOptions, DashboardFilterParams, DashboardMultiFilterParams, DashboardKpi } from '../../types/cartera';

const TABLE_TILE = 300;
const DETAIL_TILE = 360;
const EMPTY_OPTIONS: DashboardFilterOptions = { pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] };
const sanitizeSelectedValues = (values: string[], availableOptions: string[]) => values.filter((value) => availableOptions.includes(value));

const DashboardPage = () => {
  const [filters, setFilters] = useState<DashboardMultiFilterParams>({ pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] });
  const [monedaFiltro, setMonedaFiltro] = useState<string>('USD');
  const [onePageOpen, setOnePageOpen] = useState(false);
  const dashboardFilters: DashboardFilterParams = useMemo(() => ({ pais: filters.pais, gestor: filters.gestor, gerente: filters.gerente, zona: filters.zona, pd: filters.pd, campania: filters.campania }), [filters]);
  const { data: dashboard, loading, error } = useDashboard(dashboardFilters);
  const { hasPermission } = useAuth();
  const canCalidadVer = hasPermission('control_operativo.calidad.ver');
  const [calNota, setCalNota] = useState<{ nota: number; evaluaciones: number } | null>(null);

  // Tasas de conversión oficiales (Configuración > Tasas de Conversión, tabla Supabase
  // config_tasas_conversion): fuente única para convertir USD a la moneda local
  // seleccionada en todo el Dashboard. `useTasasConversion` es el único punto de lectura
  // (también usado por ConversionRates) y se refresca solo, sin depender de una recarga.
  const { tasas, error: tasasError } = useTasasConversion();

  useEffect(() => {
    if (!canCalidadVer) { setCalNota(null); return; }
    let active = true;
    getCalidadResumen(dashboardFilters).then((r) => { if (active) setCalNota({ nota: r.notaGlobal, evaluaciones: r.evaluaciones }); }).catch(() => { if (active) setCalNota(null); });
    return () => { active = false; };
  }, [canCalidadVer, dashboardFilters]);

  const availableOptions = dashboard?.filterOptions ?? EMPTY_OPTIONS;
  useEffect(() => {
    if (!dashboard) return;
    const sanitized = {
      pais: sanitizeSelectedValues(filters.pais, availableOptions.pais), zona: sanitizeSelectedValues(filters.zona, availableOptions.zona),
      gestor: sanitizeSelectedValues(filters.gestor, availableOptions.gestor), gerente: sanitizeSelectedValues(filters.gerente, availableOptions.gerente),
      pd: sanitizeSelectedValues(filters.pd, availableOptions.pd), campania: sanitizeSelectedValues(filters.campania, availableOptions.campania)
    };
    const isSame = (a: string[], b: string[]) => a.length === b.length && a.every((value, index) => value === b[index]);
    if (!isSame(sanitized.pais, filters.pais) || !isSame(sanitized.zona, filters.zona) || !isSame(sanitized.gestor, filters.gestor) || !isSame(sanitized.gerente, filters.gerente) || !isSame(sanitized.pd, filters.pd) || !isSame(sanitized.campania, filters.campania)) setFilters(sanitized);
  }, [dashboard, availableOptions, filters]);

  const handleChangeFilters = (nextFilters: DashboardMultiFilterParams) => setFilters({
    pais: sanitizeSelectedValues(nextFilters.pais, availableOptions.pais), zona: sanitizeSelectedValues(nextFilters.zona, availableOptions.zona),
    gestor: sanitizeSelectedValues(nextFilters.gestor, availableOptions.gestor), gerente: sanitizeSelectedValues(nextFilters.gerente, availableOptions.gerente),
    pd: sanitizeSelectedValues(nextFilters.pd, availableOptions.pd), campania: sanitizeSelectedValues(nextFilters.campania, availableOptions.campania)
  });
  const handleClearFilters = () => setFilters({ pais: [], gestor: [], gerente: [], zona: [], pd: [], campania: [] });

  if (loading && !dashboard) return <Box sx={{ p: 2 }}><Typography sx={{ fontSize: 14 }}>Cargando información del dashboard...</Typography></Box>;
  if (error || !dashboard) return <Box sx={{ p: 2 }}><Typography sx={{ fontSize: 14 }} color="error">{error ?? 'No se pudo cargar la información del dashboard.'}</Typography></Box>;

  const hasFiltersApplied = Object.values(filters).some((list) => list.length > 0);
  if (!hasFiltersApplied && (dashboard.kpis?.totalCuentas ?? 0) === 0) return <Box sx={{ p: 4, textAlign: 'center' }}><Typography sx={{ fontSize: 16, fontWeight: 600 }}>No hay datos disponibles para tu alcance actual.</Typography><Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.5 }}>No tienes cuentas asignadas dentro de tu alcance de acceso.</Typography></Box>;

  const monedaOption = MONEDA_OPTIONS.find((option) => option.code === monedaFiltro) ?? MONEDA_OPTIONS[0];
  const monedaCode = monedaOption.code;
  const monedaLabel = monedaCode;
  // Tasa oficial configurada para la moneda seleccionada (fuente única: Configuración > Tasas
  // de Conversión, tabla Supabase config_tasas_conversion, vía useTasasConversion). Se aplica a
  // TODAS las monedas por igual, incluyendo USD/El Salvador: la tasa guardada es la fuente de
  // verdad, sin ninguna moneda exenta. Si la tasa de la moneda seleccionada no está disponible
  // (fallo de red o fila faltante), no se asume 1 en silencio: se muestra una alerta explícita.
  const tasaDisponible = tasas[monedaCode] !== undefined;
  const tasaActual = tasaDisponible ? tasas[monedaCode] : 1;
  const resumenPDConTasa = dashboard.resumenPD.map((p) => ({
    ...p,
    saldoAsignadoLocal: p.saldoAsignadoUsd * tasaActual,
    saldoActualLocal: p.saldoActualUsd * tasaActual,
    recuperadoLocal: p.recuperadoUsd * tasaActual,
    porcentajeRecuperacionLocal: p.porcentajeRecuperacionUsd
  }));
  const resumenCampaniaConTasa = dashboard.resumenCampania.map((c) => ({
    ...c,
    saldoAsignadoLocal: c.saldoAsignadoUsd * tasaActual,
    saldoActualLocal: c.saldoActualUsd * tasaActual
  }));
  const topGestoresConTasa = dashboard.topGestoresDetalle.map((g) => ({
    ...g,
    saldoAsignadoLocal: g.saldoAsignadoUsd * tasaActual,
    saldoActualLocal: g.saldoActualUsd * tasaActual,
    recuperadoLocal: g.recuperadoUsd * tasaActual
  }));
  const topZonasConTasa = dashboard.topZonasDetalle.map((z) => ({
    ...z,
    saldoAsignadoLocal: z.saldoAsignadoUsd * tasaActual,
    saldoActualLocal: z.saldoActualUsd * tasaActual,
    recuperadoLocal: z.recuperadoUsd * tasaActual
  }));
  const zonaSectorConTasa = dashboard.zonaSectorSummary.map((z) => ({
    ...z,
    saldoActualLocal: z.saldoActualUsd * tasaActual,
    sectores: z.sectores.map((s) => ({ ...s, saldoActualLocal: s.saldoActualUsd * tasaActual }))
  }));
  const localTotals = resumenPDConTasa.reduce((a, p) => ({ asignado: a.asignado + p.saldoAsignadoLocal, actual: a.actual + p.saldoActualLocal, recuperado: a.recuperado + p.recuperadoLocal }), { asignado: 0, actual: 0, recuperado: 0 });
  // La tasa configurada se aplica siempre, para cualquier moneda seleccionada (incluido USD):
  // los KPIs se calculan siempre a partir de los saldos ya multiplicados por tasaActual.
  const kpisDisplay: DashboardKpi = { saldoAsignado: localTotals.asignado, saldoActual: localTotals.actual, recuperado: localTotals.recuperado, porcentajeRecuperacion: dashboard.kpis.porcentajeRecuperacion, totalCuentas: dashboard.kpis.totalCuentas };

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 2, alignItems: 'stretch', width: '100%' }}>
      <Box sx={{ gridColumn: '1 / -1' }}>
        <DashboardFilters filters={filters} onChange={handleChangeFilters} onClear={handleClearFilters} options={availableOptions} moneda={monedaFiltro} onMonedaChange={setMonedaFiltro} />
      </Box>
      <Box sx={{ gridColumn: '1 / -1', mt: '19px' }}><ConversionRates /></Box>
      {(tasasError || !tasaDisponible) && (
        <Box sx={{ gridColumn: '1 / -1' }}>
          <Alert severity="warning">
            No se pudo obtener la tasa oficial de {monedaCode} desde Configuración. Los valores mostrados pueden no reflejar la tasa configurada.
          </Alert>
        </Box>
      )}
      <Box sx={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 1.5 }}>
        <Button variant="outlined" startIcon={<DescriptionOutlinedIcon />} onClick={() => setOnePageOpen(true)} sx={{ textTransform: 'none' }}>Generar OnePage</Button>
      </Box>
      <Box sx={{ gridColumn: '1 / -1' }}><KpiCards kpis={kpisDisplay} moneda={monedaLabel} /></Box>
      <Box sx={{ gridColumn: '1 / -1' }}>
        <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
          <DashboardCharts
            filters={dashboardFilters}
            moneda="LOCAL"
            monedaCode={monedaCode}
            tasa={tasaActual}
            pdMigrationChart={<PDMigrationChart filters={dashboardFilters} moneda="LOCAL" monedaCode={monedaCode} tasa={tasaActual} />}
            zonaSector={<DashboardZonaSector filters={dashboardFilters} moneda="LOCAL" monedaCode={monedaCode} tasa={tasaActual} />}
          />
        </Box>
      </Box>
      <Box sx={{ gridColumn: { xs: '1 / -1', md: 'span 6' }, height: TABLE_TILE }}><ResumenPdTable filters={dashboardFilters} moneda="LOCAL" monedaCode={monedaCode} tasa={tasaActual} /></Box>
      <Box sx={{ gridColumn: { xs: '1 / -1', md: 'span 6' }, height: TABLE_TILE }}><ResumenCampaniaTable data={resumenCampaniaConTasa} moneda="LOCAL" monedaCode={monedaCode} /></Box>
      <Box sx={{ gridColumn: { xs: '1 / -1', md: 'span 6' }, height: TABLE_TILE }}><TopGestoresTable data={topGestoresConTasa} moneda="LOCAL" monedaCode={monedaCode} /></Box>
      <Box sx={{ gridColumn: { xs: '1 / -1', md: 'span 6' }, height: TABLE_TILE }}><TopZonasTable data={topZonasConTasa} moneda="LOCAL" monedaCode={monedaCode} /></Box>
      <Box sx={{ gridColumn: '1 / -1', height: DETAIL_TILE }}><DashboardTable data={dashboard.cuentas} moneda="LOCAL" monedaCode={monedaCode} tasa={tasaActual} /></Box>
      <DashboardOnePage open={onePageOpen} onClose={() => setOnePageOpen(false)} filters={filters} kpis={kpisDisplay} moneda={monedaLabel} calidad={calNota} puedeCalidad={canCalidadVer} zonaSector={zonaSectorConTasa} resumenPD={resumenPDConTasa} />
    </Box>
  );
};

export default DashboardPage;
