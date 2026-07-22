"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CarteraService = void 0;
class CarteraService {
    constructor(repository) {
        this.repository = repository;
    }
    async listCartera() {
        return this.repository.getCartera();
    }
    async getDashboard(filters) {
        const rows = await this.repository.getCartera();
        const cartera = rows.map(mapToCartera);
        const filtered = applyFilters(cartera, filters);
        return {
            kpis: calculateKpis(filtered),
            paises: aggregateBy(filtered, 'pais'),
            pds: aggregateBy(filtered, 'pd'),
            topGestores: calculateTopGestores(filtered),
            topZonas: calculateTopZonas(filtered),
            resumenPD: calculateResumenPD(filtered)
        };
    }
    async getInteligencia() {
        const rows = await this.repository.getCartera();
        const cartera = rows.map(mapToCartera);
        return {
            topCuentas: calculateTopCuentas(cartera),
            riesgos: calculateRiesgos(cartera),
            rankingGestores: calculateRankingGestores(cartera),
            rankingPaises: calculateRankingPaises(cartera)
        };
    }
}
exports.CarteraService = CarteraService;
const parseNumber = (value) => {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === 'string') {
        const normalized = value.replace(/\s+/g, '').replace(/\./g, '').replace(/,/g, '.').replace(/[^0-9.-]/g, '');
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
};
const getField = (row, ...keys) => {
    const lookup = new Map();
    Object.keys(row).forEach((key) => {
        lookup.set(key.toLowerCase(), row[key]);
    });
    for (const key of keys) {
        const value = lookup.get(key.toLowerCase());
        if (value !== undefined && value !== null) {
            return value;
        }
    }
    return undefined;
};
const mapToCartera = (row) => {
    const castString = (value, fallback) => value === null || value === undefined ? fallback : String(value);
    const pais = castString(getField(row, 'pais'), 'Sin país');
    const pd = castString(getField(row, 'pd_actual', 'pd'), 'Sin PD');
    const fecha = getField(row, 'fecha_de_nacimiento') ? String(getField(row, 'fecha_de_nacimiento')) : undefined;
    const saldoInicialLocal = parseNumber(getField(row, 'saldo_inicial') ?? 0);
    const saldoActualLocal = parseNumber(getField(row, 'saldo_actual') ?? 0);
    const saldoAsignado = parseNumber(getField(row, 'saldo_inicial_usd', 'saldo_inicial') ?? 0);
    const saldoActual = parseNumber(getField(row, 'saldo_actual_usd', 'saldo_actual') ?? 0);
    return {
        pais,
        pd,
        fecha,
        saldoInicialLocal,
        saldoActualLocal,
        saldoAsignado,
        saldoActual,
        gestor: getField(row, 'gestor') ? String(getField(row, 'gestor')) : undefined,
        gerente: getField(row, 'gerente_zona') ? String(getField(row, 'gerente_zona')) : undefined,
        zona: getField(row, 'zona') ? String(getField(row, 'zona')) : undefined,
        cliente: getField(row, 'nombre', 'cliente', 'deudor') ? String(getField(row, 'nombre', 'cliente', 'deudor')) : undefined,
        campania: getField(row, 'campania_adeuda', 'campania', 'campaña', 'campaign') ? String(getField(row, 'campania_adeuda', 'campania', 'campaña', 'campaign')) : undefined,
        codigo: getField(row, 'codigo', 'code', 'id') ? String(getField(row, 'codigo', 'code', 'id')) : undefined,
        nombre: getField(row, 'nombre', 'cliente', 'deudor') ? String(getField(row, 'nombre', 'cliente', 'deudor')) : undefined,
        original: row
    };
};
const normalize = (value) => value?.trim().toLocaleLowerCase();
const normalizeList = (values) => values?.map((value) => value.trim().toLocaleLowerCase()).filter(Boolean);
const applyFilters = (items, filters) => {
    if (!filters) {
        return items;
    }
    const normalized = {
        pais: normalizeList(filters.pais),
        gestor: normalizeList(filters.gestor),
        gerente: normalizeList(filters.gerente),
        zona: normalizeList(filters.zona),
        pd: normalizeList(filters.pd),
        campania: normalizeList(filters.campania),
        fecha: normalizeList(filters.fecha)
    };
    return items.filter((item) => {
        if (normalized.pais && normalized.pais.length && !normalized.pais.includes(item.pais.toLocaleLowerCase())) {
            return false;
        }
        if (normalized.gestor && normalized.gestor.length && !normalized.gestor.includes(item.gestor?.toLocaleLowerCase() ?? '')) {
            return false;
        }
        if (normalized.gerente && normalized.gerente.length && !normalized.gerente.includes(item.gerente?.toLocaleLowerCase() ?? '')) {
            return false;
        }
        if (normalized.zona && normalized.zona.length && !normalized.zona.includes(item.zona?.toLocaleLowerCase() ?? '')) {
            return false;
        }
        if (normalized.pd && normalized.pd.length && !normalized.pd.includes(item.pd.toLocaleLowerCase())) {
            return false;
        }
        if (normalized.campania && normalized.campania.length && !normalized.campania.includes(item.campania?.toLocaleLowerCase() ?? '')) {
            return false;
        }
        if (normalized.fecha && normalized.fecha.length && !normalized.fecha.includes(item.fecha?.toLocaleLowerCase() ?? '')) {
            return false;
        }
        return true;
    });
};
const calculateKpis = (items) => {
    const saldoAsignado = items.reduce((sum, item) => sum + item.saldoAsignado, 0);
    const saldoActual = items.reduce((sum, item) => sum + item.saldoActual, 0);
    const recuperado = saldoAsignado - saldoActual;
    const porcentajeRecuperacion = saldoAsignado === 0 ? 0 : Number(((recuperado / saldoAsignado) * 100).toFixed(2));
    const totalCuentas = items.length;
    return {
        saldoAsignado,
        saldoActual,
        recuperado,
        porcentajeRecuperacion,
        totalCuentas
    };
};
const aggregateBy = (items, field) => {
    const totals = new Map();
    items.forEach((item) => {
        const key = item[field] || (field === 'pais' ? 'Sin país' : 'Sin PD');
        const existing = totals.get(key) ?? { totalUsd: 0, totalLocal: 0 };
        totals.set(key, {
            totalUsd: existing.totalUsd + item.saldoAsignado,
            totalLocal: existing.totalLocal + item.saldoInicialLocal
        });
    });
    return Array.from(totals.entries())
        .map(([nombre, totals]) => ({ nombre, totalUsd: totals.totalUsd, totalLocal: totals.totalLocal }))
        .sort((a, b) => b.totalUsd - a.totalUsd);
};
const calculateTopGestores = (items) => {
    const totals = new Map();
    items.forEach((item) => {
        const gestor = item.gestor || 'Sin gestor';
        const existing = totals.get(gestor) ?? { recuperadoUsd: 0, recuperadoLocal: 0, cuentas: 0 };
        totals.set(gestor, {
            recuperadoUsd: existing.recuperadoUsd + (item.saldoAsignado - item.saldoActual),
            recuperadoLocal: existing.recuperadoLocal + (item.saldoInicialLocal - item.saldoActualLocal),
            cuentas: existing.cuentas + 1
        });
    });
    return Array.from(totals.entries())
        .map(([nombre, values]) => ({
        nombre,
        recuperadoUsd: values.recuperadoUsd,
        recuperadoLocal: values.recuperadoLocal,
        cuentas: values.cuentas
    }))
        .sort((a, b) => b.recuperadoUsd - a.recuperadoUsd)
        .slice(0, 10);
};
const calculateTopZonas = (items) => {
    const totals = new Map();
    items.forEach((item) => {
        const zona = item.zona || 'Sin zona';
        const existing = totals.get(zona) ?? { saldoActualUsd: 0, saldoActualLocal: 0, cuentas: 0 };
        totals.set(zona, {
            saldoActualUsd: existing.saldoActualUsd + item.saldoActual,
            saldoActualLocal: existing.saldoActualLocal + item.saldoActualLocal,
            cuentas: existing.cuentas + 1
        });
    });
    return Array.from(totals.entries())
        .map(([zona, values]) => ({ zona, saldoActualUsd: values.saldoActualUsd, saldoActualLocal: values.saldoActualLocal, cuentas: values.cuentas }))
        .sort((a, b) => b.saldoActualUsd - a.saldoActualUsd)
        .slice(0, 10);
};
const calculateResumenPD = (items) => {
    const totals = new Map();
    items.forEach((item) => {
        const pd = item.pd || 'Sin PD';
        const existing = totals.get(pd) ?? {
            saldoActualUsd: 0,
            saldoAsignadoUsd: 0,
            saldoActualLocal: 0,
            saldoInicialLocal: 0,
            cuentas: 0
        };
        totals.set(pd, {
            saldoActualUsd: existing.saldoActualUsd + item.saldoActual,
            saldoAsignadoUsd: existing.saldoAsignadoUsd + item.saldoAsignado,
            saldoActualLocal: existing.saldoActualLocal + item.saldoActualLocal,
            saldoInicialLocal: existing.saldoInicialLocal + item.saldoInicialLocal,
            cuentas: existing.cuentas + 1
        });
    });
    return Array.from(totals.entries())
        .map(([pd, values]) => {
        const recuperadoUsd = values.saldoAsignadoUsd - values.saldoActualUsd;
        const porcentajeRecuperacionUsd = values.saldoAsignadoUsd === 0 ? 0 : Number(((recuperadoUsd / values.saldoAsignadoUsd) * 100).toFixed(2));
        const recuperadoLocal = values.saldoInicialLocal - values.saldoActualLocal;
        const porcentajeRecuperacionLocal = values.saldoInicialLocal === 0 ? 0 : Number(((recuperadoLocal / values.saldoInicialLocal) * 100).toFixed(2));
        return {
            pd,
            cuentas: values.cuentas,
            saldoActualUsd: values.saldoActualUsd,
            saldoAsignadoUsd: values.saldoAsignadoUsd,
            recuperadoUsd,
            porcentajeRecuperacionUsd,
            saldoActualLocal: values.saldoActualLocal,
            saldoAsignadoLocal: values.saldoInicialLocal,
            recuperadoLocal,
            porcentajeRecuperacionLocal
        };
    })
        .sort((a, b) => b.saldoAsignadoUsd - a.saldoAsignadoUsd);
};
const calculateTopCuentas = (items) => {
    return [...items]
        .sort((a, b) => b.saldoActual - a.saldoActual)
        .slice(0, 20)
        .map((item) => ({
        codigo: item.codigo ?? String(item.original?.['codigo'] ?? item.original?.['code'] ?? item.original?.['id'] ?? 'N/A'),
        nombre: item.nombre ?? item.cliente ?? String(item.original?.['nombre'] ?? item.original?.['cliente'] ?? item.original?.['deudor'] ?? 'N/A'),
        pais: item.pais,
        gestor: item.gestor ?? 'Sin gestor',
        pd: item.pd,
        saldoActual: item.saldoActual
    }));
};
const calculateRiesgos = (items) => {
    const buckets = new Map();
    const pdKeys = ['PD0', 'PD1', 'PD2', 'PD3', 'PD4', 'PD5', 'PD6', 'PD7'];
    pdKeys.forEach((pd) => buckets.set(pd, { cuentas: 0, saldoActual: 0 }));
    items.forEach((item) => {
        const pdKey = item.pd.toUpperCase();
        if (buckets.has(pdKey)) {
            const current = buckets.get(pdKey);
            current.cuentas += 1;
            current.saldoActual += item.saldoActual;
        }
    });
    return Array.from(buckets.entries()).map(([pd, values]) => ({ pd, cuentas: values.cuentas, saldoActual: values.saldoActual }));
};
const calculateRankingGestores = (items) => {
    const totals = new Map();
    items.forEach((item) => {
        const nombre = item.gestor ?? 'Sin gestor';
        const current = totals.get(nombre) ?? { cuentas: 0, saldoActual: 0, saldoAsignado: 0 };
        totals.set(nombre, {
            cuentas: current.cuentas + 1,
            saldoActual: current.saldoActual + item.saldoActual,
            saldoAsignado: current.saldoAsignado + item.saldoAsignado
        });
    });
    return Array.from(totals.entries())
        .map(([nombre, values]) => {
        const recuperado = values.saldoAsignado - values.saldoActual;
        const porcentajeRecuperacion = values.saldoAsignado === 0 ? 0 : Number(((recuperado / values.saldoAsignado) * 100).toFixed(2));
        return { nombre, cuentas: values.cuentas, saldoAsignado: values.saldoAsignado, saldoActual: values.saldoActual, recuperado, porcentajeRecuperacion };
    })
        .sort((a, b) => b.saldoActual - a.saldoActual);
};
const calculateRankingPaises = (items) => {
    const totals = new Map();
    items.forEach((item) => {
        const pais = item.pais || 'Sin país';
        const current = totals.get(pais) ?? { cuentas: 0, saldoActual: 0, saldoAsignado: 0 };
        totals.set(pais, {
            cuentas: current.cuentas + 1,
            saldoActual: current.saldoActual + item.saldoActual,
            saldoAsignado: current.saldoAsignado + item.saldoAsignado
        });
    });
    return Array.from(totals.entries())
        .map(([pais, values]) => {
        const recuperado = values.saldoAsignado - values.saldoActual;
        const porcentajeRecuperacion = values.saldoAsignado === 0 ? 0 : Number(((recuperado / values.saldoAsignado) * 100).toFixed(2));
        return { pais, cuentas: values.cuentas, saldoActual: values.saldoActual, recuperado, porcentajeRecuperacion, saldoAsignado: values.saldoAsignado };
    })
        .sort((a, b) => b.saldoActual - a.saldoActual);
};
