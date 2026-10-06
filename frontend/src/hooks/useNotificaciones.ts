import { useCallback, useEffect, useState } from 'react';
import {
  getContadorNoLeidas, getNotificaciones, marcarNotificacionLeida, marcarTodasNotificacionesLeidas,
  type Notificacion
} from '../services/notificacionesService';

const POLL_MS = 30000;

/**
 * Estado de la campana de notificaciones: contador de no leídas (consulta
 * ligera, en intervalo moderado — mismo patrón que useTasasConversion.ts)
 * + listado paginado, cargado SOLO cuando se abre el panel (nunca al
 * montar cada pantalla). Actualizaciones optimistas al marcar leída(s):
 * el contador/listado reflejan el cambio de inmediato, y se revierten si
 * la petición al backend falla.
 */
export const useNotificaciones = () => {
  const [noLeidas, setNoLeidas] = useState(0);
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [cargandoLista, setCargandoLista] = useState(false);
  const [panelAbierto, setPanelAbierto] = useState(false);

  const cargarContador = useCallback(() => {
    getContadorNoLeidas().then(setNoLeidas).catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    const tick = () => { if (active) cargarContador(); };
    tick();
    window.addEventListener('focus', tick);
    const interval = window.setInterval(tick, POLL_MS);
    return () => {
      active = false;
      window.removeEventListener('focus', tick);
      window.clearInterval(interval);
    };
  }, [cargarContador]);

  const cargarLista = useCallback(async () => {
    setCargandoLista(true);
    try {
      setNotificaciones(await getNotificaciones({ limit: 20 }));
    } catch {
      // Silencioso: el panel simplemente conserva el último listado cargado.
    } finally {
      setCargandoLista(false);
    }
  }, []);

  const abrirPanel = () => { setPanelAbierto(true); void cargarLista(); };
  const cerrarPanel = () => setPanelAbierto(false);

  const marcarLeida = async (id: string): Promise<void> => {
    const anterior = notificaciones;
    const eraNoLeida = notificaciones.find((n) => n.id === id)?.leida === false;
    setNotificaciones((prev) => prev.map((n) => (n.id === id ? { ...n, leida: true, fechaLectura: new Date().toISOString() } : n)));
    if (eraNoLeida) setNoLeidas((c) => Math.max(0, c - 1));
    try {
      await marcarNotificacionLeida(id);
    } catch {
      setNotificaciones(anterior);
      cargarContador();
    }
  };

  const marcarTodas = async (): Promise<void> => {
    const anterior = notificaciones;
    setNotificaciones((prev) => prev.map((n) => ({ ...n, leida: true })));
    setNoLeidas(0);
    try {
      await marcarTodasNotificacionesLeidas();
    } catch {
      setNotificaciones(anterior);
      cargarContador();
    }
  };

  return { noLeidas, notificaciones, cargandoLista, panelAbierto, abrirPanel, cerrarPanel, marcarLeida, marcarTodas };
};
