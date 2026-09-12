import ExcelJS from 'exceljs';

/**
 * Plantilla y parseo de la carga masiva de USUARIOS + GRUPOS Y NIVELES
 * (módulo Repositorio). Reutiliza ExcelJS (ya usado por la importación de
 * cartera). Estructura NORMALIZADA en hojas separadas (en vez de columnas con
 * varios valores separados por ";"): evita ambigüedad, especialmente en
 * País-Zona, que SIEMPRE se trata como PAR (nunca como dos listas
 * independientes — ver ScopeService/ScopeFilter, `paisZonaGrant`/`paisZonaPairs`).
 *
 * Hojas:
 *   USUARIOS              — ACCION, EMAIL, NOMBRE, APELLIDO, ROL, NIVEL (informativo),
 *                            NOMBRE_CARTERA (solo gestor), ACTIVO
 *   LIDERAZGO_SUPERVISOR   — LIDERAZGO_EMAIL, SUPERVISOR_EMAIL
 *   SUPERVISOR_GESTOR      — SUPERVISOR_EMAIL, GESTOR_EMAIL
 *   SUPERVISOR_GERENTE     — SUPERVISOR_EMAIL, GERENTE_ZONA_EMAIL
 *   GESTOR_PAIS_ZONA       — GESTOR_EMAIL, ID_PAIS_ZONA, PAIS, ZONA        (narrowing opcional)
 *   GERENTE_PAIS_ZONA      — GERENTE_ZONA_EMAIL, ID_PAIS_ZONA, PAIS, ZONA  (alcance del gerente)
 *   PAIS_ZONA              — ID_PAIS_ZONA, PAIS, ZONA (catálogo de referencia, generado desde
 *                            cartera real; solo lectura, no se procesa como datos a importar)
 *   INSTRUCCIONES          — guía (no se procesa)
 *
 * ID_PAIS_ZONA (Sección 4-8): llave estable "CODIGO_PAIS-ZONA" (ej. "GT-107")
 * que identifica sin ambigüedad un par País+Zona, incluso cuando el mismo
 * número de Zona se repite en países distintos (ej. Zona 107 existe en
 * GUATEMALA y en REPUBLICA DOMINICANA). Es el campo PRINCIPAL para asignar
 * territorio a Gestores/Gerentes de zona; PAIS y ZONA se conservan como
 * columnas informativas/alternativas (compatibilidad con archivos previos:
 * si ID_PAIS_ZONA se deja vacío, PAIS+ZONA se siguen validando tal cual).
 *
 * No incluye una hoja ZONA_SECTOR: Sector es un dato de `cartera`, no una
 * relación de alcance en ScopeService/applyScope (que no tiene dimensión de
 * sector). No se inventa una tabla/relación que no existe en el modelo real.
 */

export const SHEET_USUARIOS = 'USUARIOS';
export const SHEET_LIDERAZGO_SUPERVISOR = 'LIDERAZGO_SUPERVISOR';
export const SHEET_SUPERVISOR_GESTOR = 'SUPERVISOR_GESTOR';
export const SHEET_SUPERVISOR_GERENTE = 'SUPERVISOR_GERENTE';
export const SHEET_GESTOR_PAIS_ZONA = 'GESTOR_PAIS_ZONA';
export const SHEET_GERENTE_PAIS_ZONA = 'GERENTE_PAIS_ZONA';
export const SHEET_PAIS_ZONA = 'PAIS_ZONA';

/** Código corto de País para construir el ID_PAIS_ZONA (ej. "GT-107"). Cubre
 *  los países reales de la cartera actual; un país no listado deriva un
 *  código de sus iniciales, así que la función nunca falla ni inventa Zonas. */
const PAIS_CODIGO: Record<string, string> = {
  GUATEMALA: 'GT',
  'EL SALVADOR': 'SV',
  HONDURAS: 'HN',
  NICARAGUA: 'NI',
  PANAMA: 'PA',
  'REPUBLICA DOMINICANA': 'RD'
};

const codigoPais = (pais: string): string => {
  const key = pais.trim().toUpperCase();
  if (PAIS_CODIGO[key]) return PAIS_CODIGO[key];
  const palabras = key.split(/\s+/).filter(Boolean);
  return (palabras.length > 1 ? palabras.map((p) => p[0]).join('') : key).slice(0, 3);
};

