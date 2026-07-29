import { getSupabaseClient } from '../config/supabaseClient';

/** Módulo Información: contenido corporativo (clave/valor) + enlaces. */

export class InfoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InfoError';
  }
}

export interface CorporateLink {
  id?: string;
  nombre: string;
  descripcion?: string | null;
  url: string;
  orden?: number;
  activo?: boolean;
}

export const getContenido = async (): Promise<Record<string, string>> => {
  const { data, error } = await getSupabaseClient().from('info_content').select('clave, valor');
  if (error) throw new InfoError(`No se pudo leer el contenido: ${error.message}`);
  const out: Record<string, string> = {};
  ((data ?? []) as Array<{ clave: string; valor: string | null }>).forEach((r) => (out[r.clave] = r.valor ?? ''));
  return out;
};

export const actualizarContenido = async (patch: Record<string, string>, actorId: string | null): Promise<void> => {
  const client = getSupabaseClient();
  const rows = Object.entries(patch).map(([clave, valor]) => ({ clave, valor: valor ?? '', updated_at: new Date().toISOString(), updated_by: actorId }));
  if (rows.length === 0) return;
  const { error } = await client.from('info_content').upsert(rows, { onConflict: 'clave' });
  if (error) throw new InfoError(`No se pudo actualizar el contenido: ${error.message}`);
};

export const listarEnlaces = async (): Promise<CorporateLink[]> => {
  const { data, error } = await getSupabaseClient().from('corporate_links').select('id, nombre, descripcion, url, orden, activo').eq('activo', true).order('orden');
  if (error) throw new InfoError(`No se pudieron leer los enlaces: ${error.message}`);
  return (data ?? []) as CorporateLink[];
};

export const crearEnlace = async (input: CorporateLink): Promise<{ id: string }> => {
  if (!input.nombre?.trim() || !input.url?.trim()) throw new InfoError('Nombre y URL son obligatorios.');
  const { data, error } = await getSupabaseClient().from('corporate_links').insert({
    nombre: input.nombre.trim(),
    descripcion: input.descripcion?.trim() ?? null,
    url: input.url.trim(),
    orden: input.orden ?? 0,
    activo: input.activo ?? true
  }).select('id').single();
  if (error) throw new InfoError(`No se pudo crear el enlace: ${error.message}`);
  return { id: String((data as { id: string }).id) };
};

export const actualizarEnlace = async (id: string, input: CorporateLink): Promise<void> => {
  const patch: Record<string, unknown> = {};
  if (input.nombre !== undefined) patch.nombre = input.nombre.trim();
  if (input.descripcion !== undefined) patch.descripcion = input.descripcion?.trim() ?? null;
  if (input.url !== undefined) patch.url = input.url.trim();
  if (input.orden !== undefined) patch.orden = input.orden;
  if (input.activo !== undefined) patch.activo = input.activo;
  const { error } = await getSupabaseClient().from('corporate_links').update(patch).eq('id', id);
  if (error) throw new InfoError(`No se pudo actualizar el enlace: ${error.message}`);
};

export const eliminarEnlace = async (id: string): Promise<void> => {
  const { error } = await getSupabaseClient().from('corporate_links').update({ activo: false }).eq('id', id);
  if (error) throw new InfoError(`No se pudo eliminar el enlace: ${error.message}`);
};
