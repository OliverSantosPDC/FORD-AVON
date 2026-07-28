# FORD-AVON — FASE 3.1
## Auditoría de alcance y seguridad de datos (solo diagnóstico y plan)

> Documento de auditoría. **No** se modificó código, ni se crearon SQL/migraciones. Espera confirmación antes de FASE 3.2.

---

## 1. Arquitectura actual de seguridad

**Autenticación (FASE 2 — funcionando):** `middleware/auth.ts` (`requireAuth`) valida el JWT de Supabase vía JWKS, carga `PerfilService.loadAuthContext(userId)` → `{ userId, profile, role, permissions, scope }` y lo deja en `req.auth`. El `scope` **hoy siempre se devuelve vacío**: `{ paises: [], zonas: [], gestores: [] }` (preparado, sin usar).

**Dónde se aplica `requireAuth` realmente (main.ts):**

| Ruta montada | Middleware | Estado |
|---|---|---|
| `/api` → `authRoutes` | `requireAuth` en cada endpoint | Protegido |
| `/api` → `carteraRoutes` (`GET /api/cartera`) | **ninguno** | **Público** |
| `/api` → `dashboardRoutes` (`GET /api/dashboard`, `GET /api/inteligencia`) | **ninguno** | **Público** |
| `/api` → `uploadRoutes` (`POST /api/cartera/process`, `GET /api/cartera/process/:jobId`) | **ninguno** | **Público** |
| `GET /health` | ninguno | Público (correcto) |

**Acceso a datos:** el backend usa `SUPABASE_SERVICE_ROLE_KEY` en `supabaseClient.ts` → **bypassa RLS por completo**. Cualquier política RLS sobre `cartera` no protege las respuestas de la API: la autorización tiene que vivir en la capa de aplicación.

**Caché:** `SupabaseCarteraAdapter` es singleton y mantiene en memoria **toda** la cartera (~23,824 filas, columnas del dashboard) con TTL de 5 min, **compartida entre todas las peticiones y todos los usuarios**. Se invalida al importar (`clearCache`).

**Filtros:** `DashboardController`/`CarteraController` extraen `pais, gestor, gerente, zona, pd, campania` desde `req.query`, sin ninguna validación de propiedad. `CarteraService` aplica esos filtros tal cual sobre el conjunto completo.

**Frontend:** `carteraService.ts` llama a `/api/dashboard`, `/api/inteligencia` y `/api/cartera` con **`fetch` plano** (no usa `apiFetch`), por lo que **ni siquiera envía `Authorization`**. `uploadService.ts` (process) también usa `fetch` plano.

---

## 2. Riesgos encontrados

**Críticos**

1. **Exfiltración total de cartera sin login.** `GET /api/dashboard`, `GET /api/inteligencia` y `GET /api/cartera` son públicos. Con solo la URL del backend (`https://ford-avon-backend.onrender.com`) cualquiera obtiene KPIs globales, rankings, top cuentas, nombres, saldos y —vía `/api/cartera`— filas crudas de las 23,824 cuentas. Es la fuga más grave.
2. **Importación/borrado de cartera sin autenticación.** `POST /api/cartera/process` es público y dispara `downloadAndReplaceCartera`, que **trunca y reemplaza** la tabla `cartera`. Un tercero puede provocar recargas destructivas / DoS (fire-and-forget, sin control de concurrencia).
3. **Sin control de alcance.** No existe filtrado por rol en ninguna consulta; el `scope` está vacío y no se usa.

**Altos**

4. **Filtros de confianza ciega.** `?gestor=`, `?zona=`, `?pais=` se respetan sin verificar que pertenezcan al usuario. Aun agregando login, un gestor podría pedir la zona de otro.
5. **RLS inefectiva por SERVICE_ROLE.** La seguridad no puede delegarse a RLS mientras el backend use la service role; debe enforcarse en `ScopeService`.
6. **`/api/cartera/process/:jobId` sin dueño.** Cualquiera puede sondear el estado de un job por id.

**Medios**

7. **Caché global como potencial vector de fuga** si el scope se aplicara de forma incorrecta (p. ej. cachear por request sin distinguir usuario). Hoy es raw compartida; el riesgo aparece al introducir scope si no se separa "datos" de "autorización".
8. **`GET /api/cartera` sin límite obligatorio** (el `limit` es opcional) → volcado completo.
9. **Storage bucket `cartera`**: el `.xlsx` se sube directo desde el frontend a Supabase Storage. Hay que verificar que el bucket sea **privado** y que la subida use credenciales/politicas correctas (no auditable desde el código backend).

**Bajos**

