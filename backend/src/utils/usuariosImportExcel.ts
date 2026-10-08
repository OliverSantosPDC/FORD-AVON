import ExcelJS from 'exceljs';

/**
 * Plantillas e importación masiva de USUARIOS (Configuración > Usuarios) —
 * reemplaza por completo el antiguo módulo "Gestión masiva de Usuarios" de
 * Repositorio (eliminado). Estructura fuente: `Plantilla_Usuarios.xlsx`
 * (hojas "Adminstrativo"/"Comercial" del archivo de referencia real).
 *
 * Dos hojas, cada una un renglón por PERSONA (no por relación):
 *   Administrativo — NOMBRE, APELLIDO, NOMBRE COMPLETO, CORREO, CONTACTO, ROL, NIVEL, PAIS
 *   Comercial      — igual + DIVISION, ZONA
 *
 * Una misma persona (identificada por CORREO normalizado, nunca por nombre)
 * puede aparecer en VARIAS filas de Comercial cuando representa asignaciones
 * de zona/división distintas (p. ej. una Gerente de zona con 2 zonas) — se
 * procesa como UN solo usuario con varias asignaciones, nunca como usuarios
 * duplicados.
 *
 * ZONA="GV" (marcador real encontrado en el archivo de referencia, NO un rol
 * distinto: el ROL en esas filas sigue siendo "Gerente_Zona") significa
 * "todas las zonas conocidas de esa División en ese País" — se resuelve al
 * aplicar (`resolverZonasGV`), nunca al validar visualmente.
 *
 * El nombre de hoja "Adminstrativo" (con el error ortográfico real del
 * archivo de referencia) se acepta al leer un archivo subido, aunque la
 * plantilla que ESTE sistema genera use la ortografía correcta
 * "Administrativo" — nunca se descarta una hoja solo por esa variante.
 */

export type HojaUsuario = 'Administrativo' | 'Comercial';

export interface FilaImportUsuario {
  hoja: HojaUsuario;
  fila: number;
  nombre: string;
  apellido: string;
  nombreCompleto: string;
  correo: string;
  contacto: string;
  rol: string;
  nivel: string;
  pais: string;
  /** Solo hoja Comercial. Cadena vacía si no aplica. */
  division: string;
  /** Solo hoja Comercial. Cadena vacía si no aplica. Puede ser el marcador "GV". */
  zona: string;
}

export interface ParsedWorkbookUsuarios {
  filas: FilaImportUsuario[];
  hojasPresentes: Set<HojaUsuario>;
}

const cellText = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const any = value as { text?: unknown; result?: unknown };
    if (typeof any.text === 'string') return any.text;
    if (any.result !== undefined && any.result !== null) return String(any.result);
    return '';
  }
  return String(value);
};

const headerIndex = (ws: ExcelJS.Worksheet): Record<string, number> => {
  const index: Record<string, number> = {};
  ws.getRow(1).eachCell((cell, colNumber) => {
    const key = cellText(cell.value).trim().toUpperCase().replace(/\s+/g, ' ');
    if (key) index[key] = colNumber;
  });
  return index;
};

const getCell = (ws: ExcelJS.Worksheet, index: Record<string, number>, row: ExcelJS.Row, col: string): string => {
  const c = index[col];
  return c ? cellText(row.getCell(c).value).trim() : '';
};

const ADMIN_COLUMNS = [
  { header: 'NOMBRE', key: 'nombre', width: 16 },
  { header: 'APELLIDO', key: 'apellido', width: 16 },
  { header: 'NOMBRE COMPLETO', key: 'nombreCompleto', width: 28 },
  { header: 'CORREO', key: 'correo', width: 32 },
  { header: 'CONTACTO', key: 'contacto', width: 16 },
  { header: 'ROL', key: 'rol', width: 16 },
  { header: 'NIVEL', key: 'nivel', width: 8 },
  { header: 'PAIS', key: 'pais', width: 22 }
];

