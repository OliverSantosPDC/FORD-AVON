import { Request, Response } from 'express';
import { downloadAndReplaceCartera } from '../services/CarteraImportService';
import { createJob, getJob, updateJob } from '../services/CarteraJobStore';

/**
 * Controlador de procesamiento de cartera (asíncrono con jobId + polling).
 * El frontend ya subió el .xlsx DIRECTO a Supabase Storage. Este endpoint sólo
 * dispara el procesamiento en segundo plano (no mantiene la petición HTTP
 * abierta) y expone el estado para consultar el progreso. NO modifica /api/dashboard.
 */
export class UploadController {
  /** POST /api/cartera/process -> crea el job y arranca el procesamiento async. */
  async startProcessCartera(_req: Request, res: Response): Promise<Response> {
    const job = createJob();
    console.log(`[UPLOAD] job ${job.id} creado: descargar de Storage y reemplazar tabla`);

    // Fire-and-forget: no se espera aquí para no bloquear la respuesta HTTP.
    void this.runJob(job.id);

    return res.json({
      success: true,
      jobId: job.id,
      status: 'processing',
      message: 'Procesamiento iniciado.'
    });
  }

  /** GET /api/cartera/process/:jobId -> estado y progreso del job. */
  async getProcessStatus(req: Request, res: Response): Promise<Response> {
    const job = getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ status: 'error', progress: 0, message: 'Trabajo no encontrado o expirado.' });
    }

    const progress =
      job.total > 0 ? Math.min(100, Math.round((job.processed / job.total) * 100)) : job.status === 'completed' ? 100 : 0;

    return res.json({
      status: job.status,
      progress,
      processed: job.processed,
      total: job.total,
      message: job.message
    });
  }

  /** Ejecuta el procesamiento y va actualizando el job. */
  private async runJob(jobId: string): Promise<void> {
    try {
      const { count } = await downloadAndReplaceCartera((update) => updateJob(jobId, update));
      updateJob(jobId, {
        status: 'completed',
        processed: count,
        total: count,
        message: `Carga completada correctamente con ${count} registros.`
      });
      console.log(`[UPLOAD] job ${jobId} completado (${count} registros)`);
    } catch (error) {
      // La cartera anterior queda intacta si la validación falla antes del truncate.
      const message = error instanceof Error ? error.message : 'Error desconocido al procesar el archivo.';
      updateJob(jobId, { status: 'error', message });
      console.error(`[UPLOAD] job ${jobId} error:`, error);
    }
  }
}
