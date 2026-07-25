import { getSupabaseBrowserClient } from './supabaseClient';

const API_BASE = import.meta.env.VITE_API_URL || '';
const STORAGE_BUCKET = (import.meta.env.VITE_SUPABASE_CARTERA_BUCKET as string) || 'cartera';
const STORAGE_OBJECT = (import.meta.env.VITE_SUPABASE_CARTERA_OBJECT as string) || 'Cartera.xlsx';

export interface UploadCarteraResponse {
  success: boolean;
  filename?: string;
  size?: number;
  count?: number;
  message: string;
}

/**
 * Nueva arquitectura:
 * 1) El frontend sube el .xlsx DIRECTO a Supabase Storage (bucket "cartera")
 *    usando la ANON key (Render ya no recibe el archivo).
 * 2) Se pide al backend que descargue ese archivo de Storage y actualice la
 *    tabla `cartera`. La cartera anterior se conserva hasta que el nuevo archivo
 *    se procese correctamente.
 */
export const uploadCartera = async (file: File): Promise<UploadCarteraResponse> => {
  // 1) Subir/reemplazar el archivo en Supabase Storage.
  const supabase = getSupabaseBrowserClient();
  const { error: storageError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(STORAGE_OBJECT, file, {
      upsert: true,
      contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

  if (storageError) {
    throw new Error(`No se pudo subir el archivo a Supabase Storage: ${storageError.message}`);
  }

  // 2) Pedir al backend que procese el archivo ya almacenado.
  const response = await fetch(`${API_BASE}/api/cartera/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  let data: UploadCarteraResponse | null = null;
  try {
    data = (await response.json()) as UploadCarteraResponse;
  } catch {
    data = null;
  }

  if (!response.ok || !data?.success) {
    throw new Error(data?.message ?? 'El archivo se subió, pero el procesamiento falló.');
  }

  return { ...data, filename: file.name, size: file.size };
};
