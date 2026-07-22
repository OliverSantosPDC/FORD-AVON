import { Request, Response } from 'express';
import { CarteraService } from '../services/CarteraService';

export class DashboardController {
  private readonly service: CarteraService;

  constructor(service: CarteraService) {
    this.service = service;
  }

  async getDashboard(req: Request, res: Response): Promise<Response> {
    try {
      const filters = extractFilters(req.query);
      const dashboard = await this.service.getDashboard(filters);
      return res.json(dashboard);
    } catch (error) {
      if (error instanceof Error) {
        return res.status(500).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Error desconocido al generar el dashboard.' });
    }
  }

  async getInteligencia(_req: Request, res: Response): Promise<Response> {
    try {
      const inteligencia = await this.service.getInteligencia();
      return res.json(inteligencia);
    } catch (error) {
      if (error instanceof Error) {
        return res.status(500).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Error desconocido al generar el centro de inteligencia.' });
    }
  }
}

const parseFilterValue = (value: unknown): string[] | undefined => {
  if (typeof value === 'string') {
    const items = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length ? items : undefined;
  }

  if (Array.isArray(value)) {
    const items = value
      .flatMap((item) => (typeof item === 'string' ? item.split(',') : []))
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length ? items : undefined;
  }

  return undefined;
};

const extractFilters = (query: Record<string, unknown>) => {
  return {
    pais: parseFilterValue(query['pais']),
    gestor: parseFilterValue(query['gestor']),
    gerente: parseFilterValue(query['gerente']),
    zona: parseFilterValue(query['zona']),
    pd: parseFilterValue(query['pd']),
    campania: parseFilterValue(query['campania']),
    fecha: parseFilterValue(query['fecha'])
  };
};
