import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

/**
 * OnePage del Dashboard: es una CAPTURA (equivalente a un "full page screenshot") del
 * Dashboard tal como está renderizado en este momento — filtros, moneda, datos, tamaños
 * y scroll interno de cada componente exactamente como se ven. No reconstruye nada ni
 * reorganiza componentes: el PDF es simplemente esa misma captura larga, cortada en
 * páginas consecutivas (como si se hubiera hecho scroll y se hubiera seguido capturando).
 *
 * Flujo: Dashboard real → clon de exportación (`createExportSnapshot`) → Preview (mismo
 * clon, mostrado en un diálogo con scroll) → PDF (`renderSnapshotToPdf`, capturado del
 * MISMO clon que el usuario revisó). El Dashboard real nunca se modifica.
 *
 * IMPORTANTE: esta captura NO expande contenedores con scroll interno (tablas con
 * `overflow`/`maxHeight`, listas, etc.). Cada componente conserva exactamente su alto,
 * ancho y scroll actuales — si una tabla muestra 10 de 50 filas por tener scroll propio,
 * el PDF la muestra igual, con esas mismas 10 filas visibles. Fidelidad visual al
 * Dashboard real tiene prioridad sobre exponer datos que hoy están ocultos por scroll.
 */

/** Recharts/SVG: html2canvas no siempre rasteriza correctamente un <svg> vivo (gradientes,
 *  texto, clip-path). La técnica confiable (misma usada por utils/chartExport.ts para
 *  "Exportar PNG") es serializar el SVG real a data URL y dejar que el propio navegador
 *  lo decodifique como imagen; luego html2canvas solo necesita pintar un <img> ya
 *  decodificado, sin reinterpretar el SVG. No se reconstruye ni se sustituye el gráfico,
 *  no se cambian dimensiones/escalas/leyendas: es el mismo SVG, servido como imagen para
 *  una captura fiel. */
const serializeSvgToDataUrl = (svg: SVGSVGElement): string => {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(clone);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
};

/** Reemplaza cada <svg> del snapshot por un <img> con el mismo SVG serializado como
 *  fuente, del mismo ancho/alto ya medido (Recharts fija width/height reales en el SVG
 *  al montar) — no se altera ningún tamaño. Devuelve la promesa de que todas las
 *  imágenes terminaron de decodificar, para no capturar un gráfico a medio pintar. */
const replaceSvgsWithImages = (root: HTMLElement): Promise<void>[] => {
  const svgs = Array.from(root.querySelectorAll<SVGSVGElement>('svg'));
  return svgs.map((svg) => {
    const rect = svg.getBoundingClientRect();
    const width = rect.width || Number(svg.getAttribute('width')) || 0;
    const height = rect.height || Number(svg.getAttribute('height')) || 0;
    const img = document.createElement('img');
    img.src = serializeSvgToDataUrl(svg);
    img.style.width = `${width}px`;
    img.style.height = `${height}px`;
    img.style.display = 'block';
    svg.replaceWith(img);
    return new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
    });
  });
};

/** Oculta tooltips flotantes de Recharts (hover) que no forman parte permanente de la
 *  vista: si el cursor estaba sobre un gráfico al momento de clonar, el tooltip vivo se
 *  clona también; se fuerza su ocultamiento para que el PDF no muestre un tooltip
 *  "congelado" que no corresponde a una interacción real del usuario. Esto no cambia
 *  tamaños ni layout, solo visibilidad de un overlay transitorio. */
const hideTransientTooltips = (root: HTMLElement) => {
  root.querySelectorAll<HTMLElement>('.recharts-tooltip-wrapper, .recharts-tooltip-cursor').forEach((el) => {
    el.style.display = 'none';
  });
};

/** Elimina del clon los elementos marcados para excluir del reporte (ej. el propio
 *  botón "Generar OnePage"), para que ni el preview ni el PDF los muestren. */
const removeSkippedElements = (root: HTMLElement) => {
  root.querySelectorAll<HTMLElement>('[data-onepage-skip="true"]').forEach((el) => el.remove());
};

const waitForLayout = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

export interface ExportSnapshot {
  /** Contenedor a insertar en el preview (ancho fijo = ancho real del Dashboard al
   *  momento de generar, para que nada reflowee de forma distinta al original). */
  container: HTMLElement;
  /** El mismo nodo, ya clonado/preparado (SVG→imagen, sin botón OnePage). Preview y PDF
   *  capturan este único nodo tal cual — ningún contenedor con scroll interno se toca:
   *  cada tabla/lista conserva exactamente su alto y sus filas visibles actuales. */
  root: HTMLElement;
}

