import { Request, Response, NextFunction } from 'express';
import { isAuthConfigured } from '../config/authEnv';
import { verifySupabaseToken, tokenDiagnostics } from '../services/JwtVerifier';
import { AuthContext, loadAuthContext } from '../services/PerfilService';
import { resolveScopeContext, type ScopeContext } from '../services/ScopeService';
import { registrarAuditoria } from '../services/AuditoriaService';

/**
 * Contexto autenticado disponible en `req.auth`: la identidad de PerfilService
 * (userId/profile/role/permissions/scope) MÁS el `scopeContext` resuelto por
 * ScopeService (FASE 3.3.2). El alcance NO se aplica aún a ningún endpoint.
 */
export type AuthenticatedContext = AuthContext & { scopeContext: ScopeContext };

// Extiende Express.Request con el contexto autenticado (scopeContext opcional
// para que la asignación del AuthContext base siga siendo compatible).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext & { scopeContext?: ScopeContext };
    }
  }
}

const extractToken = (req: Request): string | null => {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
};

/**
 * Únicas rutas alcanzables mientras la contraseña temporal está VENCIDA
 * (política Avon2026, 15 días — ver PerfilService.calcularPasswordPolicy):
 * el usuario debe poder seguir autenticado el tiempo justo para cambiarla,
 * nunca quedar en un callejón sin salida. `/auth/me` es indispensable para
 * que el frontend SEPA que está vencida y muestre el formulario forzado;
 * `/auth/password-changed` es el único endpoint que limpia el estado;
 * `/auth/event` es auditoría de sesión, inocua, ya se llama en cada login.
 * Todo lo demás (dashboard, cartera, usuarios, configuración, etc.) queda
 * bloqueado con 403 — así una sesión anterior ya abierta no puede seguir
 * operando ignorando el vencimiento (ver auditoría de SESSIONS).
 */
const RUTAS_PERMITIDAS_CON_PASSWORD_VENCIDA = new Set(['/api/auth/me', '/api/auth/event', '/api/auth/password-changed']);

/**
 * Middleware que exige un JWT válido de Supabase Auth. Verifica la firma con la
 * clave PÚBLICA del JWKS del proyecto (ES256/RS256) o, como respaldo, con el
 * secreto HS256 legado; valida issuer/audience/expiración; y carga
 * perfil/rol/permisos en req.auth. NO aplica todavía filtrado de datos por alcance.
 */
export const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isAuthConfigured()) {
      res.status(500).json({ error: 'Autenticación no configurada en el servidor (falta SUPABASE_URL o SUPABASE_JWT_SECRET).' });
      return;
    }

    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'No autenticado.' });
      return;
    }

    let userId: string;
    try {
      const verified = await verifySupabaseToken(token);
      userId = verified.userId;
    } catch (err) {
      // Log de diagnóstico TEMPORAL: nunca imprime el token completo ni secretos.
      console.warn('[AUTH] Verificación JWT fallida:', (err as Error).message, tokenDiagnostics(token));
      res.status(401).json({ error: 'Token inválido o expirado.' });
      return;
    }

    const context = await loadAuthContext(userId);
    if (!context) {
      await registrarAuditoria(userId, 'acceso_denegado', 'sesion', userId, { motivo: 'perfil inexistente o inactivo' });
      res.status(403).json({ error: 'Perfil no encontrado o inactivo.' });
      return;
    }

    // Contraseña temporal VENCIDA (política Avon2026, 15 días): bloquea todo
    // menos el puñado de rutas que el propio usuario necesita para cambiarla
    // (ver RUTAS_PERMITIDAS_CON_PASSWORD_VENCIDA arriba). Antes de que venza,
    // must_change_password=true NO bloquea nada — el usuario sigue operando
    // normalmente y solo ve una advertencia (eso lo decide el frontend).
    if (context.passwordPolicy.expired && !RUTAS_PERMITIDAS_CON_PASSWORD_VENCIDA.has(req.originalUrl.split('?')[0])) {
      await registrarAuditoria(context.userId, 'acceso_denegado', 'password_temporal_vencida', context.userId, {});
      res.status(403).json({
        error: 'PASSWORD_TEMPORAL_VENCIDA',
        mensaje: 'Tu contraseña temporal ha vencido. Debes cambiarla para continuar.'
      });
      return;
    }

    // Resuelve el alcance con ScopeService (ÚNICA fuente de verdad), reutilizando
    // la identidad ya cargada (no re-consulta profiles/roles/permissions).
    // FAIL-CLOSED: si la resolución falla, se rechaza la petición; NUNCA se
    // concede acceso global ante un error.
    let scopeContext: ScopeContext;
    try {
      scopeContext = await resolveScopeContext({
        userId: context.userId,
        roleClave: context.role?.clave ?? null,
        permissions: context.permissions
      });
    } catch (scopeError) {
      console.error('[SCOPE] No se pudo resolver el alcance del usuario:', (scopeError as Error).message);
      await registrarAuditoria(context.userId, 'acceso_denegado', 'scope', context.userId, {
        motivo: 'error al resolver el alcance de acceso'
      });
      res.status(403).json({ error: 'No se pudo determinar el alcance de acceso.' });
      return;
    }

    req.auth = { ...context, scopeContext };
    next();
  } catch (error) {
    next(error);
  }
};