/** Construye el ID_PAIS_ZONA estable para un par País+Zona real (Sección 4). */
export const idPaisZonaDe = (pais: string, zona: string): string => `${codigoPais(pais)}-${zona.trim()}`;

export interface FilaUsuarioImport {
  hoja: typeof SHEET_USUARIOS;
  fila: number;
  accion: string;
  email: string;
  nombre: string;
  apellido: string;
  rol: string;
  nivel: string;
  nombreCartera: string;
  activo: string;
}

export interface FilaRelacionImport {
  hoja: string;
  fila: number;
  /** Columna "propietaria" de la relación (LIDERAZGO_EMAIL, SUPERVISOR_EMAIL, etc.). */
  propietario: string;
  /** Columna del relacionado (SUPERVISOR_EMAIL, GESTOR_EMAIL, GERENTE_ZONA_EMAIL). */
  relacionado: string;
}

export interface FilaPaisZonaImport {
  hoja: string;
  fila: number;
  email: string;
  /** Llave "CODIGO_PAIS-ZONA" opcional (ej. "GT-107"); si viene, es la fuente
   *  principal y PAIS/ZONA se resuelven a partir de ella (Sección 5/6). */
  idPaisZona: string;
  pais: string;
  zona: string;
  /** true si ID_PAIS_ZONA venía con valor pero no existe en el catálogo real
   *  (Sección 8): se calcula al resolver, antes de validar. */
  idPaisZonaInvalido?: boolean;
}

export interface ParsedWorkbook {
  usuarios: FilaUsuarioImport[];
  liderazgoSupervisor: FilaRelacionImport[];
  supervisorGestor: FilaRelacionImport[];
  supervisorGerente: FilaRelacionImport[];
  gestorPaisZona: FilaPaisZonaImport[];
  gerentePaisZona: FilaPaisZonaImport[];
  /** Qué hojas de relación estaban PRESENTES en el archivo (aunque vacías):
   *  determina si ese tipo de relación se sincroniza o se deja intacto. */
  hojasPresentes: Set<string>;
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

/** Genera la plantilla oficial .xlsx: hojas normalizadas + ejemplos + instrucciones.
 *  Los ejemplos son claramente ficticios (dominio ejemplo.com, nombres genéricos).
 *  `paisZonaCatalogo` es el catálogo REAL de pares País-Zona vigentes en cartera
 *  (Sección 7: nunca se escribe una lista fija a mano) — lo obtiene el llamador
 *  vía `obtenerCatalogos().carteraPaisZona` para no acoplar este util a Supabase. */
export const generarPlantilla = async (
  paisZonaCatalogo: Array<{ pais: string; zona: string }>
): Promise<Buffer> => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FORD-AVON';

  const paisZonaOrdenado = paisZonaCatalogo
    .slice()
    .sort((a, b) => a.pais.localeCompare(b.pais, 'es') || a.zona.localeCompare(b.zona, 'es', { numeric: true }))
    .map((pz) => ({ id: idPaisZonaDe(pz.pais, pz.zona), pais: pz.pais, zona: pz.zona }));

