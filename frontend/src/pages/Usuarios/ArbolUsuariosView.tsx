import { Box, Button, Checkbox, Chip, Collapse, FormControlLabel, IconButton, Paper, Stack, Switch, Typography } from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import LockResetIcon from '@mui/icons-material/LockReset';
import LockClockIcon from '@mui/icons-material/LockClock';
import PublicIcon from '@mui/icons-material/Public';
import { recolectarIdsUsuario, type ArbolNodo } from './arbolUsuarios';

/**
 * Vista principal de Configuración > Usuarios: árbol jerárquico expandible/
 * contraíble (Administrador / Liderazgo -> Supervisor -> Gestor + Gerente de
 * zona -> País -> División -> Zona). Reemplaza la tabla plana por grupo de
 * rol — el armado de las ramas vive en `arbolUsuarios.ts` (lógica pura); este
 * componente SOLO presenta `ArbolNodo[]` y delega cada acción (editar,
 * activar/desactivar, seleccionar, restablecer contraseña) al padre.
 */

interface NodoFilaProps {
  /** true si hay un filtro de recorte activo (búsqueda/país): fuerza que todo
   *  lo visible quede expandido, para no obligar a expandir manualmente cada
   *  coincidencia encontrada. */
  filtrando: boolean;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  canAdminGlobal: boolean;
  selUsuarios: Set<string>;
  onToggleSelUsuario: (id: string) => void;
  onToggleSelGrupo: (ids: string[]) => void;
  onEdit: (id: string) => void;
  onToggleActivo: (u: { id: string; activo: boolean }) => void;
  onResetPassword: (u: { id: string; email: string }) => void;
  onResetTemporal: (u: { id: string; email: string }) => void;
}

interface ArbolUsuariosViewProps extends NodoFilaProps {
  raices: ArbolNodo[];
}

const ROLE_ICON_BG: Record<string, string> = {
  administrador: 'rgba(156,39,176,0.12)', liderazgo: 'rgba(25,118,210,0.12)', supervisor: 'rgba(0,150,136,0.12)',
  gestor: 'rgba(245,124,0,0.12)', gerente_zona: 'rgba(211,47,47,0.12)'
};

