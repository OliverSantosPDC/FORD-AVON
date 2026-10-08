import { useState } from 'react';
import { Box, Tab, Tabs } from '@mui/material';
import CargarCarteraPage from '../CargarCartera';
import GestionCalendario from '../Calendario/GestionCalendario';
import { useAuth } from '../../context/AuthContext';

const RepositorioPage = () => {
  const { hasPermission } = useAuth();
  const puedeCalendario = hasPermission('calendario.crear');
  const [tab, setTab] = useState(() => {
    const raw = new URLSearchParams(window.location.search).get('tab');
    return raw === '2' ? 2 : 0;
  });
  const visible = (value: number) => value === 0 || (value === 2 ? puedeCalendario : false);
  const activeTab = visible(tab) ? tab : 0;
  const changeTab = (_e: React.SyntheticEvent, value: number) => {
    if (!visible(value)) return;
    setTab(value);
    const params = new URLSearchParams(window.location.search);
    params.set('tab', String(value));
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  };
  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      <Tabs value={activeTab} onChange={changeTab} sx={{ mb: 2 }}>
        <Tab value={0} label="Gestión de Cartera" sx={{ textTransform: 'none' }} />
        {puedeCalendario && <Tab value={2} label="Gestión de calendario" sx={{ textTransform: 'none' }} />}
      </Tabs>
      {activeTab === 0 && <CargarCarteraPage />}
      {activeTab === 2 && puedeCalendario && <GestionCalendario />}
    </Box>
  );
};
export default RepositorioPage;
