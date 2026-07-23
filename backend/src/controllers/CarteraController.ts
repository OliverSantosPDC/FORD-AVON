import { Request, Response } from 'express';
import { CarteraService } from '../services/CarteraService';
import { DashboardFilterParams } from '../models/Cartera';

export class CarteraController {
  private readonly service: CarteraService;

  constructor(service: CarteraService) {
    this.service = service;
  }

  async getCartera(req: Request, res: Response): Promise<Response> {
    try {
      const filters = extractFilters(req.query);
      const limit = extractLimit(req.query);
      const data = await this.service.listCartera(filters, limit);
      return res.json(data);
    } catch (error) {
      if (error instanceof Error) {
        return res.status(500).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Error desconocido al leer la cartera.' });
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

const extractFilters = (query: Record<string, unknown>): DashboardFilterParams => ({
  pais: parseFilterValue(query['pais']),
  gestor: parseFilterValue(query['gestor']),
  gerente: parseFilterValue(query['gerente']),
  zona: parseFilterValue(query['zona']),
  pd: parseFilterValue(query['pd']),
  campania: parseFilterValue(query['campania'])
});

const extractLimit = (query: Record<string, unknown>): number | undefined => {
  const raw = query['limit'];
  const value = typeof raw === 'string' ? Number(raw) : Array.isArray(raw) ? Number(raw[0]) : NaN;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
};
