import { getSupabaseClient } from '../config/supabaseClient';
import type { ScopeContext } from './ScopeService';
import type { FilaCalendario } from '../utils/calendarExcel';

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

export const setActivoEvento = async (id: string, activo: boolean) => {
  const { error } = await getSupabaseClient()
    .from('calendar_events')
    .update({ activo, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new CalendarError(`No se pudo cambiar el estado del evento: ${error.message}`);
};

/* ===== Carga masiva de calendario ===== */

export interface CalendarPreviewItem {
  fila: number;
  accion: string;
  titulo: string;
  estado: 'VALIDO' | 'ERROR';
  mensaje: string;
}
export interface CalendarResumen {
  total: number;
  validas: number;
  errores: number;
  creaciones: number;
  actualizaciones: number;
  eliminaciones: number;
  activaciones: number;
  desactivaciones: number;
}
export interface CalendarResultadoItem extends CalendarPreviewItem {
  resultado: 'OK' | 'ERROR';
}

const ACCIONES_CAL = ['CREAR', 'ACTUALIZAR', 'ELIMINAR', 'ACTIVAR', 'DESACTIVAR'];
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

interface CtxCal {
  tipos: Set<string>;
  zonasPorNombre: Map<string, string>;
  emails: Map<string, string>;
  eventosIds: Set<string>;
}

const cargarCtxCal = async (): Promise<CtxCal> => {
  const client = getSupabaseClient();
  const [tiposR, zonasR, perfR, evR] = await Promise.all([
    client.from('event_types').select('codigo').eq('activo', true),
    client.from('zonas').select('id, nombre, codigo').eq('activo', true),
    client.from('profiles').select('id, email'),
    client.from('calendar_events').select('id')
  ]);
  const zonasPorNombre = new Map<string, string>();
  ((zonasR.data ?? []) as Array<{ id: string; nombre: string; codigo: string | null }>).forEach((z) => {
    zonasPorNombre.set(z.nombre.trim().toLowerCase(), z.id);
    if (z.codigo) zonasPorNombre.set(z.codigo.trim().toLowerCase(), z.id);
  });
  const emails = new Map<string, string>();
  ((perfR.data ?? []) as Array<{ id: string; email: string | null }>).forEach((p) => {
    if (p.email) emails.set(p.email.trim().toLowerCase(), p.id);
  });
  return {
    tipos: new Set(((tiposR.data ?? []) as Array<{ codigo: string }>).map((t) => t.codigo.toUpperCase())),
    zonasPorNombre,
    emails,
    eventosIds: new Set(((evR.data ?? []) as Array<{ id: string }>).map((e) => e.id))
  };
};

const validarFilaCal = (f: FilaCalendario, ctx: CtxCal): string => {
  if (!ACCIONES_CAL.includes(f.accion)) return `Acción no válida: "${f.accion}".`;
  if (['ACTUALIZAR', 'ELIMINAR', 'ACTIVAR', 'DESACTIVAR'].includes(f.accion)) {
    if (!f.idEvento) return 'ID_EVENTO es obligatorio para esta acción.';
    if (!ctx.eventosIds.has(f.idEvento)) return 'Evento no encontrado (ID_EVENTO).';
  }
  if (f.accion === 'CREAR' || f.accion === 'ACTUALIZAR') {
    if (f.accion === 'CREAR' && !f.titulo.trim()) return 'TITULO es obligatorio.';
    if (f.accion === 'CREAR' && !f.fechaInicio) return 'FECHA_INICIO es obligatoria.';
    if (f.fechaInicio && !isDate(f.fechaInicio)) return 'FECHA_INICIO inválida (YYYY-MM-DD).';
    if (f.fechaFin && !isDate(f.fechaFin)) return 'FECHA_FIN inválida (YYYY-MM-DD).';
    const fin = f.fechaFin || f.fechaInicio;
    if (f.fechaInicio && fin && fin < f.fechaInicio) return 'FECHA_FIN no puede ser menor que FECHA_INICIO.';
    if (f.tipoEvento && !ctx.tipos.has(f.tipoEvento)) return `TIPO_EVENTO no existe: "${f.tipoEvento}".`;
    if (f.accion === 'CREAR' && !f.tipoEvento) return 'TIPO_EVENTO es obligatorio.';
    if (f.zona && !ctx.zonasPorNombre.has(f.zona.trim().toLowerCase())) return `Zona no encontrada: "${f.zona}".`;
    if (f.usuarioEmail && !ctx.emails.has(f.usuarioEmail.trim().toLowerCase())) return `Usuario no encontrado: "${f.usuarioEmail}".`;
  }
  return '';
};

const resumenVacio = (total: number): CalendarResumen => ({ total, validas: 0, errores: 0, creaciones: 0, actualizaciones: 0, eliminaciones: 0, activaciones: 0, desactivaciones: 0 });
const contar = (r: CalendarResumen, accion: string) => {
  if (accion === 'CREAR') r.creaciones += 1;
  else if (accion === 'ACTUALIZAR') r.actualizaciones += 1;
  else if (accion === 'ELIMINAR') r.eliminaciones += 1;
  else if (accion === 'ACTIVAR') r.activaciones += 1;
  else if (accion === 'DESACTIVAR') r.desactivaciones += 1;
};

export const validarImportacionCalendario = async (filas: FilaCalendario[]): Promise<{ items: CalendarPreviewItem[]; resumen: CalendarResumen }> => {
  const ctx = await cargarCtxCal();
  const resumen = resumenVacio(filas.length);
  const items = filas.map((f) => {
    const mensaje = validarFilaCal(f, ctx);
    if (mensaje) resumen.errores += 1;
    else { resumen.validas += 1; contar(resumen, f.accion); }
    return { fila: f.fila, accion: f.accion, titulo: f.titulo, estado: (mensaje ? 'ERROR' : 'VALIDO') as 'VALIDO' | 'ERROR', mensaje: mensaje || 'OK' };
  });
  return { items, resumen };
};

const aplicarFilaCal = async (f: FilaCalendario, ctx: CtxCal, creadoPor: string | null): Promise<void> => {
  if (f.accion === 'ELIMINAR' || f.accion === 'DESACTIVAR') return setActivoEvento(f.idEvento, false);
  if (f.accion === 'ACTIVAR') return setActivoEvento(f.idEvento, true);

  const input: CalendarEventInput = {
    titulo: f.titulo,
    descripcion: f.descripcion || null,
    tipoEventoId: '', // se resuelve abajo por código
    fechaInicio: f.fechaInicio,
    fechaFin: f.fechaFin || f.fechaInicio,
    pais: f.pais || null,
    zonaId: f.zona ? ctx.zonasPorNombre.get(f.zona.trim().toLowerCase()) ?? null : null,
    usuarioId: f.usuarioEmail ? ctx.emails.get(f.usuarioEmail.trim().toLowerCase()) ?? null : null,
    todoElDia: true
  };
  // Resolver tipo por código.
  const { data: tipo } = await getSupabaseClient().from('event_types').select('id').eq('codigo', f.tipoEvento).limit(1);
  input.tipoEventoId = String(((tipo ?? [])[0] as { id?: string } | undefined)?.id ?? '');
  if (f.accion === 'CREAR') { await crearEvento(input, creadoPor); return; }
  await actualizarEvento(f.idEvento, input);
};

export const aplicarImportacionCalendario = async (filas: FilaCalendario[], soloValidas: boolean, creadoPor: string | null): Promise<{ resultados: CalendarResultadoItem[]; resumen: CalendarResumen }> => {
  const ctx = await cargarCtxCal();
  const validaciones = filas.map((f) => ({ f, mensaje: validarFilaCal(f, ctx) }));
  if (validaciones.some((v) => v.mensaje) && !soloValidas) {
    throw new CalendarError('El archivo tiene filas con error. Corrígelas o usa "Procesar solo válidas".');
  }
  const resumen = resumenVacio(filas.length);
  const resultados: CalendarResultadoItem[] = [];
  for (const v of validaciones) {
    const base = { fila: v.f.fila, accion: v.f.accion, titulo: v.f.titulo };
    if (v.mensaje) { resultados.push({ ...base, estado: 'ERROR', resultado: 'ERROR', mensaje: v.mensaje }); resumen.errores += 1; continue; }
    try {
      await aplicarFilaCal(v.f, ctx, creadoPor);
      resultados.push({ ...base, estado: 'VALIDO', resultado: 'OK', mensaje: 'Procesado correctamente.' });
      resumen.validas += 1; contar(resumen, v.f.accion);
    } catch (error) {
      resultados.push({ ...base, estado: 'ERROR', resultado: 'ERROR', mensaje: error instanceof Error ? error.message : 'Error al procesar la fila.' });
      resumen.errores += 1;
    }
  }
  return { resultados, resumen };
};
