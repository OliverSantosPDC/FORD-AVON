import { ALLOWED_COUNTRIES, resolveCountry, MONEDA_POR_PAIS, usdEquivalente, type CountryInfo } from '../utils/carteraAggregations';
import { getGeneral, leerPlantillaCarta } from './ConfigService';
import { getSupabaseClient } from '../config/supabaseClient';
import { SUPABASE_CARTERA_TABLE } from '../config/env';

/**
 * Plantillas de cartas de cobro por PD (FORD-AVON). Reutiliza config_plantillas
 * (misma tabla/clave/version/updated_at/updated_by ya usada por el resto de
 * plantillas de Configuración) — aquí solo se agrega la lógica de qué clave
 * corresponde a cada PD y cómo se sustituyen sus variables «Placeholder».
 *
 * PD0 no tiene carta (no se cobra con carta en ese nivel). PD1/PD2/PD3
 * comparten EXACTAMENTE la misma plantilla (carta_pd1, renombrada
 * "Carta PD1-PD3"): no existen carta_pd2/carta_pd3 como plantillas reales,
 * esas filas quedan sin usar. PD4-PD7 tienen cada una su propia plantilla.
 */
export const PD_VALIDOS = ['PD0', 'PD1', 'PD2', 'PD3', 'PD4', 'PD5', 'PD6', 'PD7'] as const;
export type PdValido = (typeof PD_VALIDOS)[number];

const CLAVE_POR_PD: Record<PdValido, string | null> = {
  PD0: null,
  PD1: 'carta_pd1',
  PD2: 'carta_pd1',
  PD3: 'carta_pd1',
  PD4: 'carta_pd4',
  PD5: 'carta_pd5',
  PD6: 'carta_pd6',
  PD7: 'carta_pd7'
};

/** Normaliza cualquier variante de texto de PD ("pd4", "PD 4", "PD4+") al valor canónico "PD4", o null si no reconoce ninguno. */
export const normalizarPd = (raw: unknown): PdValido | null => {
  const m = String(raw ?? '').toUpperCase().match(/PD\s*([0-7])/);
  if (!m) return null;
  return `PD${m[1]}` as PdValido;
}

/** Clave de config_plantillas para un PD, o null si ese PD no tiene carta (PD0, o PD no reconocido). */
export const claveParaPd = (pdRaw: unknown): string | null => {
  const pd = normalizarPd(pdRaw);
  return pd ? CLAVE_POR_PD[pd] : null;
};

/** Mismo símbolo visual que frontend/src/utils/monedaOptions.ts (MONEDA_OPTIONS) — duplicado aquí porque backend/frontend no comparten paquete de utilidades. */
const SIMBOLO_MONEDA: Record<string, string> = { USD: '$', GTQ: 'Q', HNL: 'L', NIO: 'C', PAB: 'B/$', DOP: 'RD$' };

const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "01 de Octubre de 2026" — formato EXACTO pedido (día con 2 dígitos, mes con mayúscula inicial, año). */
export const formatearFechaEspanol = (d: Date): string => {
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = MESES_ES[d.getMonth()];
  const mesCapitalizado = mes.charAt(0).toUpperCase() + mes.slice(1);
  return `${dia} de ${mesCapitalizado} de ${d.getFullYear()}`;
};

/** Año de campaña si el texto lo trae (ej. "CAMPAÑA 14-2026" -> "2026"); cadena vacía si no corresponde ("si corresponde", no se inventa). */
export const anioDeCampania = (campania: unknown): string => {
  const m = String(campania ?? '').match(/\b(20\d{2})\b/);
  return m ? m[1] : '';
};

/** Slug de la clave de config_general para la dirección configurable de un país (ej. Guatemala -> direccion_pais_guatemala). */
const SLUG_PAIS: Record<string, string> = {
  'El Salvador': 'el_salvador', 'Guatemala': 'guatemala', 'Honduras': 'honduras',
  'Nicaragua': 'nicaragua', 'Panamá': 'panama', 'República Dominicana': 'republica_dominicana'
};
export const direccionClaveParaPais = (country: CountryInfo | null): string | null =>
  country ? `direccion_pais_${SLUG_PAIS[country.name]}` : null;

/** `[«Nombre» pendiente de configurar]` — nunca se inventa un contacto/dirección/razón social real. */
const pendiente = (etiqueta: string) => `[${etiqueta} pendiente de configurar]`;

