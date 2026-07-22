"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CarteraRepository = void 0;
class CarteraRepository {
    constructor(adapter) {
        this.fileName = 'cartera.xlsx';
        this.sheetName = 'Cartera';
        this.adapter = adapter;
    }
    async getCartera() {
        return this.adapter.readSheet(this.fileName, this.sheetName);
    }
}
exports.CarteraRepository = CarteraRepository;