10. Logs temporales (`[PERF]`, `[AUTH]`, diagnósticos) — quitar tras estabilizar; no imprimen secretos.

---

## 3. Matriz de alcance por rol

| Rol | Alcance | Países | Zonas | Gestores | Cartera | Dashboard | Inteligencia |
|---|---|---|---|---|---|---|---|
| **administrador** | Global | Todos | Todas | Todos | Toda | Global | Global |
| **liderazgo** | Global | Todos | Todas | Todos | Toda | Global | Global |
| **supervisor** | Sus gestores (`supervisor_gestor`) | Derivados de sus gestores/zonas | Derivadas de sus gestores | Solo asignados | Solo la de sus gestores | Solo sus gestores | Solo sus gestores (agregados) |
| **gestor** | Solo lo propio | Derivado de sus filas | Derivada de sus filas | Él mismo | Solo sus cuentas | Solo sus cuentas | Solo sus cuentas |
| **gerente_zona** | Sus zonas (`gerente_zona_zona`) | Derivados de sus zonas | Solo asignadas | Todos los de sus zonas | Toda la de sus zonas | Solo sus zonas | Solo sus zonas |

**Regla de oro:** para roles NO globales, un scope vacío significa **cero resultados**, nunca "todo". Distinguir `isGlobal=true` (admin/liderazgo) de "scoped con listas vacías".

**Puentes de texto (no tocar `cartera`):** `cartera.zona → zonas.nombre`, `cartera.gestor → gestores.nombre_cartera`. La resolución de scope produce **listas de strings** que se comparan contra estos campos.

---

## 4. Endpoint por endpoint (propuesto)

| Endpoint | Autenticación | Permiso | Scope | Notas |
|---|---|---|---|---|
| `GET /health` | No | — | — | Público. |
| `GET /api/auth/me` | Sí | — | Devuelve el scope propio | Ya protegido. |
| `POST /api/auth/event` | Sí | — | — | Ya protegido. |
| `GET /api/dashboard` | **Sí** | `modulo.dashboard` | **Sí** (filtra antes de agregar) | Hoy público. |
| `GET /api/inteligencia` | **Sí** | `modulo.centro_inteligencia` | **Sí** (mismo scope) | Hoy público. |
| `GET /api/cartera` | **Sí** | `modulo.repositorio` (o el módulo que consuma la tabla) | **Sí** + límite obligatorio | Hoy público; hoy puede volcar todo. |
| `POST /api/cartera/process` | **Sí** | `cartera.importar` | Global (reemplazo total) | Autorización **por permiso**: Administrador y Supervisor. |
| `GET /api/cartera/process/:jobId` | **Sí** | `cartera.importar` | — | Mismo permiso que `process`. |

---

## 5. Estrategia recomendada de `ScopeService` (única fuente de verdad)

Cadena: **`requireAuth` → `PerfilService` (identidad+rol) → `ScopeService` (alcance efectivo) → `withScope` helper (aplica el filtro) → servicios de datos**. Los servicios (`Dashboard`, `Cartera`, `Inteligencia`) **no** deben contener lógica de roles: solo reciben un `ScopeContext` y filtran.

**`ScopeContext` propuesto:**

```
{
  userId: string,
  role: string,            // clave: administrador | liderazgo | supervisor | gestor | gerente_zona
  isGlobal: boolean,       // true para administrador y liderazgo
  paises:   string[],      // vacío + isGlobal=false ⇒ sin acceso a país
  zonas:    string[],      // nombres que casan con cartera.zona
  gestores: string[]       // nombre_cartera que casan con cartera.gestor
}
```

**Resolución por rol (todo con la service role, en backend):**

- **administrador / liderazgo:** `isGlobal = true`; listas vacías se interpretan como "sin restricción".
- **gestor:** `gestores.usuario_id = profiles.id` → tomar `gestores.nombre_cartera`. Filtro: `cartera.gestor ∈ gestores`.
- **supervisor:** `supervisor_gestor` (supervisor→gestores) → `nombre_cartera` de esos gestores. Filtro: `cartera.gestor ∈ gestores`. Zonas/países derivados para poblar los selectores.
- **gerente_zona:** `gerente_zona_zona` (gerente→zonas) → `zonas.nombre`. Filtro: `cartera.zona ∈ zonas`.

**Helper de aplicación (`applyScope(rows, ctx)`):**

- `isGlobal` → devuelve `rows` sin tocar.
- No global → conserva la fila si cumple la condición del rol; **scoped + listas vacías ⇒ `[]`**.
- Los filtros del usuario (`?gestor`, `?zona`, `?pais`, `pd`, `campania`) se **intersectan** con el scope: un valor fuera del scope se descarta (o produce cero), **nunca** amplía el alcance. `pd` y `campania` no son de scope: se aplican libremente dentro del subconjunto ya acotado.

