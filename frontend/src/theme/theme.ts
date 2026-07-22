import { PaletteMode } from '@mui/material';
import { deepmerge } from '@mui/utils';

const commonPalette = {
  primary: {
    main: '#1E3A8A',
    contrastText: '#ffffff'
  },
  secondary: {
    main: '#E6007E',
    contrastText: '#ffffff'
  },
  success: {
    main: '#22C55E'
  },
  error: {
    main: '#EF4444'
  },
  info: {
    main: '#0EA5E9'
  }
};

export const getDesignTokens = (mode: PaletteMode) => {
  const lightPalette = {
    mode: 'light' as const,
    background: {
      default: '#F6F8FB',
      paper: '#FFFFFF'
    },
    text: {
      primary: '#4B5563',
      secondary: '#6B7280'
    },
    divider: '#EEF2F7',
    action: {
      hover: 'rgba(230, 0, 126, 0.1)',
      selected: 'rgba(230, 0, 126, 0.14)'
    }
  };

  const darkPalette = {
    mode: 'dark' as const,
    background: {
      default: '#0F172A',
      paper: '#1E293B'
    },
    text: {
      primary: '#E2E8F0',
      secondary: '#94A3B8'
    },
    divider: '#334155',
    action: {
      hover: 'rgba(255, 255, 255, 0.08)',
      selected: 'rgba(230, 0, 126, 0.16)'
    }
  };

  return deepmerge(
    {
      palette: mode === 'light' ? lightPalette : darkPalette,
      shape: {
        borderRadius: 18
      },
      typography: {
        fontFamily: 'Inter, system-ui, sans-serif',
        button: {
          textTransform: 'none'
        }
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            body: {
              backgroundColor: mode === 'light' ? '#F6F8FB' : '#0F172A',
              color: mode === 'light' ? '#4B5563' : '#E2E8F0'
            }
          }
        },
        MuiAppBar: {
          styleOverrides: {
            root: {
              background: mode === 'light' ? 'rgba(255,255,255,0.96)' : 'rgba(17, 24, 39, 0.95)',
              borderBottom: '1px solid',
              borderColor: mode === 'light' ? '#EEF2F7' : '#243447',
              boxShadow: mode === 'light' ? '0 14px 40px rgba(15, 23, 42, 0.08)' : '0 14px 40px rgba(0, 0, 0, 0.35)',
              backdropFilter: 'blur(18px)',
              transition: 'all 220ms ease-in-out'
            }
          }
        },
        MuiPaper: {
          styleOverrides: {
            root: {
              backgroundImage: 'none',
              border: '1px solid',
              borderColor: mode === 'light' ? '#EEF2F7' : '#243447',
              boxShadow: mode === 'light' ? '0 20px 55px rgba(15, 23, 42, 0.08)' : '0 20px 55px rgba(0, 0, 0, 0.45)',
              borderRadius: 20,
              transition: 'all 220ms ease-in-out'
            }
          }
        },
        MuiCard: {
          styleOverrides: {
            root: {
              borderRadius: 20,
              boxShadow: mode === 'light' ? '0 20px 60px rgba(15, 23, 42, 0.08)' : '0 20px 60px rgba(0, 0, 0, 0.50)',
              transition: 'all 220ms ease-in-out'
            }
          }
        },
        MuiButton: {
          styleOverrides: {
            root: {
              borderRadius: 14,
              boxShadow: 'none',
              transition: 'all 220ms ease-in-out'
            },
            containedPrimary: {
              backgroundColor: '#1E3A8A',
              color: '#FFFFFF',
              '&:hover': {
                backgroundColor: '#17326C'
              }
            },
            containedSecondary: {
              backgroundColor: '#E6007E',
              color: '#FFFFFF',
              '&:hover': {
                backgroundColor: '#C30075'
              }
            }
          }
        },
        MuiOutlinedInput: {
          styleOverrides: {
            root: {
              borderRadius: 18,
              backgroundColor: mode === 'light' ? '#FFFFFF' : '#111827',
              border: '1px solid',
              borderColor: mode === 'light' ? '#D1D5DB' : '#243447',
              transition: 'all 220ms ease-in-out',
              '&:hover': {
                borderColor: mode === 'light' ? '#1E3A8A' : '#E6007E'
              },
              '&.Mui-focused fieldset': {
                borderColor: '#E6007E'
              }
            }
          }
        },
        MuiInputBase: {
          styleOverrides: {
            root: {
              borderRadius: 18
            }
          }
        },
        MuiAutocomplete: {
          styleOverrides: {
            paper: {
              borderRadius: 22,
              boxShadow: mode === 'light' ? '0 24px 70px rgba(15, 23, 42, 0.10)' : '0 24px 70px rgba(0, 0, 0, 0.55)'
            }
          }
        },
        MuiListItemButton: {
          styleOverrides: {
            root: {
              borderRadius: 20,
              margin: '6px 8px',
              '&.Mui-selected': {
                background: 'rgba(230, 0, 126, 0.14)',
                color: mode === 'light' ? '#0F172A' : '#FFFFFF',
                '& .MuiListItemIcon-root': {
                  color: '#1E3A8A'
                }
              },
              '&:hover': {
                background: mode === 'light' ? 'rgba(30, 58, 138, 0.08)' : 'rgba(255, 255, 255, 0.08)'
              },
              transition: 'all 220ms ease-in-out'
            }
          }
        },
        MuiTableCell: {
          styleOverrides: {
            head: {
              backgroundColor: mode === 'light' ? '#F6F8FB' : '#111827',
              color: mode === 'light' ? '#4B5563' : '#E2E8F0',
              fontWeight: 700,
              borderBottom: '1px solid',
              borderColor: mode === 'light' ? '#EEF2F7' : '#243447',
              fontSize: '0.75rem'
            },
            root: {
              borderBottom: '1px solid',
              borderColor: mode === 'light' ? '#EEF2F7' : '#243447',
              fontSize: '0.85rem'
            }
          }
        },
        MuiTableRow: {
          styleOverrides: {
            root: {
              transition: 'background-color 200ms ease-in-out',
              '&:hover': {
                backgroundColor: mode === 'light' ? '#EEF2F7' : '#243447'
              }
            }
          }
        },
        MuiChip: {
          styleOverrides: {
            root: {
              borderRadius: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              transition: 'all 220ms ease-in-out'
            }
          }
        },
        MuiTablePagination: {
          styleOverrides: {
            root: {
              borderTop: '1px solid',
              borderColor: mode === 'light' ? '#EEF2F7' : '#243447'
            }
          }
        }
      }
    },
    {
      palette: commonPalette
    }
  );
};
