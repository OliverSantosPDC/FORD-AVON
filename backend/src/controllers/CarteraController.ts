import { Request, Response } from 'express';
import { CarteraService } from '../services/CarteraService';

export class CarteraController {
  private readonly service: CarteraService;

  constructor(service: CarteraService) {
    this.service = service;
  }

  async getCartera(req: Request, res: Response): Promise<Response> {
    try {
      const data = await this.service.listCartera();
      return res.json(data);
    } catch (error) {
      if (error instanceof Error) {
        return res.status(500).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Error desconocido al leer la cartera.' });
    }
  }
}
