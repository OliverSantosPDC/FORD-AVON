import { Request, Response } from 'express';
import { CarteraService } from '../services/CarteraService';
import { CarteraRepository } from '../repositories/CarteraRepository';
import { getCarteraDataSource } from '../config/dataSource';
import { getCentroInteligencia, type CentroFiltros } from '../services/InteligenciaService';

const carteraService = new CarteraService(new CarteraRepository(getCarteraDataSource()));

const parseFilter = (v: unknown): string[] | undefined => {
  if (typeof v === 'string') { const a = v.split(',').map((x) => x.trim()).filter(Boolean); return a.length ? a : undefined; }
  if (Array.isArray(v)) { const a = v.flatMap((x) => (typeof x === 'string' ? x.split(',') : [])).map((x) => x.trim()).filter(Boolean); return a.length ? a : undefined; }
  return undefined;
};

export class InteligenciaController {
  async centro(req: Request, res: Response): Promise<Response> {
    try {
      const ctx = req.auth?.scopeContext;
      if (!ctx) return res.status(403).json({ error: 'Alcance de acceso no disponible.' });
      const q = req.query as Record<string, unknown>;
      const filtros: CentroFiltros = {
        pais: parseFilter(q.pais), zona: parseFilter(q.zona), pd: parseFilter(q.pd),
        gestor: parseFilter(q.gestor), sector: parseFilter(q.sector), riesgo: parseFilter(q.riesgo)
      };
      // Opciones de filtro: filas scoped SIN filtros de usuario (para no vaciar los selects).
      const scopedAll = await carteraService.listCartera({}, undefined, ctx);
      const uniq = (rows: Record<string, unknown>[], ...keys: string[]) =>
        [...new Set(rows.map((r) => { for (const k of keys) { const v = r[k]; if (v !== null && v !== undefined && String(v).trim() !== '') return String(v); } return ''; }).filter(Boolean))].sort();
      const filterOptions = {
        pais: uniq(scopedAll, 'pais'), zona: uniq(scopedAll, 'zona'), sector: uniq(scopedAll, 'sector'),
        pd: uniq(scopedAll, 'pd_actual', 'pd'), riesgo: uniq(scopedAll, 'riesgo', 'nivel_riesgo', 'riesgo_pd'), gestor: uniq(scopedAll, 'gestor')
      };

      // Filtros que aplica listCartera (pais/zona/pd/gestor/gerente/campania).
      const rows = await carteraService.listCartera(
        { pais: filtros.pais, zona: filtros.zona, pd: filtros.pd, gestor: filtros.gestor },
        undefined,
        ctx
      );
      // Filtros adicionales (sector/riesgo) que no maneja listCartera: se aplican aquí.
      let filtradas = rows;
      if (filtros.sector?.length) { const set = new Set(filtros.sector.map((x) => x.toUpperCase())); filtradas = filtradas.filter((r) => set.has(String(r.sector ?? '').toUpperCase())); }
      if (filtros.riesgo?.length) { const set = new Set(filtros.riesgo.map((x) => x.toUpperCase())); filtradas = filtradas.filter((r) => set.has(String(r.riesgo ?? r.nivel_riesgo ?? '').toUpperCase())); }

      const data = await getCentroInteligencia(ctx, filtros, filtradas);
      return res.json({ ...data, filterOptions });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Error al generar el Centro de Inteligencia.' });
    }
  }
}
