"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const carteraRoutes_1 = __importDefault(require("./routes/carteraRoutes"));
const dashboardRoutes_1 = __importDefault(require("./routes/dashboardRoutes"));
const app = (0, express_1.default)();
const port = process.env.PORT ?? 4000;
app.use(express_1.default.json());
app.use('/api', carteraRoutes_1.default);
app.use('/api', dashboardRoutes_1.default);
app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});
app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: err.message ?? 'Error interno del servidor' });
});
app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
});