/**
 * Crea el clon de exportación a partir del Dashboard real ya renderizado. No modifica
 * el DOM real en ningún momento: todo el trabajo ocurre sobre `root.cloneNode(true)`.
 * No expande ningún contenedor con scroll interno — el clon conserva el mismo `overflow`,
 * `maxHeight` y filas visibles que el Dashboard real en este instante.
 *
 * La medición de los SVG (getBoundingClientRect) solo devuelve valores reales si el nodo
 * está adjunto al documento y "layouteado" — en un nodo desconectado valdría 0. Por eso
 * el clon se adjunta temporalmente fuera de pantalla (position:fixed, left muy negativo)
 * mientras se preparan los SVG, y se desconecta antes de devolver el snapshot.
 */
export const createExportSnapshot = async (root: HTMLElement): Promise<ExportSnapshot> => {
  const width = root.getBoundingClientRect().width;
  const clone = root.cloneNode(true) as HTMLElement;

  const container = document.createElement('div');
  container.style.width = `${Math.max(width, 1)}px`;
  container.style.position = 'fixed';
  container.style.top = '0';
  container.style.left = '-100000px';
  container.appendChild(clone);
  document.body.appendChild(container);

  try {
    removeSkippedElements(clone);
    hideTransientTooltips(clone);

    const imagesLoaded = replaceSvgsWithImages(clone);
    await Promise.all(imagesLoaded);
    await waitForLayout();
  } finally {
    document.body.removeChild(container);
    container.style.position = '';
    container.style.top = '';
    container.style.left = '';
  }

  return { container, root: clone };
};

/**
 * Detecta los bloques visuales principales del Dashboard capturado: cada tarjeta real
 * (`.MuiPaper-root`, y `.MuiAlert-root` para el aviso de tasa no disponible), tomando solo
 * la más externa cuando una contiene a otra (evita contar dos veces una tarjeta con un
 * Paper anidado). No depende de ningún nombre de componente ni de esta versión concreta
 * del Dashboard: es puramente estructural (la misma clase que usa cada tarjeta real, sea
 * cual sea su contenido). Como respaldo genérico, cualquier hijo directo de `root` que no
 * contenga ninguna tarjeta detectada se agrega completo como su propio bloque (cubre filas
 * que no usan Paper, como la barra de filtros).
 */
const collectLayoutBlocks = (root: HTMLElement): HTMLElement[] => {
  const cards = Array.from(root.querySelectorAll<HTMLElement>('.MuiPaper-root, .MuiAlert-root'));
  const topCards = cards.filter((el) => !cards.some((other) => other !== el && other.contains(el)));

  const blocks: HTMLElement[] = [...topCards];
  Array.from(root.children).forEach((child) => {
    if (!(child instanceof HTMLElement)) return;
    const alreadyCovered = topCards.some((card) => child.contains(card));
    if (!alreadyCovered) blocks.push(child);
  });
  return blocks;
};

interface Band { top: number; bottom: number; }

/** Mide el `top`/`bottom` real (relativo a `root`) de cada bloque y fusiona los que se
 *  solapan verticalmente (tarjetas de una misma fila del grid) en una sola banda: una
 *  banda es la unidad mínima que nunca debe partirse entre dos páginas. */
const computeBands = (root: HTMLElement, blocks: HTMLElement[]): Band[] => {
  const rootTop = root.getBoundingClientRect().top;
  const raw = blocks
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top - rootTop, bottom: r.bottom - rootTop };
    })
    .filter((b) => b.bottom > b.top)
    .sort((a, b) => a.top - b.top);

  const merged: Band[] = [];
  for (const b of raw) {
    const last = merged[merged.length - 1];
    if (last && b.top <= last.bottom) last.bottom = Math.max(last.bottom, b.bottom);
    else merged.push({ ...b });
  }
  return merged;
};

/** Empaqueta las bandas (ya en píxeles del canvas capturado) en páginas: agrega bandas
 *  completas a la página actual mientras quepan en `sliceHeightPx`; si la siguiente banda
 *  no cabe completa, la página termina donde acabó la última banda que sí cabía y esa
 *  banda empieza en la página siguiente. Una banda por sí sola más alta que una página
 *  completa (caso límite) se acepta igual como único segmento de esa página — el corte
 *  forzado dentro de ella se resuelve después, por tramos de tamaño uniforme, ya que no
 *  existe forma de mantenerla completa en ninguna página. */