const NodoFila = ({
  nodo, depth, filtrando, expandedIds, onToggleExpand, canAdminGlobal, selUsuarios,
  onToggleSelUsuario, onToggleSelGrupo, onEdit, onToggleActivo, onResetPassword, onResetTemporal
}: NodoFilaProps & { nodo: ArbolNodo; depth: number }) => {
  const tieneHijos = nodo.children.length > 0;
  const abierto = filtrando || expandedIds.has(nodo.id);
  const pl = 1.5 + depth * 2.25;

  if (nodo.tipo === 'raiz') {
    const ids = recolectarIdsUsuario(nodo);
    const idsUnicos = Array.from(new Set(ids));
    const todosSeleccionados = idsUnicos.length > 0 && idsUnicos.every((id) => selUsuarios.has(id));
    return (
      <Paper sx={{ borderRadius: 2.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
        <Box
          onClick={() => onToggleExpand(nodo.id)}
          data-testid={`arbol-raiz-${nodo.label}`}
          sx={{ p: 1.25, display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', bgcolor: 'action.hover' }}
        >
          {canAdminGlobal && idsUnicos.length > 0 && (
            <Checkbox
              size="small"
              onClick={(e) => e.stopPropagation()}
              indeterminate={idsUnicos.some((id) => selUsuarios.has(id)) && !todosSeleccionados}
              checked={todosSeleccionados}
              onChange={() => onToggleSelGrupo(idsUnicos)}
            />
          )}
          <IconButton size="small">{abierto ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}</IconButton>
          <Typography sx={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 13, letterSpacing: 0.4 }}>{nodo.label}</Typography>
          <Chip size="small" label={nodo.children.length} />
        </Box>
        <Collapse in={abierto} unmountOnExit>
          <Stack divider={<Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }} />}>
            {nodo.children.map((hijo) => (
              <NodoFila key={hijo.id} nodo={hijo} depth={0} filtrando={filtrando} expandedIds={expandedIds} onToggleExpand={onToggleExpand}
                canAdminGlobal={canAdminGlobal} selUsuarios={selUsuarios} onToggleSelUsuario={onToggleSelUsuario} onToggleSelGrupo={onToggleSelGrupo}
                onEdit={onEdit} onToggleActivo={onToggleActivo} onResetPassword={onResetPassword} onResetTemporal={onResetTemporal} />
            ))}
          </Stack>
        </Collapse>
      </Paper>
    );
  }

  if (nodo.tipo === 'usuario' && nodo.usuario) {
    const u = nodo.usuario;
    return (
      <Box>
        <Box
          onClick={() => { if (tieneHijos) onToggleExpand(nodo.id); }}
          data-testid={`nodo-usuario-${u.id}`}
          sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, pl, pr: 1, flexWrap: 'wrap', cursor: tieneHijos ? 'pointer' : 'default', '&:hover': { bgcolor: 'action.hover' } }}
        >
          {canAdminGlobal && <Checkbox size="small" onClick={(e) => e.stopPropagation()} checked={selUsuarios.has(u.id)} onChange={() => onToggleSelUsuario(u.id)} />}
          <IconButton size="small" disabled={!tieneHijos} sx={{ visibility: tieneHijos ? 'visible' : 'hidden' }}>
            {abierto ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
          </IconButton>
          <Box
            sx={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, bgcolor: ROLE_ICON_BG[u.roleClave ?? ''] ?? 'action.selected' }}
          >
            {(u.nombre[0] ?? '?').toUpperCase()}
          </Box>
          <Box sx={{ minWidth: 160 }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.2 }}>{nodo.label}</Typography>
            <Typography sx={{ fontSize: 11.5, color: 'text.secondary', lineHeight: 1.2 }}>{u.email}</Typography>
          </Box>
          {u.roleNombre && <Chip size="small" label={u.nivel ? `${u.roleNombre} (N${u.nivel})` : u.roleNombre} />}
          {nodo.subtitle && <Chip size="small" variant="outlined" label={nodo.subtitle} sx={{ fontSize: 11 }} />}
          <Box onClick={(e) => e.stopPropagation()} sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
            <FormControlLabel
              control={<Switch size="small" checked={u.activo} disabled={!canAdminGlobal} onChange={() => onToggleActivo(u)} />}
              label={u.activo ? 'Activo' : 'Inactivo'}
              sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: 12 } }}
            />
            {canAdminGlobal && (
              <>
                <Button size="small" startIcon={<EditOutlinedIcon fontSize="small" />} onClick={() => onEdit(u.id)} sx={{ textTransform: 'none' }}>Editar</Button>
                <Button size="small" startIcon={<LockResetIcon fontSize="small" />} onClick={() => onResetPassword({ id: u.id, email: u.email })} sx={{ textTransform: 'none' }}>Contraseña</Button>
                {u.roleClave !== 'administrador' && (
                  <Button size="small" startIcon={<LockClockIcon fontSize="small" />} onClick={() => onResetTemporal({ id: u.id, email: u.email })} sx={{ textTransform: 'none' }}>Restablecer</Button>
                )}
              </>
            )}
          </Box>
        </Box>
        {tieneHijos && (
          <Collapse in={abierto} unmountOnExit>
            <Stack>
              {nodo.children.map((hijo) => (
                <NodoFila key={hijo.id} nodo={hijo} depth={depth + 1} filtrando={filtrando} expandedIds={expandedIds} onToggleExpand={onToggleExpand}
                  canAdminGlobal={canAdminGlobal} selUsuarios={selUsuarios} onToggleSelUsuario={onToggleSelUsuario} onToggleSelGrupo={onToggleSelGrupo}
                  onEdit={onEdit} onToggleActivo={onToggleActivo} onResetPassword={onResetPassword} onResetTemporal={onResetTemporal} />
              ))}
            </Stack>
          </Collapse>
        )}
      </Box>
    );
  }

  if (nodo.tipo === 'subgrupo') {
    return (
      <Box>
        <Box onClick={() => onToggleExpand(nodo.id)} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.5, pl, pr: 1, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}>
          <IconButton size="small">{abierto ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}</IconButton>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.3 }}>{nodo.label}</Typography>
          <Chip size="small" variant="outlined" label={nodo.children.filter((c) => c.tipo === 'usuario').length} sx={{ fontSize: 10, height: 18 }} />
        </Box>
        <Collapse in={abierto} unmountOnExit>
          <Stack>
            {nodo.children.map((hijo) => (
              <NodoFila key={hijo.id} nodo={hijo} depth={depth + 1} filtrando={filtrando} expandedIds={expandedIds} onToggleExpand={onToggleExpand}
                canAdminGlobal={canAdminGlobal} selUsuarios={selUsuarios} onToggleSelUsuario={onToggleSelUsuario} onToggleSelGrupo={onToggleSelGrupo}
                onEdit={onEdit} onToggleActivo={onToggleActivo} onResetPassword={onResetPassword} onResetTemporal={onResetTemporal} />
            ))}
          </Stack>
        </Collapse>
      </Box>
    );
  }

  if (nodo.tipo === 'pais' || nodo.tipo === 'division') {
    return (
      <Box>
        <Box onClick={() => onToggleExpand(nodo.id)} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.5, pl, pr: 1, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}>
          <IconButton size="small">{abierto ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}</IconButton>
          {nodo.tipo === 'pais' && <PublicIcon sx={{ fontSize: 15, color: 'text.secondary' }} />}
          <Typography sx={{ fontSize: 12.5, fontWeight: nodo.tipo === 'pais' ? 700 : 600 }}>{nodo.label}</Typography>
          <Chip size="small" variant="outlined" label={nodo.children.length} sx={{ fontSize: 10, height: 18 }} />
        </Box>
        <Collapse in={abierto} unmountOnExit>
          <Stack>
            {nodo.children.map((hijo) => (
              <NodoFila key={hijo.id} nodo={hijo} depth={depth + 1} filtrando={filtrando} expandedIds={expandedIds} onToggleExpand={onToggleExpand}
                canAdminGlobal={canAdminGlobal} selUsuarios={selUsuarios} onToggleSelUsuario={onToggleSelUsuario} onToggleSelGrupo={onToggleSelGrupo}
                onEdit={onEdit} onToggleActivo={onToggleActivo} onResetPassword={onResetPassword} onResetTemporal={onResetTemporal} />
            ))}
          </Stack>
        </Collapse>
      </Box>
    );
  }

  if (nodo.tipo === 'zona') {
    return (
      <Box sx={{ pl: pl + 3, py: 0.4 }}>
        <Chip size="small" label={nodo.label} sx={{ fontSize: 11 }} />
      </Box>
    );
  }

  // 'mensaje' — ej. "Sin asignación".
  return (
    <Box sx={{ pl: pl + 3, py: 0.5 }}>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', fontStyle: 'italic' }}>{nodo.label}</Typography>
    </Box>
  );
};

const ArbolUsuariosView = (props: ArbolUsuariosViewProps) => (
  <Stack spacing={1.5}>
    {props.raices.map((raiz) => (
      <NodoFila key={raiz.id} {...props} nodo={raiz} depth={0} />
    ))}
  </Stack>
);

export default ArbolUsuariosView;
