"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CarteraController = void 0;
class CarteraController {
    constructor(service) {
        this.service = service;
    }
    async getCartera(req, res) {
        try {
            const data = await this.service.listCartera();
            return res.json(data);
        }
        catch (error) {
            if (error instanceof Error) {
                return res.status(500).json({ error: error.message });
            }
            return res.status(500).json({ error: 'Error desconocido al leer la cartera.' });
        }
    }
}
exports.CarteraController = CarteraController;