  const usuarios = wb.addWorksheet(SHEET_USUARIOS);
  usuarios.columns = [
    { header: 'ACCION', key: 'accion', width: 14 },
    { header: 'EMAIL', key: 'email', width: 30 },
    { header: 'NOMBRE', key: 'nombre', width: 16 },
    { header: 'APELLIDO', key: 'apellido', width: 16 },
    { header: 'ROL', key: 'rol', width: 16 },
    { header: 'NIVEL', key: 'nivel', width: 8 },
    { header: 'NOMBRE_CARTERA', key: 'nombreCartera', width: 26 },
    { header: 'ACTIVO', key: 'activo', width: 10 }
  ];
  usuarios.getRow(1).font = { bold: true };
  usuarios.addRow(['CREAR', 'admin.ejemplo@ejemplo.com', 'Admin', 'Ejemplo', 'administrador', 1, '', 'SI']);
  usuarios.addRow(['CREAR', 'liderazgo.ejemplo@ejemplo.com', 'Liderazgo', 'Ejemplo', 'liderazgo', 2, '', 'SI']);
  usuarios.addRow(['CREAR', 'supervisor1.ejemplo@ejemplo.com', 'Supervisor Uno', 'Ejemplo', 'supervisor', 3, '', 'SI']);
  usuarios.addRow(['CREAR', 'supervisor2.ejemplo@ejemplo.com', 'Supervisor Dos', 'Ejemplo', 'supervisor', 3, '', 'SI']);
  usuarios.addRow(['CREAR', 'gestor1.ejemplo@ejemplo.com', 'Gestor Uno', 'Ejemplo', 'gestor', 4, 'GESTOR EJEMPLO 01', 'SI']);
  usuarios.addRow(['CREAR', 'gestor2.ejemplo@ejemplo.com', 'Gestor Dos', 'Ejemplo', 'gestor', 4, 'GESTOR EJEMPLO 02', 'SI']);
  usuarios.addRow(['CREAR', 'gerente1.ejemplo@ejemplo.com', 'Gerente Uno', 'Ejemplo', 'gerente_zona', 5, '', 'SI']);
  usuarios.addRow(['ACTUALIZAR', 'gestor1.ejemplo@ejemplo.com', 'Gestor Uno', 'Ejemplo', 'gestor', 4, 'GESTOR EJEMPLO 01', 'SI']);
  usuarios.addRow(['DESACTIVAR', 'gestor2.ejemplo@ejemplo.com', '', '', '', '', '', 'NO']);

  const liderSup = wb.addWorksheet(SHEET_LIDERAZGO_SUPERVISOR);
  liderSup.columns = [{ header: 'LIDERAZGO_EMAIL', key: 'liderazgo', width: 32 }, { header: 'SUPERVISOR_EMAIL', key: 'supervisor', width: 32 }];
  liderSup.getRow(1).font = { bold: true };
  liderSup.addRow(['liderazgo.ejemplo@ejemplo.com', 'supervisor1.ejemplo@ejemplo.com']);
  liderSup.addRow(['liderazgo.ejemplo@ejemplo.com', 'supervisor2.ejemplo@ejemplo.com']);

  const supGes = wb.addWorksheet(SHEET_SUPERVISOR_GESTOR);
  supGes.columns = [{ header: 'SUPERVISOR_EMAIL', key: 'supervisor', width: 32 }, { header: 'GESTOR_EMAIL', key: 'gestor', width: 32 }];
  supGes.getRow(1).font = { bold: true };
  supGes.addRow(['supervisor1.ejemplo@ejemplo.com', 'gestor1.ejemplo@ejemplo.com']);
  supGes.addRow(['supervisor1.ejemplo@ejemplo.com', 'gestor2.ejemplo@ejemplo.com']);

  const supGer = wb.addWorksheet(SHEET_SUPERVISOR_GERENTE);
  supGer.columns = [{ header: 'SUPERVISOR_EMAIL', key: 'supervisor', width: 32 }, { header: 'GERENTE_ZONA_EMAIL', key: 'gerente', width: 32 }];
  supGer.getRow(1).font = { bold: true };
  supGer.addRow(['supervisor2.ejemplo@ejemplo.com', 'gerente1.ejemplo@ejemplo.com']);

  // PAIS_ZONA: catálogo de referencia REAL (Sección 4/7), usado como fuente de
  // la lista desplegable de ID_PAIS_ZONA en GESTOR_PAIS_ZONA/GERENTE_PAIS_ZONA.
  const paisZona = wb.addWorksheet(SHEET_PAIS_ZONA);
  paisZona.columns = [
    { header: 'ID_PAIS_ZONA', key: 'id', width: 16 },
    { header: 'PAIS', key: 'pais', width: 24 },
    { header: 'ZONA', key: 'zona', width: 12 }
  ];
  paisZona.getRow(1).font = { bold: true };
  paisZonaOrdenado.forEach((pz) => paisZona.addRow([pz.id, pz.pais, pz.zona]));
  const idPaisZonaRango = paisZonaOrdenado.length > 0 ? `PAIS_ZONA!$A$2:$A$${paisZonaOrdenado.length + 1}` : undefined;