export interface DatosCuentaCarta {
  pais: unknown;
  nombre: unknown;
  codigo: unknown;
  zona: unknown;
  saldoActual: unknown;
  campaniaAdeuda: unknown;
  pdActual: unknown;
}

export interface CartaRenderizada {
  pd: PdValido | null;
  disponible: boolean;
  plantillaClave: string | null;
  contenido: string | null;
  variablesFaltantes: string[];
  /** Referencia estable (profiles.id) al supervisor cuya firma usa la
   *  plantilla YA GUARDADA — null si es "Sin firma" explícito, si el PD no
   *  tiene carta, o si viene de `previsualizarContenidoCarta` (un borrador
   *  nunca lee config_plantillas, así que no hay fila de la que leerlo). */
  firmaSupervisorId: string | null;
}

/**
 * Núcleo de sustitución de variables, compartido por `renderizarCarta`
 * (plantilla YA GUARDADA en config_plantillas) y `previsualizarContenidoCarta`
 * (texto BORRADOR aún sin guardar, usado por el botón "Vista previa" del
 * editor de Configuración) — un único motor, nunca dos implementaciones.
 * Única fuente de verdad del saldo: `saldo_actual` en moneda LOCAL (NUNCA
 * `saldo_actual_usd`) — si se necesitara otra moneda, se usaría
 * `usdEquivalente` (mismo motor que el resto del sistema), nunca una fórmula
 * paralela. `tasas` solo se usa si en el futuro se habilita mostrar el saldo
 * en una moneda distinta a la local; por ahora el texto siempre usa la local.
 */
