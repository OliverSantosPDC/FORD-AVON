import type { ArbolUsuarioInfo, ArbolUsuarios } from '../../services/usuariosService';

/**
 * Construcción PURA (sin React/MUI) del árbol jerárquico de Usuarios a
 * partir de las relaciones oficiales normalizadas que devuelve el backend
 * (`GET /api/usuarios/arbol`). Esta es la ÚNICA lógica que decide qué rama
 * pertenece a quién — nunca se infiere una relación por coincidencia de
 * nombre ni se inventa una jerarquía: cada arista del árbol viene 1:1 de
 * `liderazgo_supervisor` / `supervisor_gestor` / `supervisor_gerente_zona` /
 * `gestor_pais_zona` / `gerente_zona_zona`, indexadas por `profiles.id`.
 *
 * GV/ST: para el momento en que una fila llega a `gerenteZonaZona`, el
 * marcador "GV" de la plantilla Comercial YA fue expandido a las zonas
 * reales de esa división al importar/guardar (ver
 * `construirMapaZonasPorDivision` en UsuariosService) — nunca existe un
 * literal "GV" en estos datos. El árbol solo agrupa lo que ya existe, nunca
 * vuelve a expandir ni interpreta "ST" como una zona (ese código se rechaza
 * en el import; si aparece sería un código de zona real más).
 *
 * Mantenible y testeable sin DOM: ver test/arbolUsuarios.test.ts.
 */

/** Orden jerárquico de los grupos raíz (Nivel 1 -> Nivel 5). */
export const ROLE_ORDER = ['administrador', 'liderazgo', 'supervisor', 'gestor', 'gerente_zona'] as const;
export const ROLE_GROUP_LABEL: Record<string, string> = {
  administrador: 'Administrador', liderazgo: 'Liderazgo', supervisor: 'Supervisor',
  gestor: 'Gestor', gerente_zona: 'Gerente de zona', otros: 'Otros'
};

export type ArbolNodoTipo = 'raiz' | 'usuario' | 'pais' | 'division' | 'zona' | 'subgrupo' | 'mensaje';

export interface ArbolNodo {
  id: string;
  tipo: ArbolNodoTipo;
  label: string;
  subtitle?: string;
  usuario?: ArbolUsuarioInfo;
  children: ArbolNodo[];
}

export interface ArbolFiltros {
  search: string;
  /** role.clave o '' (sin filtro). */
  rol: string;
  /** País exacto (de territorio) o '' (sin filtro). */
  pais: string;
}

export interface ArbolConstruido {
  raices: ArbolNodo[];
  /** Usuarios DISTINTOS visibles tras filtrar (un mismo usuario puede aparecer
   *  en más de una rama — p. ej. un Gestor visible bajo su Supervisor y en el
   *  grupo raíz "Gestor" — y aquí se cuenta una sola vez). */
  totalVisible: number;
  /** true si hay un filtro de RECORTE activo (búsqueda o país): narrowea las
   *  ramas en vez de solo seleccionar grupos raíz completos (eso lo hace el
   *  filtro de rol). */
  filtrando: boolean;
}

/** Recolecta, en orden, los ids de usuario (nodos tipo 'usuario') de un nodo
 *  y su descendencia. Un mismo id puede repetirse si el usuario aparece en
 *  más de una rama (p. ej. anidado bajo su Supervisor y también listado en
 *  su grupo raíz) — quien consuma esto y necesite unicidad usa un Set. */
export const recolectarIdsUsuario = (nodo: ArbolNodo): string[] => {
  const propio = nodo.tipo === 'usuario' && nodo.usuario ? [nodo.usuario.id] : [];
  return [...propio, ...nodo.children.flatMap(recolectarIdsUsuario)];
};

/** Recolecta TODOS los ids de nodo (cualquier tipo) de un árbol — usado por
 *  "Expandir todo"/"Contraer todo". */
export const recolectarTodosLosIds = (nodos: ArbolNodo[]): string[] =>
  nodos.flatMap((n) => [n.id, ...recolectarTodosLosIds(n.children)]);

const nombreUsuario = (u: ArbolUsuarioInfo): string => [u.nombre, u.apellido].filter(Boolean).join(' ') || u.email;

