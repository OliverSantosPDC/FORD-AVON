import { Request, Response } from 'express';
import { CarteraService } from '../services/CarteraService';
import { CarteraRepository } from '../repositories/CarteraRepository';
import { getCarteraDataSource } from '../config/dataSource';
import { getCentroInteligencia, construirFilterOptionsCentro, type CentroFiltros } from '../services/InteligenciaService';

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
      // Opciones de filtro EN CASCADA (Sección 6): las filas ya vienen con el
      // Scope de seguridad aplicado (frontera en listCartera); cada dimensión
      // respeta las DEMÁS dimensiones ya seleccionadas (construirFilterOptionsCentro,
      // misma lógica probada en InteligenciaService) — nunca depende de
      // cartera.gestor como catálogo de personas.
      const scopedAll = await carteraService.listCartera({}, undefined, ctx);
      const filterOptions = construirFilterOptionsCentro(scopedAll, filtros);

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
