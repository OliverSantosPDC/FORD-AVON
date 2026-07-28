import { authService } from './authService';

const API_BASE = import.meta.env.VITE_API_URL || '';
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
const STORAGE_BUCKET = (import.meta.env.VITE_SUPABASE_CARTERA_BUCKET as string) || 'cartera';
const STORAGE_OBJECT = (import.meta.env.VITE_SUPABASE_CARTERA_OBJECT as string) || 'CARTERA COBRO.xlsx';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type UploadPhase = 'preparing' | 'uploading' | 'stored' | 'processing' | 'completed' | 'error';

export interface UploadProgress {
  phase: UploadPhase;
  progress: number; // 0-100 global (subida 0-50, procesamiento 50-100)
  message: string;
  processed?: number;
  total?: number;
  indeterminate?: boolean; // true cuando hay actividad pero sin porcentaje real aún
}

export type UploadProgressCallback = (p: UploadProgress) => void;

export interface UploadCarteraResponse {
  success: boolean;
  count?: number;
  message: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fetch con timeout (AbortController) y reintentos ante errores de red o 5xx
 * (p. ej. cold start de Render). No reintenta ante 4xx (error real del cliente).
 */
const fetchWithRetry = async (
  url: string,
  options: RequestInit,
  { retries = 4, timeoutMs = 20000, backoffMs = 1500 } = {}
): Promise<Response> => {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      // 5xx: probable cold start / caída temporal -> reintentar.
      if (response.status >= 500) {
        lastError = new Error(`HTTP ${response.status}`);
      } else {
        return response;
      }
    } catch (error) {
      clearTimeout(timer);
      lastError = error; // "Failed to fetch", timeout/abort, red
    }
    if (attempt < retries) await sleep(backoffMs * (attempt + 1));
  }

  throw lastError instanceof Error ? lastError : new Error('No se pudo conectar con el servidor.');
};

/**
 * Sube el archivo a Supabase Storage por XHR para obtener progreso REAL
 * (bytes enviados / totales). @supabase/supabase-js no expone progreso en
 * upload(), por eso se usa la API REST de Storage directamente con la ANON key.
 */
const uploadToStorageWithProgress = (
  file: File,
  onBytes: (loaded: number, total: number, computable: boolean) => void
): Promise<void> => {
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
    xhr.timeout = 5 * 60 * 1000; // 5 min para archivos grandes

    xhr.upload.onprogress = (event) => onBytes(event.loaded, event.total, event.lengthComputable);

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
    xhr.ontimeout = () => reject(new Error('La subida a Supabase Storage tardó demasiado.'));
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

const formatProcessingMessage = (status: BackendStatus): string => {
  if (status.total > 0) {
    return `Procesando ${status.processed.toLocaleString()} de ${status.total.toLocaleString()} registros...`;
  }
  return status.message || 'Archivo guardado. Procesando cartera...';
};

/**
 * Carga completa con progreso real y tolerante a fallos:
 * 1) Sube el .xlsx a Supabase Storage (progreso real por bytes -> 0-50%).
 * 2) Dispara el procesamiento en Render (asíncrono, devuelve jobId; con reintentos).
 * 3) Polling del estado del job (progreso real por registros -> 50-100%).
 *    Los fallos transitorios de polling NO abortan: el job sigue en Render y el
 *    frontend reintenta el MISMO jobId; solo se rinde tras muchos fallos seguidos.
 */
export const uploadCartera = async (file: File, onProgress?: UploadProgressCallback): Promise<UploadCarteraResponse> => {
  onProgress?.({ phase: 'preparing', progress: 0, message: 'Preparando archivo...' });

  // 1) Subida real a Storage -> 0-50% global.
  await uploadToStorageWithProgress(file, (loaded, total, computable) => {
    if (computable && total > 0) {
      onProgress?.({
        phase: 'uploading',
        progress: Math.round((loaded / total) * 50),
        message: 'Subiendo archivo a Supabase...'
      });
    } else {
      onProgress?.({ phase: 'uploading', progress: 0, message: 'Subiendo archivo a Supabase...', indeterminate: true });
    }
  });
  onProgress?.({ phase: 'stored', progress: 50, message: 'Archivo guardado. Procesando cartera...' });

  // 2) Disparar procesamiento (asíncrono). Reintentos ante cold start de Render.
  // El endpoint exige JWT + permiso `cartera.importar`; se adjunta el token.
  const startToken = await authService.getAccessToken();
  const startResponse = await fetchWithRetry(
    `${API_BASE}/api/cartera/process`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(startToken ? { Authorization: `Bearer ${startToken}` } : {})
      },
      body: JSON.stringify({})
    },
    { retries: 5, timeoutMs: 20000 }
  );
  const startData = await startResponse.json().catch(() => null);
  if (!startResponse.ok || !startData?.jobId) {
    throw new Error(startData?.message ?? 'No se pudo iniciar el procesamiento en el servidor.');
  }
  const jobId: string = startData.jobId;
  onProgress?.({ phase: 'processing', progress: 50, message: 'Archivo guardado. Procesando cartera...', indeterminate: true });

  // 3) Polling tolerante a fallos.
  const MAX_ATTEMPTS = 900; // ~15 min a 1s
  const MAX_CONSECUTIVE_FAILS = 20; // aguanta cortes/cold start sin abortar el job
  let consecutiveFails = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    await sleep(1000);

    let status: BackendStatus | null = null;
    try {
      // El sondeo también exige JWT + permiso `cartera.importar`.
      const pollToken = await authService.getAccessToken();
      const statusResponse = await fetchWithRetry(
        `${API_BASE}/api/cartera/process/${jobId}`,
        { headers: pollToken ? { Authorization: `Bearer ${pollToken}` } : {} },
        { retries: 2, timeoutMs: 15000 }
      );
      status = (await statusResponse.json().catch(() => null)) as BackendStatus | null;
      if (!statusResponse.ok || !status) throw new Error('Respuesta de estado inválida.');
      consecutiveFails = 0;
    } catch {
      // Fallo transitorio de polling: NO abortar, el job sigue en Render.
      consecutiveFails += 1;
      onProgress?.({
        phase: 'processing',
        progress: 50,
        message: 'Reconectando con el servidor...',
        indeterminate: true
      });
      if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
        throw new Error('Se perdió la conexión con el servidor durante el procesamiento.');
      }
      continue;
    }

    if (status.status === 'error') {
      // Error real del backend: mostrar el mensaje real.
      throw new Error(status.message || 'El procesamiento falló en el servidor.');
    }

    if (status.status === 'completed') {
      onProgress?.({ phase: 'completed', progress: 100, message: 'Cartera actualizada correctamente.', processed: status.total, total: status.total });
      return { success: true, count: status.total, message: 'Cartera actualizada correctamente.' };
    }

    // processing: progreso real 50-100 si hay total; indeterminado mientras se parsea.
    const hasTotal = status.total > 0;
    onProgress?.({
      phase: 'processing',
      progress: hasTotal ? 50 + Math.round((status.progress ?? 0) / 2) : 50,
      message: formatProcessingMessage(status),
      processed: status.processed,
      total: status.total,
      indeterminate: !hasTotal
    });
  }

  throw new Error('El procesamiento tardó demasiado. El servidor puede seguir procesando; recarga el dashboard en unos minutos.');
};
