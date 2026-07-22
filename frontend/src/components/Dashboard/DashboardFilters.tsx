import Autocomplete from '@mui/material/Autocomplete';
import { Box, Button, Chip, Paper, TextField, Typography, useTheme } from '@mui/material';
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import type { DashboardMultiFilterParams } from '../../types/cartera';

interface DashboardFiltersProps {
  filters: DashboardMultiFilterParams;
  onChange: (filters: DashboardMultiFilterParams) => void;
  onClear: () => void;
  options: {
    pais: string[];
    gestor: string[];
    gerente: string[];
    zona: string[];
    pd: string[];
    campania: string[];
  };
}

const filterCount = (filters: DashboardMultiFilterParams) =>
  Object.values(filters).reduce((sum, list) => sum + list.length, 0);

const DashboardFilters = ({ filters, onChange, onClear, options }: DashboardFiltersProps) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const handleMultiChange = (field: keyof DashboardMultiFilterParams, values: string[]) => {
    onChange({
      ...filters,
      [field]: values
    });
  };

  const fields = [
    { name: 'pais', label: 'País', options: options.pais },
    { name: 'gestor', label: 'Gestor', options: options.gestor },
    { name: 'gerente', label: 'Gerente', options: options.gerente },
    { name: 'zona', label: 'Zona', options: options.zona },
    { name: 'pd', label: 'PD', options: options.pd },
    { name: 'campania', label: 'Campaña', options: options.campania }
  ];

  const activeCount = filterCount(filters);

  return (
    <Paper
      sx={{
        px: 2,
        py: 1.5,
        borderRadius: 2.5,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        boxShadow: isDark ? '0 10px 26px rgba(0, 0, 0, 0.3)' : '0 10px 26px rgba(15, 23, 42, 0.06)'
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
          <FilterAltOutlinedIcon sx={{ fontSize: 18, color: '#E6007E' }} />
          <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: 'text.secondary' }}>
            Filtros
          </Typography>
          {activeCount > 0 && (
            <Chip label={activeCount} size="small" sx={{ height: 18, fontSize: 10, bgcolor: 'rgba(230, 0, 126, 0.14)', color: '#E6007E' }} />
          )}
        </Box>

        <Box
          sx={{
            display: 'grid',
            gap: 1.25,
            flex: 1,
            minWidth: 0,
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, minmax(0, 1fr))',
              md: 'repeat(3, minmax(0, 1fr))',
              lg: 'repeat(6, minmax(0, 1fr))'
            }
          }}
        >
          {fields.map((field) => (
            <Autocomplete
              key={field.name}
              multiple
              size="small"
              limitTags={1}
              options={field.options}
              value={filters[field.name as keyof DashboardMultiFilterParams]}
              onChange={(_, value) => handleMultiChange(field.name as keyof DashboardMultiFilterParams, value)}
              disableCloseOnSelect
              filterSelectedOptions
              noOptionsText="Sin opciones"
              ChipProps={{ size: 'small', sx: { height: 18, fontSize: 10 } }}
              sx={{
                width: '100%',
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                  paddingTop: '2px !important',
                  paddingBottom: '2px !important',
                  minHeight: 34,
                  bgcolor: isDark ? '#111827' : '#F8FAFC',
                  border: '1px solid',
                  borderColor: isDark ? '#334155' : '#E5E7EB',
                  transition: 'border-color 200ms ease',
                  '&:hover fieldset': { borderColor: '#1E3A8A' },
                  '&.Mui-focused fieldset': { borderColor: '#E6007E' }
                },
                '& .MuiInputBase-input': { fontSize: 12 },
                '& .MuiInputLabel-root': { fontSize: 12 }
              }}
              renderInput={(params) => <TextField {...params} label={field.label} size="small" />}
            />
          ))}
        </Box>

        <Button
          size="small"
          variant="outlined"
          color="secondary"
          onClick={onClear}
          startIcon={<RestartAltIcon sx={{ fontSize: 16 }} />}
          sx={{ borderRadius: 2, textTransform: 'none', fontSize: 12, height: 34, flexShrink: 0, px: 1.5 }}
        >
          Limpiar
        </Button>
      </Box>
    </Paper>
  );
};

export default DashboardFilters;