  const ejemploIdA = paisZonaOrdenado[0]?.id ?? '';
  const ejemploIdB = paisZonaOrdenado[1]?.id ?? '';
  const ejemploIdC = paisZonaOrdenado.find((pz) => pz.pais.toUpperCase() === 'REPUBLICA DOMINICANA')?.id
    ?? paisZonaOrdenado[2]?.id ?? '';

  const gesPz = wb.addWorksheet(SHEET_GESTOR_PAIS_ZONA);
  gesPz.columns = [
    { header: 'GESTOR_EMAIL', key: 'gestor', width: 32 },
    { header: 'ID_PAIS_ZONA', key: 'idPaisZona', width: 16 },
    { header: 'PAIS', key: 'pais', width: 22 },
    { header: 'ZONA', key: 'zona', width: 12 }
  ];
  gesPz.getRow(1).font = { bold: true };
  // Ejemplo preferido: usando ID_PAIS_ZONA (PAIS/ZONA quedan en blanco, se resuelven solos).
  gesPz.addRow(['gestor1.ejemplo@ejemplo.com', ejemploIdA, '', '']);
  gesPz.addRow(['gestor1.ejemplo@ejemplo.com', ejemploIdB, '', '']);
  // Ejemplo de compatibilidad: sin ID_PAIS_ZONA, escribiendo PAIS/ZONA directamente (sigue funcionando).
  if (paisZonaOrdenado[2]) gesPz.addRow(['gestor2.ejemplo@ejemplo.com', '', paisZonaOrdenado[2].pais, paisZonaOrdenado[2].zona]);

  const gerPz = wb.addWorksheet(SHEET_GERENTE_PAIS_ZONA);
  gerPz.columns = [
    { header: 'GERENTE_ZONA_EMAIL', key: 'gerente', width: 32 },
    { header: 'ID_PAIS_ZONA', key: 'idPaisZona', width: 16 },
    { header: 'PAIS', key: 'pais', width: 22 },
    { header: 'ZONA', key: 'zona', width: 12 }
  ];
  gerPz.getRow(1).font = { bold: true };
  gerPz.addRow(['gerente1.ejemplo@ejemplo.com', ejemploIdA, '', '']);
  if (ejemploIdC) gerPz.addRow(['gerente1.ejemplo@ejemplo.com', ejemploIdC, '', '']);

  // Lista desplegable de ID_PAIS_ZONA (Sección 11) apuntando al catálogo real de PAIS_ZONA.
  if (idPaisZonaRango) {
    [gesPz, gerPz].forEach((ws) => {
      for (let r = 2; r <= 500; r += 1) {
        ws.getCell(`B${r}`).dataValidation = {
          type: 'list', allowBlank: true, formulae: [idPaisZonaRango],
          showErrorMessage: true, errorTitle: 'ID_PAIS_ZONA no válido',
          error: 'Selecciona un valor de la lista (hoja PAIS_ZONA) o deja la columna en blanco y usa PAIS/ZONA.'
        };
      }
    });
  }