const sustituirVariables = (
  pd: PdValido,
  plantilla: string,
  asunto: string,
  datos: DatosCuentaCarta,
  general: Record<string, string>,
  tasas: Record<string, number>,
  fechaEmision: Date
): { contenido: string; variablesFaltantes: string[] } => {
  const faltantes: string[] = [];

  const country = resolveCountry(datos.pais);
  const direccionClave = direccionClaveParaPais(country);
  const direccion = (direccionClave ? general[direccionClave] : '') || '';
  if (!direccion) faltantes.push(direccionClave ?? 'direccion_pais');
  const localizacion = `${country?.name ?? String(datos.pais ?? '')}${direccion ? `, ${direccion}` : `, ${pendiente('Dirección')}`}`;

  const moneda = country ? MONEDA_POR_PAIS[country.name] ?? 'USD' : 'USD';
  const saldoNum = Number(datos.saldoActual) || 0;
  // Saldo SIEMPRE desde saldo_actual local; usdEquivalente solo se usaría si se
  // mostrara otra moneda (no es el caso por defecto) — se referencia aquí para
  // dejar constancia de que, de necesitarse, es ESTE el único motor a usar.
  void usdEquivalente(saldoNum, datos.pais, tasas);
  const saldoFormateado = `${SIMBOLO_MONEDA[moneda] ?? moneda} ${saldoNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const whatsapp = general.whatsapp_cobros || '';
  if (!whatsapp) faltantes.push('whatsapp_cobros');
  const razonSocial = general.nombre_empresa || '';
  if (!razonSocial) faltantes.push('nombre_empresa');
  const plazoDias = general.plazo_pd7_dias || '';
  if (pd === 'PD7' && !plazoDias) faltantes.push('plazo_pd7_dias');
  if (!asunto) faltantes.push('asunto');
  // Sin fuente confiable de contacto directo del Gestor (ninguna tabla lo
  // registra hoy — ver auditoría): se marca explícitamente como pendiente,
  // nunca se inventa un número.
  faltantes.push('contacto_gestor');

  const valores: Record<string, string> = {
    Asunto: asunto || pendiente('Asunto'),
    Localizacion: localizacion,
    Fecha_emision: formatearFechaEspanol(fechaEmision),
    Nombre_Mayusculas: String(datos.nombre ?? '').toUpperCase(),
    Codigo: String(datos.codigo ?? ''),
    Zona: String(datos.zona ?? ''),
    Saldo: saldoFormateado,
    Campania: String(datos.campaniaAdeuda ?? ''),
    Anio_Campania: anioDeCampania(datos.campaniaAdeuda),
    Contacto_Gestor: pendiente('Contacto del Gestor'),
    Razon_Social: razonSocial || pendiente('Razón Social'),
    WhatsApp: whatsapp || pendiente('WhatsApp'),
    Plazo_dias: plazoDias || pendiente('Plazo')
  };

  // «Logo» y «Firma» NUNCA se sustituyen aquí: son anclas de IMAGEN (no texto),
  // resueltas por el llamador según el estado de autorización de la carta
  // (ver GestionController/ConfigController: logoUrl/firmaUrl solo se exponen
  // con estado === 'APROBADA').
  const contenido = plantilla.replace(/«([^»]+)»/g, (match, key: string) => {
    if (key === 'Logo' || key === 'Firma') return match;
    return key in valores ? valores[key] : match;
  });

  return { contenido, variablesFaltantes: faltantes };
};

/**
 * Renderiza la carta de cobro para una cuenta, según su PD ACTUAL, usando
 * la plantilla YA GUARDADA en config_plantillas (snapshot real usado por
 * Gestión/Control Operativo y por la Vista Previa "de tarjeta" de
 * Configuración).
 */
export const renderizarCarta = async (
  datos: DatosCuentaCarta,
  tasas: Record<string, number>,
  fechaEmision: Date = new Date()
): Promise<CartaRenderizada> => {
  const pd = normalizarPd(datos.pdActual);
  const clave = claveParaPd(datos.pdActual);
  if (!pd || !clave) {
    return { pd, disponible: false, plantillaClave: null, contenido: null, variablesFaltantes: [], firmaSupervisorId: null };
  }

  const [general, plantillaRow] = await Promise.all([getGeneral(), leerPlantillaCarta(clave)]);
  if (!plantillaRow || !plantillaRow.contenido) {
    return { pd, disponible: false, plantillaClave: clave, contenido: null, variablesFaltantes: ['plantilla'], firmaSupervisorId: null };
  }
  // Una plantilla desactivada en Configuración no se genera/previsualiza en
  // ningún lado (Gestión ni la vista previa "de tarjeta" de Configuración)
  // — motivo distinto de "sin contenido" para que el mensaje sea claro. El
  // editor SÍ puede seguir previsualizando su borrador vía
  // previsualizarContenidoCarta, para poder revisarla antes de reactivarla.
  if (!plantillaRow.activo) {
    return { pd, disponible: false, plantillaClave: clave, contenido: null, variablesFaltantes: ['plantilla_inactiva'], firmaSupervisorId: null };
  }

  const { contenido, variablesFaltantes } = sustituirVariables(pd, plantillaRow.contenido, plantillaRow.asunto || '', datos, general, tasas, fechaEmision);
  return { pd, disponible: true, plantillaClave: clave, contenido, variablesFaltantes, firmaSupervisorId: plantillaRow.firma_supervisor_id ?? null };
};

/**
 * Previsualiza un BORRADOR (contenido/asunto aún sin guardar) para el botón
 * "Vista previa" del editor de Configuración > Plantillas — el mismo motor
 * de sustitución que `renderizarCarta`, pero sin leer ni depender de lo que
 * haya guardado en config_plantillas, y sin el gate de `activo` (el admin
 * puede previsualizar mientras decide si reactivarla). Nunca crea ni
 * modifica ninguna carta real.
 */
export const previsualizarContenidoCarta = (
  pdRaw: unknown,
  contenidoBorrador: string,
  asuntoBorrador: string,
  datos: DatosCuentaCarta,
  general: Record<string, string>,
  tasas: Record<string, number>,
  fechaEmision: Date = new Date()
): CartaRenderizada => {
  const pd = normalizarPd(pdRaw);
  if (!pd) {
    return { pd: null, disponible: false, plantillaClave: null, contenido: null, variablesFaltantes: [], firmaSupervisorId: null };
  }
  const clave = claveParaPd(pd);
  const { contenido, variablesFaltantes } = sustituirVariables(pd, contenidoBorrador, asuntoBorrador, datos, general, tasas, fechaEmision);
  // Un borrador nunca lee config_plantillas: el supervisor elegido en el
  // editor (aún sin guardar) lo resuelve el controller directamente desde
  // el body de la petición, nunca desde aquí.
  return { pd, disponible: true, plantillaClave: clave, contenido, variablesFaltantes, firmaSupervisorId: null };
};

export { ALLOWED_COUNTRIES };

/** Las 5 plantillas reales que existen (PD0 no tiene carta). Fuente única —
 *  backend y frontend, nunca duplicada — para listarlas en Configuración >
 *  Plantillas (clave, bandas de PD, tono/descripción, variables). */
export const PLANTILLAS_CARTA_INFO: Array<{ clave: string; nombre: string; bandas: PdValido[]; tono: string }> = [
  { clave: 'carta_pd1', nombre: 'Carta PD1-PD3', bandas: ['PD1', 'PD2', 'PD3'], tono: 'Preventivo / suave' },
  { clave: 'carta_pd4', nombre: 'Carta PD4', bandas: ['PD4'], tono: 'Firme' },
  { clave: 'carta_pd5', nombre: 'Carta PD5', bandas: ['PD5'], tono: 'Firme y específico' },
  { clave: 'carta_pd6', nombre: 'Carta PD6', bandas: ['PD6'], tono: 'Urgente y claro' },
  { clave: 'carta_pd7', nombre: 'Carta PD7', bandas: ['PD7'], tono: 'Formal / crítico (requerimiento)' }
];

/** Variables documentadas para la vista "Ver sus variables" de Configuración. `soloPd7` marca la única exclusiva de ese nivel. */
export const VARIABLES_CARTA = [
  { variable: 'Asunto', descripcion: 'Asunto de la carta — se edita en su propio campo, no a mano dentro del cuerpo.' },
  { variable: 'Localizacion', descripcion: 'País + dirección configurada para ese país.' },
  { variable: 'Fecha_emision', descripcion: 'Fecha de generación, formato "01 de Octubre de 2026".' },
  { variable: 'Nombre_Mayusculas', descripcion: 'Nombre de la representante, en mayúsculas.' },
  { variable: 'Codigo', descripcion: 'Código de la cuenta.' },
  { variable: 'Zona', descripcion: 'Zona de la cuenta.' },
  { variable: 'Saldo', descripcion: 'Saldo actual en moneda LOCAL (nunca saldo_actual_usd).' },
  { variable: 'Campania', descripcion: 'Campaña que adeuda.' },
  { variable: 'Anio_Campania', descripcion: 'Año extraído de la campaña, si corresponde.' },
  { variable: 'Contacto_Gestor', descripcion: 'Contacto directo del Gestor. Sin fuente confiable hoy: pendiente de configurar.' },
  { variable: 'Razon_Social', descripcion: 'Configuración General > Nombre de la empresa.' },
  { variable: 'WhatsApp', descripcion: 'Configuración > WhatsApp de cobros.' },
  { variable: 'Plazo_dias', descripcion: 'Días de plazo (Configuración > Plazo PD7). Solo debe usarse en la plantilla de PD7.', soloPd7: true },
  { variable: 'Logo', descripcion: 'Ancla de imagen: logo autorizado (visible solo tras autorización).' },
  { variable: 'Firma', descripcion: 'Ancla de imagen: firma autorizada (visible solo tras autorización).' }
];

/** Cuenta de prueba (fixture) para previsualizar una plantilla sin necesidad de una cuenta real. */
export const fixtureParaBanda = (pd: PdValido): DatosCuentaCarta => ({
  pais: 'Guatemala', nombre: 'María Ejemplo López', codigo: 'TEST-0001', zona: 'Zona Centro',
  saldoActual: 1234.56, campaniaAdeuda: 'CAMPAÑA 10-2026', pdActual: pd
});

/** Búsqueda SIN scope por código, exclusiva de la vista previa de
 *  Configuración > Plantillas (requiere `configuracion.ver`, un permiso
 *  administrativo ya desacoplado del alcance de cartera de Gestión/Control
 *  Operativo) — nunca se usa para el flujo real de Gestión, que sigue
 *  pasando por `infoCuenta` con su `ScopeContext`. */
export const buscarCuentaParaPreview = async (codigo: string): Promise<DatosCuentaCarta | null> => {
  const { data, error } = await getSupabaseClient().from(SUPABASE_CARTERA_TABLE).select('*').eq('codigo', codigo).limit(1);
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return { pais: row.pais, nombre: row.nombre, codigo: row.codigo, zona: row.zona, saldoActual: row.saldo_actual, campaniaAdeuda: row.campania_adeuda, pdActual: row.pd_actual };
};
