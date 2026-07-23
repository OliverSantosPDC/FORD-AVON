import readline from 'readline';
import { getSupabaseClient } from '../config/supabaseClient';
import { SUPABASE_CARTERA_TABLE, SUPABASE_URL } from '../config/env';

/**
 * Limpieza segura de la tabla `cartera` en Supabase.
 *
 * - Pide confirmación explícita (escribir CONFIRMAR) antes de borrar.
 * - Elimina TODOS los registros por lotes usando `.delete().in('codigo', [...])`,
 *   compatible con la versión actual de @supabase/supabase-js.
 * - NO usa `.delete().neq(...)` ni `.delete().not(...)` (que provocaban
 *   "Invalid path specified in request URL").
 * - Verifica que la tabla quede en 0 registros.
 * - Nunca imprime la Service Role Key.
 *
 * Uso: node dist/scripts/clearCartera.js
 */

const BATCH_READ = 500;

const countRows = async (): Promise<number> => {
  const client = getSupabaseClient();
  const { count, error } = await client
    .from(SUPABASE_CARTERA_TABLE)
    .select('*', { count: 'exact', head: true });

  if (error) {
    throw new Error(`No se pudo contar las filas de "${SUPABASE_CARTERA_TABLE}": ${error.message}`);
  }

  return count ?? 0;
};

const askConfirmation = (question: string): Promise<string> => {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
};

const deleteAllRows = async (): Promise<number> => {
  const client = getSupabaseClient();
  let deleted = 0;

  // Se leen los códigos por páginas y se eliminan por conjuntos con `.in()`.
  // Como cada iteración borra lo que leyó, la tabla se va reduciendo hasta 0.
  for (;;) {
    const { data, error: readError } = await client
      .from(SUPABASE_CARTERA_TABLE)
      .select('codigo')
      .limit(BATCH_READ);

    if (readError) {
      throw new Error(`No se pudieron leer códigos para limpiar la tabla: ${readError.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    const codigos = data
      .map((row) => (row as { codigo: unknown }).codigo)
      .filter((codigo): codigo is string | number => codigo !== null && codigo !== undefined);

    if (codigos.length === 0) {
      // Quedan filas sin `codigo`; no se pueden borrar por esta vía.
      break;
    }

    const { error: deleteError } = await client.from(SUPABASE_CARTERA_TABLE).delete().in('codigo', codigos);

    if (deleteError) {
      throw new Error(`No se pudo eliminar el lote de registros: ${deleteError.message}`);
    }

    deleted += codigos.length;
    console.log(`  Eliminados ${deleted} registro(s)...`);
  }

  return deleted;
};

const main = async (): Promise<void> => {
  console.log('=== Limpieza de la tabla "cartera" en Supabase ===');
  console.log(`SUPABASE_URL normalizada : ${SUPABASE_URL}`);
  console.log(`Tabla objetivo           : ${SUPABASE_CARTERA_TABLE}`);
  console.log('');

  const before = await countRows();
  console.log(`Registros actuales: ${before}`);

  if (before === 0) {
    console.log('La tabla ya está vacía. No hay nada que eliminar.');
    return;
  }

  const answer = await askConfirmation(
    'Esta acción eliminará TODOS los registros de la tabla cartera. Escriba CONFIRMAR para continuar: '
  );

  if (answer.trim() !== 'CONFIRMAR') {
    console.log('Operación cancelada. No se eliminó ningún registro.');
    return;
  }

  console.log('');
  console.log('Eliminando registros...');
  const deleted = await deleteAllRows();

  const after = await countRows();

  console.log('');
  console.log('=== Resultado ===');
  console.log(`Registros eliminados : ${deleted}`);
  console.log(`Conteo final de la tabla: ${after}`);

  if (after === 0) {
    console.log('La tabla "cartera" quedó vacía correctamente.');
  } else {
    console.warn(
      `ADVERTENCIA: la tabla aún tiene ${after} registro(s). ` +
        'Es posible que existan filas sin valor en "codigo".'
    );
    process.exitCode = 1;
  }
};

main().catch((err) => {
  console.error('');
  console.error('ERROR EN LA LIMPIEZA:');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
