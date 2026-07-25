import { randomUUID } from 'crypto';

/**
 * Almacén en memoria de trabajos de procesamiento de cartera.
 * Suficiente y estable para una sola instancia de Render (free tier).
 * NOTA: si el servicio escalara a varias instancias, habría que moverlo a un
 * almacén compartido (p. ej. una tabla en Supabase).
 */
export type JobStatus = 'processing' | 'completed' | 'error';

export interface JobState {
  id: string;
  status: JobStatus;
  processed: number;
  total: number;
  message: string;
  updatedAt: number;
}

const jobs = new Map<string, JobState>();
const TTL_MS = 30 * 60 * 1000; // los trabajos viejos se descartan tras 30 min

const cleanup = () => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.updatedAt > TTL_MS) jobs.delete(id);
  }
};

export const createJob = (): JobState => {
  cleanup();
  const job: JobState = {
    id: randomUUID(),
    status: 'processing',
    processed: 0,
    total: 0,
    message: 'En cola...',
    updatedAt: Date.now()
  };
  jobs.set(job.id, job);
  return job;
};

export const updateJob = (id: string, patch: Partial<Omit<JobState, 'id'>>): void => {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch, { updatedAt: Date.now() });
};

export const getJob = (id: string): JobState | undefined => jobs.get(id);