const COMERCIAL_COLUMNS = [
  ...ADMIN_COLUMNS,
  { header: 'DIVISION', key: 'division', width: 18 },
  { header: 'ZONA', key: 'zona', width: 10 }
];

type RoleCatalogo = Array<{ clave: string; nombre: string; nivel: number | null }>;

/** Hoja de referencia (solo lectura) con los ROL/NIVEL válidos, generada
 *  SIEMPRE a partir de los roles reales vigentes (`roles.clave`/`nivel`),
 *  nunca una lista escrita a mano. */
const agregarHojaRolesValidos = (wb: ExcelJS.Workbook, roles: RoleCatalogo): void => {
  const ws = wb.addWorksheet('ROLES_VALIDOS');
  ws.columns = [
    { header: 'ROL (usar exactamente así)', key: 'rol', width: 28 },
    { header: 'Nombre', key: 'nombre', width: 22 },
    { header: 'NIVEL', key: 'nivel', width: 8 }
  ];
  ws.getRow(1).font = { bold: true };
  roles.forEach((r) => ws.addRow([r.clave, r.nombre, r.nivel ?? '']));
};

const agregarHojaInstrucciones = (wb: ExcelJS.Workbook, filas: Array<[string, string]>): void => {
  const help = wb.addWorksheet('INSTRUCCIONES');
  help.columns = [{ header: 'Campo', key: 'campo', width: 22 }, { header: 'Descripción', key: 'desc', width: 100 }];
  help.getRow(1).font = { bold: true };
  filas.forEach((f) => help.addRow(f));
  help.getColumn('desc').alignment = { wrapText: true, vertical: 'top' };
};

/** Plantilla Administrativa: un renglón por persona (administrador, liderazgo,
 *  supervisor o gestor). Gerente de zona NO aplica aquí (va en la Comercial,
 *  donde se define su territorio). */
export const generarPlantillaAdministrativa = async (rolesCatalogo: RoleCatalogo): Promise<Buffer> => {
  const roles = rolesCatalogo.filter((r) => r.clave !== 'gerente_zona');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FORD-AVON';

  const ws = wb.addWorksheet('Administrativo');
  ws.columns = ADMIN_COLUMNS;
  ws.getRow(1).font = { bold: true };
  ws.addRow(['Admin', 'Ejemplo', 'Admin Ejemplo', 'admin.ejemplo@ejemplo.com', '00000000', 'administrador', 1, 'GUATEMALA']);
  ws.addRow(['Liderazgo', 'Ejemplo', 'Liderazgo Ejemplo', 'liderazgo.ejemplo@ejemplo.com', '00000001', 'liderazgo', 2, 'GUATEMALA']);
  ws.addRow(['Supervisor', 'Ejemplo', 'Supervisor Ejemplo', 'supervisor.ejemplo@ejemplo.com', '00000002', 'supervisor', 3, 'EL SALVADOR']);
  ws.addRow(['Gestor', 'Ejemplo', 'Gestor Ejemplo', 'gestor.ejemplo@ejemplo.com', '00000003', 'gestor', 4, 'EL SALVADOR']);

  if (roles.length > 0) {
    const rango = `ROLES_VALIDOS!$A$2:$A$${roles.length + 1}`;
    for (let r = 2; r <= 500; r += 1) {
      ws.getCell(`F${r}`).dataValidation = {
        type: 'list', allowBlank: true, formulae: [rango],
        showErrorMessage: true, errorTitle: 'ROL no válido',
        error: 'Selecciona un valor de la lista (hoja ROLES_VALIDOS).'
      };
    }
  }

  agregarHojaRolesValidos(wb, roles);
  agregarHojaInstrucciones(wb, [
    ['NOMBRE / APELLIDO', 'Obligatorios.'],
    ['NOMBRE COMPLETO', 'Informativo (se usa para mostrar al usuario); si se deja vacío se arma con NOMBRE + APELLIDO.'],
    ['CORREO', 'Identificador único de la persona. Obligatorio. Se compara normalizado (minúsculas, sin espacios).'],
    ['CONTACTO', 'Teléfono de contacto. Informativo.'],
    ['ROL', 'Ver hoja ROLES_VALIDOS. administrador | liderazgo | supervisor | gestor (Gerente de zona se define en la plantilla Comercial).'],
    ['NIVEL', 'Debe coincidir con el NIVEL real del ROL elegido (ver ROLES_VALIDOS); se valida, no se usa para decidir el rol.'],
    ['PAIS', 'País de la persona.'],
    ['Duplicados', 'Si el mismo CORREO aparece en más de una fila, se usa como UNA sola persona; si los datos de identidad (NOMBRE/APELLIDO/ROL) no coinciden entre esas filas, se reporta como conflicto y no se aplica ninguna de ellas hasta corregir el archivo.'],
    ['Asignaciones de alcance', 'Esta plantilla SOLO crea/actualiza la identidad de la persona. A quién supervisa un Supervisor/Liderazgo, o qué zonas ve un Gestor, se asigna luego en Configuración > Usuarios > Gestión de usuarios (editar usuario).']
  ]);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
};

