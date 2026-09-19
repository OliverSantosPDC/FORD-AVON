import { useEffect, useState } from 'react';
import { CarteraRecord, DashboardFilterParams } from '../types/cartera';
import { fetchCartera } from '../services/carteraService';

/**
 * Fuente ÚNICA de `/api/cartera` para el Dashboard. Antes, DashboardCharts,
 * DashboardZonaSector, PDMigrationChart y ResumenPdTable llamaban cada uno
 * su propio `fetchCartera(filters)` con los MISMOS filtros — 4 requests
 * idénticos y redundantes por carga/cambio de filtro (auditado: cada uno
 * repite en el backend el mismo costo de scope+filtrado sobre toda la
 * cartera). Este hook se usa UNA vez en DashboardPage y su resultado se pasa
 * como prop a los 4 componentes.
 */
export const useCarteraRows = (filters: DashboardFilterParams) => {
  const [cuentas, setCuentas] = useState<CarteraRecord[]>([]);

  useEffect(() => {
    let active = true;
    fetchCartera(filters).then((data) => { if (active) setCuentas(data); }).catch(() => { if (active) setCuentas([]); });
    return () => { active = false; };
  }, [filters]);

  return cuentas;
};
