import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { CssBaseline, PaletteMode, ThemeProvider } from '@mui/material';
import { createTheme } from '@mui/material/styles';
import { getDesignTokens } from './theme';

const ThemeModeContext = createContext({
  mode: 'light' as PaletteMode,
  toggleMode: () => {}
});

export const useThemeMode = () => useContext(ThemeModeContext);

const LOCAL_STORAGE_KEY = 'ford-avon-theme-mode';

const ThemeProviderWrapper = ({ children }: { children: React.ReactNode }) => {
  const [mode, setMode] = useState<PaletteMode>('light');

  useEffect(() => {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY) as PaletteMode | null;
    if (stored === 'dark' || stored === 'light') {
      setMode(stored);
      return;
    }
    // Sin preferencia guardada: usar la configuración del sistema (prefers-color-scheme).
    const prefersDark = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false;
    setMode(prefersDark ? 'dark' : 'light');
  }, []);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY, mode);
  }, [mode]);

  const colorMode = useMemo(
    () => ({
      mode,
      toggleMode: () => {
        setMode((prevMode) => (prevMode === 'light' ? 'dark' : 'light'));
      }
    }),
    [mode]
  );

  const theme = useMemo(() => createTheme(getDesignTokens(mode)), [mode]);

  return (
    <ThemeModeContext.Provider value={colorMode}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
};

export default ThemeProviderWrapper;
