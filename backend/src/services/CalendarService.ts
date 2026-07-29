import { getSupabaseClient } from '../config/supabaseClient';
import type { ScopeContext } from './ScopeService';

/**
 * Servicio del módulo Calendario. Reutiliza el ScopeContext existente (no modifica
 * ScopeService/ScopeFilter). Fail-closed: un usuario no global sólo ve eventos
 * dentro de su alcance (sus zonas / sus gestores / propios) más los globales.
 */

export interface CalendarEventInput {
  titulo: string;
  descripcion?: string | null;
  tipoEventoId: string;
  fechaInicio: string;
  fechaFin: string;
  horaInicio?: string | null;
  horaFin?: string | null;
  pais?: string | null;
  zonaId?: string | null;
  usuarioId?: string | null;
  todoElDia?: boolean;
}

export class CalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarError';
  }
}

const EVENT_SELECT = 'id, titulo, descripcion, tipo_evento_id, fecha_inicio, fecha_fin, hora_inicio, hora_fin, pais, zona_id, usuario_id, todo_el_dia, activo, creado_por, created_at, updated_at, event_types ( codigo, nombre, color )';

interface Alcance {
  global: boolean;
  userIds: Set<string>;
  zonaIds: Set<string>;
}

const resolverAlcance = async (ctx: ScopeContext): Promise<Alcance> => {
  if (ctx.isGlobal) return { global: true, userIds: new Set(), zonaIds: new Set() };
  const userIds = new Set<string>([ctx.userId]);
  if (ctx.gestorIds.length > 0) {
    const { data } = await getSupabaseClient().from('gestores').select('usuario_id').in('id', ctx.gestorIds);
    ((data ?? []) as Array<{ usuario_id: string | null }>).forEach((g) => {
      if (g.usuario_id) userIds.add(g.usuario_id);
    });
  }
  return { global: false, userIds, zonaIds: new Set(ctx.zonaIds) };
};

const dentroDeAlcance = (ev: Record<string, unknown>, a: Alcance): boolean => {
  if (a.global) return true;
  const usuarioId = ev.usuario_id as string | null;
  const zonaId = ev.zona_id as string | null;
  if (!usuarioId && !zonaId) return true; // evento global/corporativo
  if (usuarioId && a.userIds.has(usuarioId)) return true;
  if (zonaId && a.zonaIds.has(zonaId)) return true;
  return false;
};

export interface CalendarFiltros {
  tipoEventoId?: string;
  pais?: string;
  zonaId?: string;
  usuarioId?: string;
  desde?: string;
  hasta?: string;
}

export const listarTipos = async () => {
  const { data, error } = await getSupabaseClient().from('event_types').select('id, codigo, nombre, color').eq('activo', true).order('nombre');
  if (error) throw new CalendarError(`No se pudieron leer los tipos de evento: ${error.message}`);
  return data ?? [];
};

export const listarEventos = async (ctx: ScopeContext, filtros: CalendarFiltros = {}) => {
  const alcance = await resolverAlcance(ctx);
  let query = getSupabaseClient().from('calendar_events').select(EVENT_SELECT).eq('activo', true);
  if (filtros.desde) query = query.gte('fecha_fin', filtros.desde);
  if (filtros.hasta) query = query.lte('fecha_inicio', filtros.hasta);

  const { data, error } = await query;
  if (error) throw new CalendarError(`No se pudieron leer los eventos: ${error.message}`);

  let rows = (data ?? []) as Array<Record<string, unknown>>;
  rows = rows.filter((ev) => dentroDeAlcance(ev, alcance));

  // Filtros de presentación (dentro del alcance ya aplicado).
  if (filtros.tipoEventoId) rows = rows.filter((e) => e.tipo_evento_id === filtros.tipoEventoId);
  if (filtros.pais) rows = rows.filter((e) => (e.pais as string | null) === filtros.pais);
  if (filtros.zonaId) rows = rows.filter((e) => (e.zona_id as string | null) === filtros.zonaId);
  if (filtros.usuarioId) rows = rows.filter((e) => (e.usuario_id as string | null) === filtros.usuarioId);
  return rows;
};

export const obtenerEvento = async (id: string, ctx: ScopeContext) => {
  const { data, error } = await getSupabaseClient().from('calendar_events').select(EVENT_SELECT).eq('id', id).single();
  if (error || !data) return null;
  const alcance = await resolverAlcance(ctx);
  return dentroDeAlcance(data as Record<string, unknown>, alcance) ? data : null;
};

const toRow = (input: CalendarEventInput, creadoPor?: string | null): Record<string, unknown> => ({
  titulo: input.titulo?.trim(),
  descripcion: input.descripcion?.trim() ?? null,
  tipo_evento_id: input.tipoEventoId,
  fecha_inicio: input.fechaInicio,
  fecha_fin: input.fechaFin || input.fechaInicio,
  hora_inicio: input.horaInicio || null,
  hora_fin: input.horaFin || null,
  pais: input.pais?.trim() || null,
  zona_id: input.zonaId || null,
  usuario_id: input.usuarioId || null,
  todo_el_dia: input.todoElDia ?? true,
  ...(creadoPor !== undefined ? { creado_por: creadoPor } : {})
});

export const crearEvento = async (input: CalendarEventInput, creadoPor: string | null) => {
  if (!input.titulo?.trim()) throw new CalendarError('El título es obligatorio.');
  if (!input.tipoEventoId) throw new CalendarError('El tipo de evento es obligatorio.');
  if (!input.fechaInicio) throw new CalendarError('La fecha de inicio es obligatoria.');
  const { data, error } = await getSupabaseClient().from('calendar_events').insert(toRow(input, creadoPor)).select('id').single();
  if (error) throw new CalendarError(`No se pudo crear el evento: ${error.message}`);
  return { id: String((data as { id: string }).id) };
};

export const actualizarEvento = async (id: string, input: CalendarEventInput) => {
  const patch = toRow(input);
  patch.updated_at = new Date().toISOString();
  const { error } = await getSupabaseClient().from('calendar_events').update(patch).eq('id', id);
  if (error) throw new CalendarError(`No se pudo actualizar el evento: ${error.message}`);
};

export const eliminarEvento = async (id: string) => {
  const { error } = await getSupabaseClient().from('calendar_events').delete().eq('id', id);
  if (error) throw new CalendarError(`No se pudo eliminar el evento: ${error.message}`);
};
