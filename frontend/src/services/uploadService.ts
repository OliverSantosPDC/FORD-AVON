const API_BASE = import.meta.env.VITE_API_URL || '';
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
const STORAGE_BUCKET = (import.meta.env.VITE_SUPABASE_CARTERA_BUCKET as string) || 'cartera';
const STORAGE_OBJECT = (import.meta.env.VITE_SUPABASE_CARTERA_OBJECT as string) || 'Cartera.xlsx';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type UploadPhase = 'preparing' | 'uploading' | 'stored' | 'processing' | 'completed' | 'error';

export interface UploadProgress {
  phase: UploadPhase;
  progress: number; // 0-100 global (subida 0-50, procesamiento 50-100)
  message: string;
  processed?: number;
  total?: number;
}

export type UploadProgressCallback = (p: UploadProgress) => void;

export interface UploadCarteraResponse {
  success: boolean;
  count?: number;
  message: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sube el archivo a Supabase Storage por XHR para obtener progreso REAL
 * (bytes enviados / totales). @supabase/supabase-js no expone progreso en
 * upload(), por eso se usa la API REST de Storage directamente con la ANON key.
 */
const uploadToStorageWithProgress = (file: File, onBytes: (loaded: number, total: number) => void): Promise<void> => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return Promise.reject(new Error('Faltan VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY.'));
  }

  return new Promise<void>((resolve, reject) => {
    const url = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${encodeURIComponent(STORAGE_OBJECT)}`;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${SUPABASE_ANON_KEY}`);
    xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
    xhr.setRequestHeader('x-upsert', 'true'); // reemplaza el archivo anterior
    xhr.setRequestHeader('Content-Type', file.type || XLSX_MIME);
    xhr.setRequestHeader('cache-control', '3600');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onBytes(event.loaded, event.total);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        let msg = `Error ${xhr.status} al subir a Supabase Storage.`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (body?.message) msg = body.message;
          else if (body?.error) msg = body.error;
        } catch {
          /* respuesta no-JSON */
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('No se pudo conectar con Supabase Storage.'));
    xhr.onabort = () => reject(new Error('Subida cancelada.'));

    xhr.send(file);
  });
};

interface BackendStatus {
  status: 'processing' | 'completed' | 'error';
  progress: number;
  processed: number;
  total: number;
  message: string;
}

/**
 * Carga completa con progreso real:
 * 1) Sube el .xlsx a Supabase Storage (progreso real por bytes -> 0-50%).
 * 2) Dispara el procesamiento en Render (asíncrono, devuelve jobId).
 * 3) Hace polling del estado del job (progreso real por registros -> 50-100%).
 *
 * La firma cambia para aceptar un callback de progreso (opcional).
 */
export const uploadCartera = async (file: File, onProgress?: UploadProgressCallback): Promise<UploadCarteraResponse> => {
  onProgress?.({ phase: 'preparing', progress: 0, message: 'Preparando archivo...' });

  // 1) Subida real a Storage -> 0-50% global.
  await uploadToStorageWithProgress(file, (loaded, total) => {
    const pct = total > 0 ? Math.round((loaded / total) * 50) : 0;
    onProgress?.({ phase: 'uploading', progress: pct, message: 'Subiendo archivo a Supabase...' });
  });
  onProgress?.({ phase: 'stored', progress: 50, message: 'Archivo almacenado correctamente.' });

  // 2) Disparar procesamiento (asíncrono).
  const startResponse = await fetch(`${API_BASE}/api/cartera/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const startData = await startResponse.json().catch(() => null);
  if (!startResponse.ok || !startData?.jobId) {
    throw new Error(startData?.message ?? 'No se pudo iniciar el procesamiento en el servidor.');
  }
  const jobId: string = startData.jobId;
  onProgress?.({ phase: 'processing', progress: 50, message: 'Procesando registros...' });

  // 3) Polling del estado -> 50-100% global.
  const MAX_ATTEMPTS = 600; // ~10 min a 1s
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    await sleep(1000);

    const statusResponse = await fetch(`${API_BASE}/api/cartera/process/${jobId}`);
    const status = (await statusResponse.json().catch(() => null)) as BackendStatus | null;
    if (!statusResponse.ok || !status) {
      throw new Error('No se pudo consultar el estado del procesamiento.');
    }

    if (status.status === 'error') {
      throw new Error(status.message || 'El procesamiento falló en el servidor.');
    }

    const overall = 50 + Math.round((status.progress ?? 0) / 2);
    onProgress?.({
      phase: status.status === 'completed' ? 'completed' : 'processing',
      progress: status.status === 'completed' ? 100 : overall,
      message: status.status === 'completed' ? 'Carga completada correctamente.' : status.message || 'Procesando registros...',
      processed: status.processed,
      total: status.total
    });

    if (status.status === 'completed') {
      return { success: true, count: status.total, message: 'Carga completada correctamente.' };
    }
  }

  throw new Error('El procesamiento tardó demasiado. Intenta nuevamente.');
};
