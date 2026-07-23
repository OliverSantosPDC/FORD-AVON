import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import carteraRoutes from './routes/carteraRoutes';
import dashboardRoutes from './routes/dashboardRoutes';

const app = express();
const port = process.env.PORT ?? 4000;

app.use(
  cors({
    origin: [
      'http://localhost:5173',
      'https://ford-avon-sgh1-43t3rlbvt-ford-avon.vercel.app',
    ],
  })
);

app.use(express.json());

app.use('/api', carteraRoutes);
app.use('/api', dashboardRoutes);

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

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});