**Punto único:** un solo módulo `ScopeService` + `applyScope`. `DashboardService`/`InteligenciaService`/`CarteraService` reciben `ctx` y llaman `applyScope` **antes** de KPIs, agregaciones, rankings y `cuentas`.

---

## 6. Estrategia recomendada de caché

**Recomendación: Opción A endurecida** — caché global de **datos crudos** + scope obligatorio después, tratando la caché como almacén de datos, **no** como frontera de autorización.

- Mantener **una** caché global de las filas crudas (como hoy): es la lectura cara (Supabase paginado). Con ~23k filas, aplicar `applyScope` en memoria por petición cuesta milisegundos.
- **Nunca** devolver la caché directamente: cada respuesta pasa siempre por `applyScope(ctx)`.
- La caché **no** debe indexarse por request ni por query del usuario (evita servir datos de otro scope).
- Optimización opcional (fase posterior): memoizar **agregaciones ya calculadas** con clave = firma canónica del scope (`role + hash(zonas,gestores)`), con el mismo TTL y misma invalidación en import. Solo si el profiling lo justifica.
- Opción B (caché por scope) queda como optimización futura, no como mecanismo de seguridad. Opción C (eliminar caché) innecesaria y perjudicaría el rendimiento del dashboard.

Invalidación: se conserva el `clearCache()` en el import.

---

## 7. Cambios necesarios en backend

1. **Proteger rutas de datos** en `main.ts`/routers: `requireAuth` + guard de permiso en `dashboardRoutes`, `carteraRoutes`, `uploadRoutes`.
2. **`ScopeService`** nuevo: resuelve `ScopeContext` desde las tablas de identidad (una sola vez por petición; cacheable por `userId` con TTL corto).
3. **Poblar `scope`** real en `PerfilService`/`loadAuthContext` (o resolverlo en el middleware de scope) en lugar de `{ [],[],[] }`.
4. **Helper `applyScope`** + `middleware/requirePermission` y `middleware/requireScope` reutilizables.
5. **Firmas de servicio**: `getDashboard`, `getInteligencia`, `listCartera` reciben `ScopeContext`; aplicar scope **antes** de agregar. `listCartera` con **límite máximo forzado**.
6. **Import** (`/api/cartera/process`): `requireAuth` + permiso `cartera.importar` + restricción de rol; `:jobId` con verificación de dueño. **No cambiar** el proceso Storage→Render→streaming→reemplazo→invalidación.
7. **`filterOptions`** del dashboard deben construirse **sobre el subconjunto con scope** (que un supervisor no vea en el selector gestores ajenos).
8. Quitar logs temporales cuando se estabilice.

**Política de import (decisión confirmada por el usuario):** autorización **por permiso `cartera.importar`**, no por rol. Lo tienen **Administrador y Supervisor** → ambos pueden ejecutar la importación global; Liderazgo, Gerente de Zona y Gestor **No**. El Supervisor conserva su alcance acotado para consultas/módulos, pero queda autorizado para la importación global de cartera. El endpoint valida el permiso (no el rol), de modo que basta con `cartera.importar` en `role_permissions`. **Acción en Supabase:** mantener `cartera.importar` asignado a administrador y supervisor, y eliminarlo de cualquier otro rol que lo tuviera.

---

## 8. Cambios necesarios en frontend

1. **`carteraService.ts` y `uploadService.ts`: usar `apiFetch`** (que ya añade `Authorization: Bearer`) en lugar de `fetch` plano. Sin esto, aun protegiendo el backend, el dashboard recibiría 401.
2. El scope es **de servidor**: el frontend solo envía filtros como *preferencia*; nunca asume alcance. Los selectores deben poblarse con `filterOptions` ya acotados que devuelve el backend.
3. Manejo de 401/403: redirigir a login o mostrar "Acceso no autorizado" (ya existe `PermissionRoute`).
4. No descargar toda la cartera para filtrar en cliente (ya se respeta; mantenerlo).

---

## 9. Cambios en Supabase / RLS

- **Autorización efectiva = capa de aplicación** (backend con service role). RLS no filtra las respuestas de la API mientras se use la service role.
- **RLS como defensa en profundidad**, no como mecanismo principal: mantener/activar RLS en las tablas de identidad y en `cartera` para bloquear accesos con la **anon key** (por si algún día el frontend consultara Supabase directo). No apoyar la seguridad del producto únicamente en ella.
- Verificar que el **bucket `cartera` sea privado** y que las subidas usen credenciales adecuadas (URL firmada / política restringida).
- Confirmar que `SUPABASE_SERVICE_ROLE_KEY` **solo** vive en Render (nunca en Vercel/`VITE_`).