  const help = wb.addWorksheet('INSTRUCCIONES');
  help.columns = [{ header: 'Campo / Hoja', key: 'campo', width: 26 }, { header: 'Descripción', key: 'desc', width: 100 }];
  help.getRow(1).font = { bold: true };
  const rows: Array<[string, string]> = [
    ['USUARIOS.ACCION', 'CREAR | ACTUALIZAR | ACTIVAR | DESACTIVAR'],
    ['USUARIOS.EMAIL', 'Identificador único del usuario. Obligatorio. Se compara sin distinguir mayúsculas.'],
    ['USUARIOS.NOMBRE / APELLIDO', 'Obligatorios al CREAR.'],
    ['USUARIOS.ROL', 'administrador | liderazgo | supervisor | gestor | gerente_zona'],
    ['USUARIOS.NIVEL', 'Informativo (se valida contra el ROL, no se guarda por separado): 1=Administrador, 2=Liderazgo, 3=Supervisor, 4=Gestor, 5=Gerente de zona.'],
    ['USUARIOS.NOMBRE_CARTERA', 'Solo para ROL=gestor: 1 valor que debe existir en cartera.gestor (vincula al gestor con su cartera real). No aplica a otros roles.'],
    ['USUARIOS.ACTIVO', 'SI | NO'],
    ['LIDERAZGO_SUPERVISOR', 'Un renglón por cada Supervisor asignado a un Liderazgo (Nivel 2 -> Nivel 3). Varios renglones = varios Supervisores.'],
    ['SUPERVISOR_GESTOR', 'Un renglón por cada Gestor asignado a un Supervisor (Nivel 3 -> Nivel 4). Varios renglones = varios Gestores.'],
    ['SUPERVISOR_GERENTE', 'Un renglón por cada Gerente de zona asignado a un Supervisor (Nivel 3 -> Nivel 5). Varios renglones = varios Gerentes.'],
    ['GESTOR_PAIS_ZONA', 'Opcional. Restringe ADICIONALMENTE el alcance de un Gestor a País-Zona exactos (si se omite, el gestor conserva su alcance actual por NOMBRE_CARTERA). Un renglón por CADA PAR País-Zona.'],
    ['GERENTE_PAIS_ZONA', 'Obligatorio para que un Gerente de zona tenga alcance real. Un renglón por CADA PAR País-Zona.'],
    ['ID_PAIS_ZONA (RECOMENDADO)', 'Para asignar País-Zona a Gestores o Gerentes de zona utilice el ID_PAIS_ZONA de la hoja PAIS_ZONA (ej. "GT-107"), eligiéndolo de la lista desplegable de esa columna. Si se usa ID_PAIS_ZONA, las columnas PAIS/ZONA de esa fila pueden dejarse en blanco: se completan solas al validar.'],
    ['PAIS / ZONA (compatibilidad)', 'Alternativa a ID_PAIS_ZONA: escribir PAIS y ZONA directamente (formato de archivos anteriores, sigue funcionando). Siempre se leen como PAR en la MISMA fila, nunca como dos listas independientes: "GUATEMALA,107" y "REPUBLICA DOMINICANA,107" son DOS asignaciones distintas, aunque compartan el número de Zona.'],
    ['PAIS_ZONA', 'Hoja de referencia (no se importa): catálogo de todos los pares País-Zona vigentes en cartera al momento de descargar la plantilla, con su ID_PAIS_ZONA. Úsela para copiar el ID correcto o elegirlo desde la lista desplegable en GESTOR_PAIS_ZONA/GERENTE_PAIS_ZONA.'],
    ['Sincronización', 'Si un usuario aparece en USUARIOS (creado o actualizado), sus relaciones de alcance se SINCRONIZAN por completo con lo indicado en las hojas de relación: lo que no aparece en el archivo para ese usuario se elimina/desactiva. Si una hoja de relación completa no existe en el archivo, ese tipo de relación no se modifica para nadie.'],
    ['Alcance', 'No usar ASIGNACION para definir alcance: las relaciones de estas hojas alimentan directamente a Usuarios/Grupos y Niveles/ScopeService. La cartera solo se usa para validar que País/Zona/Gestor existan realmente.'],
    ['Validación', 'El archivo se valida por completo antes de tocar Supabase. Si hay errores, se listan (hoja, fila, columna, valor, motivo) y no se aplica nada hasta corregirlos (o usar "Procesar solo válidas" para aplicar únicamente las filas correctas).']
  ];
  rows.forEach((r) => help.addRow(r));
  help.getColumn('desc').alignment = { wrapText: true, vertical: 'top' };

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
};

const headerIndex = (ws: ExcelJS.Worksheet): Record<string, number> => {
  const index: Record<string, number> = {};
  ws.getRow(1).eachCell((cell, colNumber) => {
    const key = cellText(cell.value).trim().toUpperCase().replace(/\s+/g, '_');
    if (key) index[key] = colNumber;
  });
  return index;
};

const getCell = (ws: ExcelJS.Worksheet, index: Record<string, number>, row: ExcelJS.Row, col: string): string => {
  const c = index[col];
  return c ? cellText(row.getCell(c).value).trim() : '';
};

