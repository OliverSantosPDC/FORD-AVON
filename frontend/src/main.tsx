import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import AppRoutes from './routes/AppRoutes';
import ThemeProviderWrapper from './theme/ThemeProviderWrapper';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProviderWrapper>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ThemeProviderWrapper>
  </React.StrictMode>
);