---

## 10. Posibles cambios de base de datos

- **`cartera`: sin cambios** (ni FKs ni UUIDs; se reemplaza en cada carga). Se usa el puente de texto existente.
- **Países:** `profiles` no tiene relación con país, y **para los 5 roles definidos no hace falta**: el país es **derivable** (admin/liderazgo=todos; gestor/supervisor por sus gestores; gerente por sus zonas). *Prerrequisito:* que `zonas` tenga columna `pais` (o `gestores`/`zonas` permitan derivarlo) para poblar el país en los selectores. **Recomendación: no crear tablas de país ahora.** Si más adelante aparece un rol "responsable de país", añadir entonces una relación `profile_paises` (N:M). 
- Posible permiso nuevo `cartera.importar` en `permissions` + `role_permissions` (solo administrador).
- Índices en `cartera` sobre `gestor` y `zona` si se decidiera filtrar en base de datos en vez de en memoria (opcional; hoy el filtrado in-memory sobre la caché es suficiente).

---

## 11. Plan por subfases

- **3.2 — Cerrar el perímetro (rápido, alto impacto):** `requireAuth` en dashboard/inteligencia/cartera/process; frontend a `apiFetch`; import restringido a Administrador; job con dueño. *Resultado:* nada de datos sin login.
- **3.3 — ScopeService + applyScope:** resolución de alcance y filtrado server-side en Dashboard/Inteligencia/Cartera; `filterOptions` acotados; regla "scoped vacío = cero".
- **3.4 — Intersección de filtros y límites:** filtros del usuario intersectados con scope; límite máximo en `/api/cartera`.
- **3.5 — Endurecimiento:** RLS defensa en profundidad, bucket privado, quitar logs, memoización opcional por firma de scope.
- **3.6 — Pruebas de seguridad y regresión** (ver §14).

---

## 12. Riesgos de migración

- **Romper el dashboard** si se protege el backend antes de migrar el frontend a `apiFetch` → hacerlo en el mismo despliegue de 3.2.
- **Falsos "cero resultados"** por desalineación de texto (mayúsculas/acentos/espacios) entre `cartera.zona`/`gestor` y `zonas.nombre`/`gestores.nombre_cartera` → normalizar comparaciones y auditar coincidencias antes de activar.
- **Usuarios sin gestor/zona asignada** quedarían sin datos (comportamiento correcto, pero hay que comunicarlo y validar las asignaciones antes).
- **Recarga de cartera** cambia nombres → mantener sincronizado `gestores.nombre_cartera`/`zonas.nombre` con el archivo.
- **Rendimiento**: aplicar scope por petición es barato, pero medir con admin (conjunto completo) tras invalidar caché.

---

## 13. Orden recomendado de implementación

1. Frontend a `apiFetch` (dashboard/inteligencia/cartera/upload).
2. `requireAuth` + permisos en las rutas de datos e import (perímetro).
3. `ScopeService` + `applyScope` (una fuente de verdad).
4. Integrar scope en Dashboard → Inteligencia → Cartera; `filterOptions` acotados.
5. Intersección de filtros del usuario con scope + límite obligatorio.
6. Endurecimiento (RLS, bucket, logs, memoización opcional).
7. Batería de pruebas de seguridad.

---

## 14. Pruebas de seguridad a ejecutar

- **Sin token:** `GET /api/dashboard|inteligencia|cartera` → 401; `POST /api/cartera/process` → 401.
- **Aislamiento por rol:** gestor A no ve cuentas de gestor B; supervisor solo ve sus gestores; gerente solo sus zonas.
- **Manipulación de filtros:** gestor/supervisor con `?gestor=<ajeno>` o `?zona=<ajena>` → cero resultados, no fuga.
- **Escalamiento:** cambiar `sub`/ids en el payload no altera el scope (se resuelve server-side desde el token).
- **Scoped vacío:** usuario sin asignaciones → cero, nunca "todo".
- **Import:** solo Administrador dispara `process`; otros roles → 403; `:jobId` ajeno → 403/404.
- **Intersección:** filtros dentro del scope funcionan; fuera del scope se descartan.
- **Caché:** dos usuarios con distinto scope en peticiones consecutivas nunca comparten datos.
- **Regresión:** admin/liderazgo ven exactamente lo mismo que hoy; carga de `CARTERA COBRO.xlsx`/`ASIGNACION` sigue igual.
- **Storage:** el objeto de cartera no es accesible sin credenciales.

---

*Fin de la auditoría FASE 3.1. A la espera de confirmación para implementar FASE 3.2.*
