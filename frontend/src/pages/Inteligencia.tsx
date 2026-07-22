import { Box, Container, Grid, Paper, TextField, Typography } from '@mui/material';
import { useMemo, useState } from 'react';
import useInteligencia from '../hooks/useInteligencia';
import InteligenciaTopCuentasTable from '../components/Inteligencia/InteligenciaTopCuentasTable';
import InteligenciaRankingTable from '../components/Inteligencia/InteligenciaRankingTable';
import InteligenciaRiesgosChart from '../components/Inteligencia/InteligenciaRiesgosChart';

const InteligenciaPage = () => {
  const [search, setSearch] = useState('');
  const { data, loading, error } = useInteligencia();

  const filteredTopCuentas = useMemo(() => {
    if (!data) return [];
    const normalized = search.toLowerCase();
    return data.topCuentas.filter((account) =>
      [account.codigo, account.nombre, account.pais, account.gestor, account.pd]
        .join(' ')
        .toLowerCase()
        .includes(normalized)
    );
  }, [data, search]);

  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ py: 3 }}>
        <Typography variant="h5">Cargando Centro de Inteligencia...</Typography>
      </Container>
    );
  }

  if (error || !data) {
    return (
      <Container maxWidth="xl" sx={{ py: 3 }}>
        <Typography variant="h5" color="error">
          {error ?? 'No se pudo cargar el Centro de Inteligencia.'}
        </Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" fontWeight={700} gutterBottom>
          Centro de Inteligencia
        </Typography>
        <Typography color="text.secondary">Análisis de riesgo, recuperación y desempeño por gestor y país.</Typography>
      </Box>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3, borderRadius: 3, boxShadow: 1 }}>
            <Typography variant="subtitle1" color="text.secondary">
              Total de Riesgo
            </Typography>
            <Typography variant="h4" fontWeight={700} sx={{ mt: 2 }}>
              ${data.riesgos.reduce((sum, item) => sum + item.saldoActual, 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3, borderRadius: 3, boxShadow: 1 }}>
            <Typography variant="subtitle1" color="text.secondary">
              Total Recuperado
            </Typography>
            <Typography variant="h4" fontWeight={700} sx={{ mt: 2 }}>
              ${data.rankingPaises.reduce((sum, item) => sum + item.recuperado, 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3, borderRadius: 3, boxShadow: 1 }}>
            <Typography variant="subtitle1" color="text.secondary">
              % Recuperación
            </Typography>
            <Typography variant="h4" fontWeight={700} sx={{ mt: 2 }}>
              {(() => {
                const totalAsignado = data.rankingPaises.reduce((sum, item) => sum + item.saldoActual + item.recuperado, 0);
                const totalRecuperado = data.rankingPaises.reduce((sum, item) => sum + item.recuperado, 0);
                return totalAsignado === 0 ? '0.00%' : `${((totalRecuperado / totalAsignado) * 100).toFixed(2)}%`;
              })()}
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3, borderRadius: 3, boxShadow: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" fontWeight={700}>
                Top 20 cuentas
              </Typography>
              <TextField
                size="small"
                label="Buscar cuentas"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Box>
            <InteligenciaTopCuentasTable data={filteredTopCuentas} />
          </Paper>
        </Grid>

        <Grid item xs={12} md={4}>
          <InteligenciaRiesgosChart data={data.riesgos} />
        </Grid>
      </Grid>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={6}>
          <InteligenciaRankingTable title="Ranking Gestores" columns={[ 'Gestor', 'Cuentas', 'Saldo Asignado', 'Saldo Actual', 'Recuperado', '% Recuperación' ]} data={data.rankingGestores} type="gestores" />
        </Grid>
        <Grid item xs={12} md={6}>
          <InteligenciaRankingTable title="Ranking Países" columns={[ 'País', 'Cuentas', 'Saldo Actual', 'Recuperado', '% Recuperación' ]} data={data.rankingPaises} type="paises" />
        </Grid>
      </Grid>
    </Container>
  );
};

export default InteligenciaPage;