const paginateBands = (bands: Band[], canvasHeight: number, sliceHeightPx: number): Array<[number, number]> => {
  const pages: Array<[number, number]> = [];
  let cursor = 0;
  let idx = 0;
  while (cursor < canvasHeight) {
    let pageEnd = cursor;
    let addedAny = false;
    while (idx < bands.length) {
      const band = bands[idx];
      if (band.bottom <= cursor) { idx += 1; continue; }
      const wouldEnd = Math.min(band.bottom, canvasHeight);
      if (!addedAny || wouldEnd - cursor <= sliceHeightPx) {
        pageEnd = wouldEnd;
        addedAny = true;
        idx += 1;
        if (wouldEnd - cursor >= sliceHeightPx) break;
      } else {
        break;
      }
    }
    if (!addedAny) pageEnd = canvasHeight;
    pages.push([cursor, pageEnd]);
    cursor = pageEnd;
  }
  return pages;
};

/**
 * Genera el PDF a partir del MISMO snapshot que se mostró en el preview (mismo render
 * para preview y PDF, sin reconstruir nada). El snapshot debe estar insertado en el
 * documento (aunque sea en un contenedor oculto) para que html2canvas pueda medir/pintar
 * su layout.
 *
 * Técnica: una única captura larga de todo `snapshot.root` (equivalente a un "full page
 * screenshot"). No se captura componente por componente: se captura UNA sola vez, y
 * después se decide dónde cortarla en páginas usando los límites reales (bounding boxes)
 * de las tarjetas del Dashboard, medidos en el DOM antes de aplanar a imagen — nunca
 * coordenadas fijas ni nombres de componentes. Cada página agrupa tarjetas completas; si
 * la siguiente tarjeta no cabe entera en el espacio restante, empieza completa en la
 * página siguiente. Solo si una tarjeta por sí sola excede el alto de una página completa
 * se corta (no hay otra forma de mantenerla entera en ninguna página).
 */
export const renderSnapshotToPdf = async (snapshot: ExportSnapshot, filenamePrefix = 'FORD-AVON_Dashboard_OnePage'): Promise<void> => {
  const rootWidth = snapshot.root.getBoundingClientRect().width;
  const blocks = collectLayoutBlocks(snapshot.root);
  const bands = computeBands(snapshot.root, blocks);

  const canvas = await html2canvas(snapshot.root, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidthMm = 297;
  const pageHeightMm = 210;
  const marginMm = 8;
  const usableWidthMm = pageWidthMm - marginMm * 2;
  const usableHeightMm = pageHeightMm - marginMm * 2;

  if (canvas.width > 0 && canvas.height > 0) {
    const imgWidthMm = usableWidthMm;
    const scale = rootWidth > 0 ? canvas.width / rootWidth : 2; // escala real usada por html2canvas
    const pxPerMm = canvas.width / imgWidthMm;
    const sliceHeightPx = Math.max(1, Math.floor(usableHeightMm * pxPerMm));
    const canvasBands = bands.map((b) => ({ top: Math.round(b.top * scale), bottom: Math.round(b.bottom * scale) }));

    let pageStarted = false;
    for (const [pageStart, pageEnd] of paginateBands(canvasBands, canvas.height, sliceHeightPx)) {
      // Una página normalmente es un solo tramo; solo se subdivide (tramos de igual alto)
      // cuando una banda por sí sola excede el alto de página y no quedó alternativa.
      let segStart = pageStart;
      while (segStart < pageEnd) {
        const segEnd = Math.min(pageEnd, segStart + sliceHeightPx);
        const thisSlicePx = segEnd - segStart;
        if (thisSlicePx <= 0) break;

        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = thisSlicePx;
        const sliceCtx = sliceCanvas.getContext('2d');
        if (sliceCtx) sliceCtx.drawImage(canvas, 0, segStart, canvas.width, thisSlicePx, 0, 0, canvas.width, thisSlicePx);
        if (pageStarted) pdf.addPage();
        pageStarted = true;
        const sliceHeightMm = (thisSlicePx / canvas.width) * imgWidthMm;
        pdf.addImage(sliceCanvas.toDataURL('image/jpeg', 0.95), 'JPEG', marginMm, marginMm, imgWidthMm, sliceHeightMm);
        segStart = segEnd;
      }
    }
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
  pdf.save(`${filenamePrefix}_${stamp}.pdf`);
};