/** Plantilla Comercial: mismas columnas + DIVISION/ZONA. Un renglón por cada
 *  asignación de territorio; una misma persona puede repetirse en varias
 *  filas (varias zonas/divisiones) — se procesa como UN usuario con varias
 *  asignaciones. ZONA="GV" = todas las zonas conocidas de esa División. */
export const generarPlantillaComercial = async (rolesCatalogo: RoleCatalogo): Promise<Buffer> => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FORD-AVON';

  const ws = wb.addWorksheet('Comercial');
  ws.columns = COMERCIAL_COLUMNS;
  ws.getRow(1).font = { bold: true };
  ws.addRow(['Gerente', 'Ejemplo Uno', 'Gerente Ejemplo Uno', 'gerente.ejemplo1@ejemplo.com', '00000010', 'gerente_zona', 5, 'GUATEMALA', 'CONACASTE', '101']);
  ws.addRow(['Gerente', 'Ejemplo Uno', 'Gerente Ejemplo Uno', 'gerente.ejemplo1@ejemplo.com', '00000010', 'gerente_zona', 5, 'GUATEMALA', 'CONACASTE', '104']);
  ws.addRow(['Gerente', 'Ejemplo Dos', 'Gerente Ejemplo Dos', 'gerente.ejemplo2@ejemplo.com', '00000011', 'gerente_zona', 5, 'GUATEMALA', 'CEIBA', 'GV']);

  if (rolesCatalogo.length > 0) {
    const rango = `ROLES_VALIDOS!$A$2:$A$${rolesCatalogo.length + 1}`;
    for (let r = 2; r <= 1000; r += 1) {
      ws.getCell(`F${r}`).dataValidation = {
        type: 'list', allowBlank: true, formulae: [rango],
        showErrorMessage: true, errorTitle: 'ROL no válido',
        error: 'Selecciona un valor de la lista (hoja ROLES_VALIDOS).'
      };
    }
  }

  agregarHojaRolesValidos(wb, rolesCatalogo);
  agregarHojaInstrucciones(wb, [
    ['NOMBRE / APELLIDO', 'Obligatorios.'],
    ['NOMBRE COMPLETO', 'Informativo; si se deja vacío se arma con NOMBRE + APELLIDO.'],
    ['CORREO', 'Identificador único de la persona. Obligatorio. Una misma persona puede repetirse en varias filas (varias zonas/divisiones): se procesa como UN solo usuario con varias asignaciones, nunca se crea un usuario por fila repetida.'],
    ['CONTACTO', 'Teléfono de contacto. Informativo.'],
    ['ROL', 'Normalmente "gerente_zona" (ver ROLES_VALIDOS). DIVISION/ZONA solo se procesan para filas con ese rol.'],
    ['NIVEL', 'Debe coincidir con el NIVEL real del ROL elegido.'],
    ['PAIS', 'País de la asignación (puede variar entre filas de la misma persona si administra zonas en más de un país).'],
    ['DIVISION', 'División organizacional del territorio (texto libre, tal como la maneja el negocio).'],
    ['ZONA', 'Código de zona (numérico) dentro de esa División/País, o el marcador especial "GV" para asignar TODAS las zonas conocidas de esa División/País (ya existentes en el sistema o en otras filas de este mismo archivo).'],
    ['Conflictos', 'Si el mismo CORREO aparece con NOMBRE/APELLIDO/ROL distintos entre filas, se reporta como conflicto y no se aplica ninguna fila de ese correo hasta corregir el archivo — nunca se fusionan identidades distintas por coincidencia de nombre.']
  ]);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
};

