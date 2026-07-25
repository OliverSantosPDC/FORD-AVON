import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import carteraRoutes from './routes/carteraRoutes';
import dashboardRoutes from './routes/dashboardRoutes';
import uploadRoutes from './routes/uploadRoutes';

const app = express();
const port = process.env.PORT ?? 4000;

const allowedOrigins = [
  'http://localhost:5173',
];

const isAllowedOrigin = (origin: string): boolean => {
  if (allowedOrigins.includes(origin)) return true;
  // Producción, dominio de proyecto y previews del proyecto en Vercel:
  //   https://ford-avon.vercel.app
  //   https://ford-avon-<equipo>.vercel.app
  //   https://ford-avon-git-<rama>-<equipo>.vercel.app
  //   https://ford-avon-<hash>-<equipo>.vercel.app
  return /^https:\/\/ford-avon[a-z0-9-]*\.vercel\.app$/.test(origin);
};

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Permite herramientas sin origin (PowerShell, curl) y los orígenes válidos.
    if (!origin) return callback(null, true);
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());

app.use('/api', carteraRoutes);
app.use('/api', dashboardRoutes);
app.use('/api', uploadRoutes);

app.get('/health', (_req: express.Request, res: express.Response) => {
  res.json({ status: 'ok' });
});

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err);
    res.status(500).json({
      error: err.message ?? 'Error interno del servidor',
    });
  }
);

// === LOGGING TEMPORAL: surface de crashes no controlados (remover tras diagnóstico) ===
process.on('unhandledRejection', (reason) => {
  console.error('[PROCESS] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[PROCESS] uncaughtException:', err);
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});