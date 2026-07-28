import { getSupabaseClient } from '../config/supabaseClient';

/**
 * Registra una acción en public.auditoria (best-effort; nunca rompe la petición).
 */
export const registrarAuditoria = async (
  actorId: string | null,
  accion: string,
  entidad: string,
  entidadId?: string | null,
  detalle?: unknown
): Promise<void> => {
  try {
    await getSupabaseClient().from('auditoria').insert({
      actor_id: actorId,
      accion,
      entidad,
      entidad_id: entidadId ?? null,
      detalle: detalle ?? null
    });
  } catch (error) {
    console.error('[AUDIT] no se pudo registrar la auditoría:', error);
  }
};
