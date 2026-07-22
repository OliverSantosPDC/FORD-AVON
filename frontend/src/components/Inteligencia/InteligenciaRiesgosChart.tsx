import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Paper, Typography, Box } from '@mui/material';
import type { RiesgoItem } from '../../types/cartera';

interface InteligenciaRiesgosChartProps {
  data: RiesgoItem[];
}

const InteligenciaRiesgosChart = ({ data }: InteligenciaRiesgosChartProps) => {
  const chartData = data.map((item) => ({
    pd: item.pd,
    saldoActual: item.saldoActual
  }));

  return (
    <Paper sx={{ p: 3, borderRadius: 3, boxShadow: 1, height: '100%' }}>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>
        Riesgo por PD
      </Typography>
      <Box sx={{ height: 360 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="pd" interval={0} angle={-25} textAnchor="end" height={80} />
            <YAxis tickFormatter={(value) => `$${value.toLocaleString()}`} />
            <Tooltip formatter={(value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
            <Bar dataKey="saldoActual" fill="#1976d2" />
          </BarChart>
        </ResponsiveContainer>
      </Box>
    </Paper>
  );
};

export default InteligenciaRiesgosChart;