const agregar = <K>(mapa: Map<K, string[]>, key: K, valor: string): void => {
  const lista = mapa.get(key) ?? [];
  lista.push(valor);
  mapa.set(key, lista);
};

export const construirArbolUsuarios = (data: ArbolUsuarios, filtros: ArbolFiltros): ArbolConstruido => {
  const searchTerm = filtros.search.trim().toLowerCase();
  const paisFiltro = filtros.pais.trim();
  const rolFiltro = filtros.rol.trim();
  const filtrando = searchTerm !== '' || paisFiltro !== '';

  /** Bucket real de un usuario (grupo raíz al que pertenece): cualquier rol
   *  fuera del catálogo conocido (ROLE_ORDER) cae en "otros" — nunca se
   *  descarta ni se le inventa un rol. */
  const claveDeUsuario = (u: ArbolUsuarioInfo): string => u.roleClave && (ROLE_ORDER as readonly string[]).includes(u.roleClave) ? u.roleClave : 'otros';

  const usuariosPorId = new Map(data.usuarios.map((u) => [u.id, u]));
  const usuariosPorClave = new Map<string, ArbolUsuarioInfo[]>();
  data.usuarios.forEach((u) => {
    const lista = usuariosPorClave.get(claveDeUsuario(u)) ?? [];
    lista.push(u);
    usuariosPorClave.set(claveDeUsuario(u), lista);
  });

  const supervisoresPorLiderazgo = new Map<string, string[]>();
  const liderazgoPorSupervisor = new Map<string, string[]>();
  data.liderazgoSupervisor.forEach((r) => { agregar(supervisoresPorLiderazgo, r.liderazgoId, r.supervisorId); agregar(liderazgoPorSupervisor, r.supervisorId, r.liderazgoId); });

  const gestoresPorSupervisor = new Map<string, string[]>();
  const supervisorPorGestor = new Map<string, string[]>();
  data.supervisorGestor.forEach((r) => { agregar(gestoresPorSupervisor, r.supervisorId, r.gestorUsuarioId); agregar(supervisorPorGestor, r.gestorUsuarioId, r.supervisorId); });

  const gerentesPorSupervisor = new Map<string, string[]>();
  const supervisorPorGerente = new Map<string, string[]>();
  data.supervisorGerenteZona.forEach((r) => { agregar(gerentesPorSupervisor, r.supervisorId, r.gerenteZonaId); agregar(supervisorPorGerente, r.gerenteZonaId, r.supervisorId); });

  const gestorPaisZonaPorUsuario = new Map<string, Array<{ zonaId: string; zona: string; pais: string }>>();
  data.gestorPaisZona.forEach((r) => {
    const lista = gestorPaisZonaPorUsuario.get(r.gestorUsuarioId) ?? [];
    lista.push({ zonaId: r.zonaId, zona: r.zona, pais: r.pais });
    gestorPaisZonaPorUsuario.set(r.gestorUsuarioId, lista);
  });

  const gerenteZonaZonaPorUsuario = new Map<string, Array<{ zonaId: string; zona: string; pais: string; division: string | null }>>();
  data.gerenteZonaZona.forEach((r) => {
    const lista = gerenteZonaZonaPorUsuario.get(r.usuarioId) ?? [];
    lista.push({ zonaId: r.zonaId, zona: r.zona, pais: r.pais, division: r.division });
    gerenteZonaZonaPorUsuario.set(r.usuarioId, lista);
  });

  const coincideTexto = (u: ArbolUsuarioInfo, term: string): boolean => {
    if (!term) return true;
    const nombre = nombreUsuario(u).toLowerCase();
    const nombreCompleto = (u.nombreCompleto ?? '').toLowerCase();
    if (nombre.includes(term) || nombreCompleto.includes(term) || u.email.toLowerCase().includes(term)) return true;
    const zonasGestor = gestorPaisZonaPorUsuario.get(u.id) ?? [];
    const zonasGerente = gerenteZonaZonaPorUsuario.get(u.id) ?? [];
    return [...zonasGestor, ...zonasGerente].some((z) => z.zona.toLowerCase().includes(term));
  };

  /** Solo tiene sentido para Gestor/Gerente de zona: ¿alguna de sus filas
   *  reales de territorio es exactamente ese país? Administrador/Liderazgo/
   *  Supervisor/Otros no tienen país propio — se evalúan por sus
   *  descendientes (ver `usuarioCoincideFiltro`), nunca directamente aquí. */
  const coincidePaisLeaf = (u: ArbolUsuarioInfo, pais: string): boolean => {
    if (!pais) return true;
    if (u.roleClave === 'gestor') return (gestorPaisZonaPorUsuario.get(u.id) ?? []).some((z) => z.pais === pais);
    if (u.roleClave === 'gerente_zona') return (gerenteZonaZonaPorUsuario.get(u.id) ?? []).some((z) => z.pais === pais);
    return true;
  };

  /** Coincidencia DIRECTA por nombre/correo/zona, sin mirar descendientes.
   *  El filtro de país solo aplica directamente a hojas con territorio propio
   *  (Gestor/Gerente de zona); para los demás roles, un país activo desactiva
   *  la coincidencia "propia" (deben calificar por sus descendientes). */
  const coincideDirecto = (u: ArbolUsuarioInfo): boolean => {
    if (u.roleClave === 'gestor' || u.roleClave === 'gerente_zona') return coincideTexto(u, searchTerm) && coincidePaisLeaf(u, paisFiltro);
    return paisFiltro === '' && coincideTexto(u, searchTerm);
  };

  /** ¿Este usuario (o, para Liderazgo/Supervisor, alguno de sus
   *  descendientes reales) satisface los filtros activos? Administrador y
   *  "Otros" no tienen territorio: el filtro de país nunca los excluye (son
   *  roles sin concepto de país, no "países vacíos que fallan el filtro"). */
  const usuarioCoincideFiltro = (u: ArbolUsuarioInfo): boolean => {
    const clave = claveDeUsuario(u);
    if (clave === 'administrador' || clave === 'otros') {
      // Sin territorio: el filtro de país nunca los excluye (no es "un país
      // vacío que falla el filtro", es un rol sin concepto de país).
      return coincideTexto(u, searchTerm);
    }
    if (coincideDirecto(u)) return true;
    if (u.roleClave === 'supervisor') {
      const gestorIds = gestoresPorSupervisor.get(u.id) ?? [];
      const gerenteIds = gerentesPorSupervisor.get(u.id) ?? [];
      return gestorIds.some((gid) => { const g = usuariosPorId.get(gid); return Boolean(g) && usuarioCoincideFiltro(g!); })
        || gerenteIds.some((gid) => { const g = usuariosPorId.get(gid); return Boolean(g) && usuarioCoincideFiltro(g!); });
    }
    if (u.roleClave === 'liderazgo') {
      const supervisorIds = supervisoresPorLiderazgo.get(u.id) ?? [];
      return supervisorIds.some((sid) => { const s = usuariosPorId.get(sid); return Boolean(s) && usuarioCoincideFiltro(s!); });
    }
    return false;
  };

  const idsUsuariosVisibles = new Set<string>();
  const msgNode = (parentId: string, texto: string): ArbolNodo => ({ id: `${parentId}>msg:${texto}`, tipo: 'mensaje', label: texto, children: [] });

  const buildZonasPorPais = (parentId: string, rows: Array<{ zonaId: string; zona: string; pais: string }>): ArbolNodo[] => {
    const filas = paisFiltro ? rows.filter((r) => r.pais === paisFiltro) : rows;
    if (filas.length === 0) return [msgNode(parentId, 'Sin asignación')];
    const porPais = new Map<string, typeof filas>();
    filas.forEach((r) => { const l = porPais.get(r.pais) ?? []; l.push(r); porPais.set(r.pais, l); });
    return Array.from(porPais.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'es'))
      .map(([pais, zonas]) => {
        const paisId = `${parentId}>pais:${pais}`;
        const zonaNodes = zonas.slice()
          .sort((a, b) => a.zona.localeCompare(b.zona, 'es', { numeric: true }))
          .map((z) => ({ id: `${paisId}>zona:${z.zonaId}`, tipo: 'zona' as const, label: `Zona ${z.zona}`, children: [] }));
        return { id: paisId, tipo: 'pais' as const, label: pais, children: zonaNodes };
      });
  };

  const buildZonasPorPaisDivision = (parentId: string, rows: Array<{ zonaId: string; zona: string; pais: string; division: string | null }>): ArbolNodo[] => {
    const filas = paisFiltro ? rows.filter((r) => r.pais === paisFiltro) : rows;
    if (filas.length === 0) return [msgNode(parentId, 'Sin asignación')];
    const porPais = new Map<string, typeof filas>();
    filas.forEach((r) => { const l = porPais.get(r.pais) ?? []; l.push(r); porPais.set(r.pais, l); });
    return Array.from(porPais.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'es'))
      .map(([pais, filasPais]) => {
        const paisId = `${parentId}>pais:${pais}`;
        const porDivision = new Map<string, typeof filasPais>();
        filasPais.forEach((f) => { const key = f.division ?? ''; const l = porDivision.get(key) ?? []; l.push(f); porDivision.set(key, l); });
        const divisionNodes = Array.from(porDivision.entries())
          .sort(([a], [b]) => a.localeCompare(b, 'es'))
          .map(([division, zonas]) => {
            const divId = `${paisId}>division:${division || '—'}`;
            const zonaNodes = zonas.slice()
              .sort((a, b) => a.zona.localeCompare(b.zona, 'es', { numeric: true }))
              .map((z) => ({ id: `${divId}>zona:${z.zonaId}`, tipo: 'zona' as const, label: `Zona ${z.zona}`, children: [] }));
            return { id: divId, tipo: 'division' as const, label: division || 'Sin división', children: zonaNodes };
          });
        return { id: paisId, tipo: 'pais' as const, label: pais, children: divisionNodes };
      });
  };

  const buildGestorChildren = (parentId: string, u: ArbolUsuarioInfo): ArbolNodo[] => buildZonasPorPais(parentId, gestorPaisZonaPorUsuario.get(u.id) ?? []);
  const buildGerenteChildren = (parentId: string, u: ArbolUsuarioInfo): ArbolNodo[] => buildZonasPorPaisDivision(parentId, gerenteZonaZonaPorUsuario.get(u.id) ?? []);

  const buildUsuarioHojaNode = (parentId: string, u: ArbolUsuarioInfo): ArbolNodo => {
    idsUsuariosVisibles.add(u.id);
    const id = `${parentId}>usuario:${u.id}`;
    const children = u.roleClave === 'gestor' ? buildGestorChildren(id, u) : u.roleClave === 'gerente_zona' ? buildGerenteChildren(id, u) : [];
    return { id, tipo: 'usuario', label: nombreUsuario(u), usuario: u, children };
  };

  const buildSupervisorChildrenInner = (parentId: string, supervisor: ArbolUsuarioInfo, completo: boolean): ArbolNodo[] => {
    let gestorIds = gestoresPorSupervisor.get(supervisor.id) ?? [];
    let gerenteIds = gerentesPorSupervisor.get(supervisor.id) ?? [];
    if (!completo) {
      gestorIds = gestorIds.filter((gid) => { const u = usuariosPorId.get(gid); return Boolean(u) && usuarioCoincideFiltro(u!); });
      gerenteIds = gerenteIds.filter((gid) => { const u = usuariosPorId.get(gid); return Boolean(u) && usuarioCoincideFiltro(u!); });
    }
    const gestoresNodes = gestorIds.map((gid) => usuariosPorId.get(gid)).filter((u): u is ArbolUsuarioInfo => Boolean(u)).map((u) => buildUsuarioHojaNode(`${parentId}>gestores`, u));
    const gerentesNodes = gerenteIds.map((gid) => usuariosPorId.get(gid)).filter((u): u is ArbolUsuarioInfo => Boolean(u)).map((u) => buildUsuarioHojaNode(`${parentId}>gerentes`, u));
    const subgGestores: ArbolNodo = {
      id: `${parentId}>gestores`, tipo: 'subgrupo', label: 'Gestores asignados',
      children: gestoresNodes.length ? gestoresNodes : (completo ? [msgNode(`${parentId}>gestores`, 'Sin gestores asignados')] : [])
    };
    const subgGerentes: ArbolNodo = {
      id: `${parentId}>gerentes`, tipo: 'subgrupo', label: 'Gerentes de Zona asignados',
      children: gerentesNodes.length ? gerentesNodes : (completo ? [msgNode(`${parentId}>gerentes`, 'Sin gerentes de zona asignados')] : [])
    };
    return [subgGestores, subgGerentes].filter((sg) => completo || sg.children.length > 0);
  };

  const buildSupervisorNodeNested = (parentId: string, supervisor: ArbolUsuarioInfo, forzarCompleto: boolean): ArbolNodo => {
    idsUsuariosVisibles.add(supervisor.id);
    const id = `${parentId}>usuario:${supervisor.id}`;
    const completo = forzarCompleto || !filtrando || coincideDirecto(supervisor);
    return { id, tipo: 'usuario', label: nombreUsuario(supervisor), usuario: supervisor, children: buildSupervisorChildrenInner(id, supervisor, completo) };
  };

  const buildLiderazgoChildren = (parentId: string, liderazgo: ArbolUsuarioInfo): ArbolNodo[] => {
    const completo = !filtrando || coincideDirecto(liderazgo);
    let supervisorIds = supervisoresPorLiderazgo.get(liderazgo.id) ?? [];
    if (!completo) supervisorIds = supervisorIds.filter((sid) => { const s = usuariosPorId.get(sid); return Boolean(s) && usuarioCoincideFiltro(s!); });
    if (supervisorIds.length === 0) return completo ? [msgNode(parentId, 'Sin asignación')] : [];
    return supervisorIds.map((sid) => buildSupervisorNodeNested(parentId, usuariosPorId.get(sid)!, completo));
  };

  const liderazgoLabelDe = (supervisorId: string): string => {
    const ids = liderazgoPorSupervisor.get(supervisorId) ?? [];
    if (ids.length === 0) return 'Sin líder asignado';
    return `Liderazgo: ${ids.map((id) => { const u = usuariosPorId.get(id); return u ? nombreUsuario(u) : id; }).join(', ')}`;
  };
  const supervisorLabelDe = (usuarioId: string, mapa: Map<string, string[]>): string => {
    const ids = mapa.get(usuarioId) ?? [];
    if (ids.length === 0) return 'Sin supervisor asignado';
    return `Supervisor: ${ids.map((id) => { const u = usuariosPorId.get(id); return u ? nombreUsuario(u) : id; }).join(', ')}`;
  };

  const buildNodoRaiz = (parentId: string, u: ArbolUsuarioInfo): ArbolNodo => {
    idsUsuariosVisibles.add(u.id);
    const id = `${parentId}>usuario:${u.id}`;
    if (u.roleClave === 'liderazgo') return { id, tipo: 'usuario', label: nombreUsuario(u), usuario: u, children: buildLiderazgoChildren(id, u) };
    if (u.roleClave === 'supervisor') return { id, tipo: 'usuario', label: nombreUsuario(u), subtitle: liderazgoLabelDe(u.id), usuario: u, children: buildSupervisorChildrenInner(id, u, !filtrando || coincideDirecto(u)) };
    if (u.roleClave === 'gestor') return { id, tipo: 'usuario', label: nombreUsuario(u), subtitle: supervisorLabelDe(u.id, supervisorPorGestor), usuario: u, children: buildGestorChildren(id, u) };
    if (u.roleClave === 'gerente_zona') return { id, tipo: 'usuario', label: nombreUsuario(u), subtitle: supervisorLabelDe(u.id, supervisorPorGerente), usuario: u, children: buildGerenteChildren(id, u) };
    const subtitle = u.roleClave === 'administrador' ? 'Acceso global' : undefined;
    return { id, tipo: 'usuario', label: nombreUsuario(u), subtitle, usuario: u, children: [] };
  };

  const clavesRaiz = rolFiltro ? [rolFiltro] : [...ROLE_ORDER, 'otros'];
  const raices: ArbolNodo[] = clavesRaiz
    .map((clave) => {
      let usuariosGrupo = usuariosPorClave.get(clave) ?? [];
      if (filtrando) usuariosGrupo = usuariosGrupo.filter((u) => usuarioCoincideFiltro(u));
      usuariosGrupo = usuariosGrupo.slice().sort((a, b) => nombreUsuario(a).localeCompare(nombreUsuario(b), 'es'));
      const rootId = `raiz:${clave}`;
      return { id: rootId, tipo: 'raiz' as const, label: ROLE_GROUP_LABEL[clave] ?? clave, children: usuariosGrupo.map((u) => buildNodoRaiz(rootId, u)) };
    })
    .filter((g) => g.children.length > 0);

  return { raices, totalVisible: idsUsuariosVisibles.size, filtrando };
};
