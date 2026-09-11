import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

/**
 * OnePage del Dashboard: genera una "fotografía" fiel del Dashboard tal como está
 * renderizado (filtros, moneda y datos actuales), sin reconstruir un resumen aparte.
 *
 * Flujo: Dashboard real → clon de exportación (`createExportSnapshot`) → Preview (mismo
 * clon, mostrado en un diálogo con scroll) → PDF (`renderSnapshotToPdf`, capturado del
 * MISMO clon que el usuario revisó). El Dashboard real nunca se modifica: todo el trabajo
 * de expansión de scroll interno y de preparar los gráficos ocurre sobre un `cloneNode`
 * desconectado, que se descarta al cerrar el preview.
 */

/** Recharts/SVG: html2canvas no siempre rasteriza correctamente un <svg> vivo (gradientes,
 *  texto, clip-path). La técnica confiable (misma usada por utils/chartExport.ts para
 *  "Exportar PNG") es serializar el SVG real a data URL y dejar que el propio navegador
 *  lo decodifique como imagen; luego html2canvas solo necesita pintar un <img> ya
 *  decodificado, sin reinterpretar el SVG. No se reconstruye ni se sustituye el gráfico:
 *  es el mismo SVG, servido como imagen para una captura fiel. */
const serializeSvgToDataUrl = (svg: SVGSVGElement): string => {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(clone);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
};

/** Reemplaza cada <svg> del snapshot por un <img> con el mismo SVG serializado como
 *  fuente, del mismo ancho/alto ya medido (Recharts fija width/height reales en el SVG
 *  al montar). Devuelve la promesa de que todas las imágenes terminaron de decodificar,
 *  para no capturar un gráfico a medio pintar. */
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
 *  "congelado" que no corresponde a una interacción real del usuario. */
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

interface SavedStyle {
  el: HTMLElement;
  height: string;
  maxHeight: string;
  overflow: string;
  overflowY: string;
}

/** Dentro del CLON (nunca del Dashboard real), encuentra los contenedores que hoy
 *  recortan contenido por scroll interno (overflow-y auto/scroll con scrollHeight >
 *  clientHeight): tablas y listas con scroll propio. */
const findClippedScrollers = (root: HTMLElement): HTMLElement[] => {
  const candidates = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
  return candidates.filter((el) => {
    const style = getComputedStyle(el);
    const scrollsY = style.overflowY === 'auto' || style.overflowY === 'scroll';
    return scrollsY && el.scrollHeight - el.clientHeight > 1;
  });
};

/** Libera, dentro del clon, cualquier altura fija en la cadena desde `el` hasta `root`
 *  (inclusive) para que el contenido antes recortado por scroll pueda expandirse sin
 *  quedar truncado por un ancestro con height:100% atado a una altura fija. Como todo
 *  esto ocurre sobre el clon desconectado, no hace falta restaurar nada en el DOM real. */
const expandChainToRoot = (el: HTMLElement, root: HTMLElement, seen: Set<HTMLElement>) => {
  let current: HTMLElement | null = el;
  while (current) {
    if (!seen.has(current)) {
      seen.add(current);
      current.style.height = 'auto';
      current.style.maxHeight = 'none';
    }
    if (current === el) {
      current.style.overflow = 'visible';
      current.style.overflowY = 'visible';
    }
    if (current === root) break;
    current = current.parentElement;
  }
};

const waitForLayout = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

export interface ExportSnapshot {
  /** Contenedor a insertar en el preview (ancho fijo = ancho real del Dashboard al
   *  momento de generar, para que nada reflowee de forma distinta al original). */
  container: HTMLElement;
  /** El mismo nodo, ya clonado/preparado (scrollers expandidos, SVG→imagen, sin
   *  botón OnePage). Preview y PDF capturan este único nodo: nunca se reconstruye. */
  root: HTMLElement;
}

/**
 * Crea el clon de exportación a partir del Dashboard real ya renderizado. No modifica
 * el DOM real en ningún momento: todo el trabajo ocurre sobre `root.cloneNode(true)`.
 *
 * Detección de scroll interno y medidas de SVG (getBoundingClientRect/scrollHeight)
 * solo devuelven valores reales si el nodo está adjunto al documento y "layouteado" —
 * en un nodo desconectado, scrollHeight/clientHeight valen ambos 0. Por eso el clon se
 * adjunta temporalmente fuera de pantalla (position:fixed, left muy negativo) mientras
 * se preparan scrollers/SVG, y se desconecta antes de devolver el snapshot; el preview
 * luego lo vuelve a montar (ya con los estilos de expansión ya "horneados" como inline).
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

    const seen = new Set<HTMLElement>();
    findClippedScrollers(clone).forEach((el) => expandChainToRoot(el, clone, seen));

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
 * Genera el PDF a partir del MISMO snapshot que se mostró en el preview (mismo render
 * para preview y PDF). El snapshot debe estar insertado en el documento (aunque sea en
 * un contenedor oculto) para que html2canvas pueda medir/pintar su layout.
 */
export const renderSnapshotToPdf = async (snapshot: ExportSnapshot, filenamePrefix = 'FORD-AVON_Dashboard_OnePage'): Promise<void> => {
  const sections = Array.from(snapshot.root.children).filter((child): child is HTMLElement => child instanceof HTMLElement);

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidthMm = 297;
  const pageHeightMm = 210;
  const marginMm = 8;
  const usableWidthMm = pageWidthMm - marginMm * 2;
  const usableHeightMm = pageHeightMm - marginMm * 2;
  const gapMm = 4;

  let cursorYMm = marginMm;
  let pageStarted = false;

  for (const section of sections) {
    // eslint-disable-next-line no-await-in-loop
    const canvas = await html2canvas(section, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    if (canvas.width === 0 || canvas.height === 0) continue;

    const imgWidthMm = usableWidthMm;
    const imgHeightMm = (canvas.height / canvas.width) * imgWidthMm;

    if (imgHeightMm > usableHeightMm) {
      // La sección es más alta que una página completa: se corta en varias páginas
      // (única forma técnicamente posible de incluirla completa).
      const pxPerMm = canvas.width / imgWidthMm;
      const sliceHeightPx = Math.max(1, Math.floor(usableHeightMm * pxPerMm));
      let renderedPx = 0;
      while (renderedPx < canvas.height) {
        const thisSlicePx = Math.min(sliceHeightPx, canvas.height - renderedPx);
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = thisSlicePx;
        const ctx = sliceCanvas.getContext('2d');
        if (ctx) ctx.drawImage(canvas, 0, renderedPx, canvas.width, thisSlicePx, 0, 0, canvas.width, thisSlicePx);
        if (pageStarted) pdf.addPage();
        pageStarted = true;
        const sliceHeightMm = (thisSlicePx / canvas.width) * imgWidthMm;
        pdf.addImage(sliceCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', marginMm, marginMm, imgWidthMm, sliceHeightMm);
        renderedPx += thisSlicePx;
      }
      cursorYMm = pageHeightMm;
      continue;
    }

    if (!pageStarted) {
      pageStarted = true;
    } else if (cursorYMm + imgHeightMm > pageHeightMm - marginMm) {
      pdf.addPage();
      cursorYMm = marginMm;
    }

    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', marginMm, cursorYMm, imgWidthMm, imgHeightMm);
    cursorYMm += imgHeightMm + gapMm;
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
  pdf.save(`${filenamePrefix}_${stamp}.pdf`);
};