const SHEET_ADMIN_NAMES = ['administrativo', 'adminstrativo'];
const SHEET_COMERCIAL_NAMES = ['comercial'];

const encontrarHoja = (wb: ExcelJS.Workbook, nombresValidos: string[]): ExcelJS.Worksheet | undefined =>
  wb.worksheets.find((ws) => nombresValidos.includes(ws.name.trim().toLowerCase()));

const parseHojaPersona = (ws: ExcelJS.Worksheet, hoja: HojaUsuario): FilaImportUsuario[] => {
  const index = headerIndex(ws);
  const out: FilaImportUsuario[] = [];
  for (let r = 2; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const correo = getCell(ws, index, row, 'CORREO');
    const nombre = getCell(ws, index, row, 'NOMBRE');
    const apellido = getCell(ws, index, row, 'APELLIDO');
    const rol = getCell(ws, index, row, 'ROL');
    if (!correo && !nombre && !apellido && !rol) continue; // fila vacía
    out.push({
      hoja,
      fila: r,
      nombre,
      apellido,
      nombreCompleto: getCell(ws, index, row, 'NOMBRE COMPLETO'),
      correo,
      contacto: getCell(ws, index, row, 'CONTACTO'),
      rol: rol.toLowerCase(),
      nivel: getCell(ws, index, row, 'NIVEL'),
      pais: getCell(ws, index, row, 'PAIS'),
      division: hoja === 'Comercial' ? getCell(ws, index, row, 'DIVISION') : '',
      zona: hoja === 'Comercial' ? getCell(ws, index, row, 'ZONA') : ''
    });
  }
  return out;
};

/** Parsea el archivo subido: acepta la hoja Administrativo (o "Adminstrativo",
 *  tolerando el error ortográfico real del archivo de referencia) y/o la hoja
 *  Comercial, en cualquier combinación — ambas en el mismo workbook (como el
 *  archivo de referencia) o cada una en un archivo separado. */
export const parsearWorkbookUsuarios = async (buffer: Buffer): Promise<ParsedWorkbookUsuarios> => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const wsAdmin = encontrarHoja(wb, SHEET_ADMIN_NAMES);
  const wsComercial = encontrarHoja(wb, SHEET_COMERCIAL_NAMES);
  if (!wsAdmin && !wsComercial) {
    throw new Error('El archivo no contiene ninguna hoja reconocida ("Administrativo" o "Comercial").');
  }

  const hojasPresentes = new Set<HojaUsuario>();
  const filas: FilaImportUsuario[] = [];
  if (wsAdmin) { hojasPresentes.add('Administrativo'); filas.push(...parseHojaPersona(wsAdmin, 'Administrativo')); }
  if (wsComercial) { hojasPresentes.add('Comercial'); filas.push(...parseHojaPersona(wsComercial, 'Comercial')); }

  return { filas, hojasPresentes };
};
