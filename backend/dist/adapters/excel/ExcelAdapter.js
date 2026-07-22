"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExcelAdapter = void 0;
const path_1 = __importDefault(require("path"));
const exceljs_1 = __importDefault(require("exceljs"));
class ExcelAdapter {
    constructor(basePath) {
        this.basePath = basePath;
    }
    async readSheet(fileName, sheetName) {
        const filePath = path_1.default.join(this.basePath, fileName);
        const workbook = new exceljs_1.default.Workbook();
        try {
            await workbook.xlsx.readFile(filePath);
        }
        catch (error) {
            throw new Error(`Archivo no encontrado o no se pudo abrir: ${fileName}`);
        }
        const normalizedSheetName = sheetName.toUpperCase();
        const worksheet = workbook.worksheets.find((sheet) => sheet.name.toUpperCase() === normalizedSheetName);
        if (!worksheet) {
            const availableSheets = workbook.worksheets.map((sheet) => sheet.name).join(', ');
            throw new Error(`Hoja no encontrada: ${sheetName}. Hojas disponibles: ${availableSheets}`);
        }
        const headerRow = worksheet.getRow(1);
        const headerValues = Array.isArray(headerRow.values) ? headerRow.values : [];
        const headers = headerValues
            .slice(1)
            .map((value) => (value === null || value === undefined ? '' : String(value)));
        if (headers.length === 0) {
            throw new Error(`Hoja vacía o sin encabezados: ${sheetName}`);
        }
        const records = [];
        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) {
                return;
            }
            const rowData = {};
            headers.forEach((header, index) => {
                const cell = row.getCell(index + 1);
                const value = cell.value;
                rowData[header] = value === null || value === undefined ? null : this.serializeCellValue(value);
            });
            records.push(rowData);
        });
        return records;
    }
    serializeCellValue(value) {
        if (value === null) {
            return null;
        }
        if (typeof value === 'object') {
            if ('text' in value && typeof value.text === 'string') {
                return value.text;
            }
            if ('richText' in value) {
                return value.richText?.map((part) => part.text).join('') ?? null;
            }
            return JSON.stringify(value);
        }
        return value;
    }
}
exports.ExcelAdapter = ExcelAdapter;