/** Parsea una hoja de relación simple (propietario, relacionado) en formato largo (1 fila = 1 par). */
const parseRelacionSheet = (wb: ExcelJS.Workbook, sheetName: string, colPropietario: string, colRelacionado: string): FilaRelacionImport[] => {
  const ws = wb.getWorksheet(sheetName);
  if (!ws) return [];
  const index = headerIndex(ws);
  const out: FilaRelacionImport[] = [];
  for (let r = 2; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const propietario = getCell(ws, index, row, colPropietario);
    const relacionado = getCell(ws, index, row, colRelacionado);
    if (!propietario && !relacionado) continue;
    out.push({ hoja: sheetName, fila: r, propietario, relacionado });
  }
  return out;
};

const parsePaisZonaSheet = (wb: ExcelJS.Workbook, sheetName: string, colEmail: string): FilaPaisZonaImport[] => {
  const ws = wb.getWorksheet(sheetName);
  if (!ws) return [];
  const index = headerIndex(ws);
  const out: FilaPaisZonaImport[] = [];
  for (let r = 2; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const email = getCell(ws, index, row, colEmail);
    const idPaisZona = getCell(ws, index, row, 'ID_PAIS_ZONA');
    const pais = getCell(ws, index, row, 'PAIS');
    const zona = getCell(ws, index, row, 'ZONA');
    if (!email && !idPaisZona && !pais && !zona) continue;
    out.push({ hoja: sheetName, fila: r, email, idPaisZona, pais, zona });
  }
  return out;
};

/** Parsea el archivo subido completo (todas las hojas normalizadas). */
export const parsearWorkbook = async (buffer: Buffer): Promise<ParsedWorkbook> => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const wsUsuarios = wb.getWorksheet(SHEET_USUARIOS);
  if (!wsUsuarios) throw new Error(`El archivo no contiene la hoja obligatoria "${SHEET_USUARIOS}".`);
  const index = headerIndex(wsUsuarios);
  const usuarios: FilaUsuarioImport[] = [];
  for (let r = 2; r <= wsUsuarios.rowCount; r += 1) {
    const row = wsUsuarios.getRow(r);
    const accion = getCell(wsUsuarios, index, row, 'ACCION').toUpperCase();
    const email = getCell(wsUsuarios, index, row, 'EMAIL');
    if (!accion && !email && !getCell(wsUsuarios, index, row, 'NOMBRE')) continue;
    usuarios.push({
      hoja: SHEET_USUARIOS,
      fila: r,
      accion,
      email,
      nombre: getCell(wsUsuarios, index, row, 'NOMBRE'),
      apellido: getCell(wsUsuarios, index, row, 'APELLIDO'),
      rol: getCell(wsUsuarios, index, row, 'ROL').toLowerCase(),
      nivel: getCell(wsUsuarios, index, row, 'NIVEL'),
      nombreCartera: getCell(wsUsuarios, index, row, 'NOMBRE_CARTERA'),
      activo: getCell(wsUsuarios, index, row, 'ACTIVO').toUpperCase()
    });
  }

  const hojasPresentes = new Set<string>();
  [SHEET_LIDERAZGO_SUPERVISOR, SHEET_SUPERVISOR_GESTOR, SHEET_SUPERVISOR_GERENTE, SHEET_GESTOR_PAIS_ZONA, SHEET_GERENTE_PAIS_ZONA]
    .forEach((s) => { if (wb.getWorksheet(s)) hojasPresentes.add(s); });

  return {
    usuarios,
    liderazgoSupervisor: parseRelacionSheet(wb, SHEET_LIDERAZGO_SUPERVISOR, 'LIDERAZGO_EMAIL', 'SUPERVISOR_EMAIL'),
    supervisorGestor: parseRelacionSheet(wb, SHEET_SUPERVISOR_GESTOR, 'SUPERVISOR_EMAIL', 'GESTOR_EMAIL'),
    supervisorGerente: parseRelacionSheet(wb, SHEET_SUPERVISOR_GERENTE, 'SUPERVISOR_EMAIL', 'GERENTE_ZONA_EMAIL'),
    gestorPaisZona: parsePaisZonaSheet(wb, SHEET_GESTOR_PAIS_ZONA, 'GESTOR_EMAIL'),
    gerentePaisZona: parsePaisZonaSheet(wb, SHEET_GERENTE_PAIS_ZONA, 'GERENTE_ZONA_EMAIL'),
    hojasPresentes
  };
};
