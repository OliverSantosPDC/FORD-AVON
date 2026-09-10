import Autocomplete from '@mui/material/Autocomplete';
import { Box, Button, Chip, Collapse, IconButton, MenuItem, Paper, TextField, Typography, useTheme } from '@mui/material';
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useState } from 'react';
import type { DashboardMultiFilterParams } from '../../types/cartera';
import { MONEDA_OPTIONS } from '../../utils/monedaOptions';

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
  /** Código de la moneda seleccionada (ver MONEDA_OPTIONS). Cuando se pasa, el filtro de moneda se muestra siempre junto al resto. */
  moneda?: string;
  onMonedaChange?: (code: string) => void;
}

const tagChipSx = {
  height: 16,
  fontSize: 9,
  maxWidth: '100%',
  minWidth: 0,
  flexShrink: 1,
  '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', px: 0.625, lineHeight: '16px' }
} as const;

// Chip compacto y centrado que muestra únicamente la cantidad seleccionada (2+ elementos).
const countChipSx = {
  height: 18,
  width: 18,
  minWidth: 18,
  fontSize: 10,
  fontWeight: 700,
  flexShrink: 0,
  justifyContent: 'center',
  '& .MuiChip-label': { px: 0, lineHeight: '18px', textAlign: 'center', width: '100%' }
} as const;

const filterCount = (filters: DashboardMultiFilterParams) =>
  Object.values(filters).reduce((sum, list) => sum + list.length, 0);

const DashboardFilters = ({ filters, onChange, onClear, options, moneda, onMonedaChange }: DashboardFiltersProps) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [expanded, setExpanded] = useState(false);

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
  const showMoneda = moneda !== undefined && onMonedaChange;

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
      <Box
        onClick={() => setExpanded((prev) => !prev)}
        sx={{ display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'pointer', userSelect: 'none', width: 'fit-content' }}
      >
        <FilterAltOutlinedIcon sx={{ fontSize: 18, color: '#E6007E' }} />
        <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: 'text.secondary' }}>
          Filtros
        </Typography>
        {activeCount > 0 && (
          <Chip label={activeCount} size="small" sx={{ height: 18, fontSize: 10, bgcolor: 'rgba(230, 0, 126, 0.14)', color: '#E6007E' }} />
        )}
        <IconButton size="small" sx={{ width: 22, height: 22, ml: 0.25 }} aria-label={expanded ? 'Contraer filtros' : 'Expandir filtros'}>
          {expanded ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
        </IconButton>
      </Box>

      <Collapse in={expanded} timeout="auto">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mt: 1.5 }}>
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
                lg: showMoneda ? 'repeat(7, minmax(0, 1fr))' : 'repeat(6, minmax(0, 1fr))'
              }
            }}
          >
            {fields.map((field) => (
              <Autocomplete
                key={field.name}
                multiple
                size="small"
                options={field.options}
                value={filters[field.name as keyof DashboardMultiFilterParams]}
                onChange={(_, value) => handleMultiChange(field.name as keyof DashboardMultiFilterParams, value)}
                disableCloseOnSelect
                filterSelectedOptions
                noOptionsText="Sin opciones"
                renderTags={(tagValue, getTagProps) =>
                  tagValue.length > 1
                    ? [<Chip key="count" size="small" label={tagValue.length} sx={countChipSx} />]
                    : tagValue.map((option, index) => {
                        const { key, ...tagProps } = getTagProps({ index });
                        return <Chip key={key} size="small" label={option} sx={tagChipSx} {...tagProps} />;
                      })
                }
                componentsProps={{
                  popper: field.name === 'gestor' ? { style: { width: 'fit-content' }, placement: 'bottom-start' } : undefined,
                  paper: {
                    sx: {
                      mt: 0.5,
                      minWidth: field.name === 'gestor' ? 260 : undefined,
                      '& .MuiAutocomplete-listbox': {
                        py: 0.5,
                        maxHeight: 340,
                        fontSize: 11.5
                      },
                      '& .MuiAutocomplete-option': {
                        fontSize: 11.5,
                        minHeight: 24,
                        py: 0.4,
                        px: 1.25,
                        lineHeight: 1.25,
                        whiteSpace: field.name === 'gestor' ? 'nowrap' : 'normal',
                        wordBreak: 'break-word'
                      },
                      '& .MuiAutocomplete-noOptions': { fontSize: 11.5, py: 1 }
                    }
                  }
                }}
                sx={{
                  width: '100%',
                  minWidth: 0,
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
                  '& .MuiAutocomplete-inputRoot': {
                    flexWrap: 'nowrap',
                    overflow: 'hidden',
                    gap: 0.5
                  },
                  '& .MuiAutocomplete-tag': {
                    maxWidth: 'calc(100% - 8px)',
                    minWidth: 0
                  },
                  '& .MuiAutocomplete-input': {
                    minWidth: '0 !important',
                    flexShrink: 1,
                    fontSize: 11,
                    lineHeight: 1.3
                  },
                  '& .MuiAutocomplete-endAdornment': { flexShrink: 0 },
                  '& .MuiInputBase-input': { fontSize: 11 },
                  '& .MuiInputLabel-root': { fontSize: 11 }
                }}
                renderInput={(params) => <TextField {...params} label={field.label} size="small" />}
              />
            ))}

            {showMoneda && (
              <TextField
                select
                size="small"
                label="Moneda"
                value={moneda}
                onChange={(event) => onMonedaChange!(event.target.value)}
                SelectProps={{
                  MenuProps: {
                    PaperProps: {
                      sx: {
                        maxHeight: 340,
                        '& .MuiMenuItem-root': { fontSize: 11.5, minHeight: 28, py: 0.4, px: 1.5 }
                      }
                    }
                  }
                }}
                sx={{
                  width: '100%',
                  minWidth: 0,
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                    minHeight: 34,
                    bgcolor: isDark ? '#111827' : '#F8FAFC',
                    border: '1px solid',
                    borderColor: isDark ? '#334155' : '#E5E7EB'
                  },
                  '& .MuiSelect-select': {
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: 11,
                    lineHeight: 1.3,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  },
                  '& .MuiInputBase-input': { fontSize: 11 },
                  '& .MuiInputLabel-root': { fontSize: 11 }
                }}
              >
                {MONEDA_OPTIONS.map((option) => (
                  <MenuItem key={option.code} value={option.code} sx={{ fontSize: 11.5 }}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
            )}
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
      </Collapse>
    </Paper>
  );
};

export default DashboardFilters;
