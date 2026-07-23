const API_BASE = import.meta.env.VITE_API_URL || '';

export interface UploadCarteraResponse {
  success: boolean;
  filename?: string;
  size?: number;
  message: string;
}

/**
 * Envía un archivo Excel al backend mediante multipart/form-data.
 * No modifica /api/dashboard ni el flujo actual de datos.
 */
export const uploadCartera = async (file: File): Promise<UploadCarteraResponse> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/api/upload/cartera`, {
    method: 'POST',
    body: formData
  });

  let data: UploadCarteraResponse | null = null;
  try {
    data = (await response.json()) as UploadCarteraResponse;
  } catch {
    data = null;
  }

  if (!response.ok || !data?.success) {
    throw new Error(data?.message ?? 'No se pudo subir el archivo.');
  }

  return data;
};
