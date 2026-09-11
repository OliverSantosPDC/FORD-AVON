import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

/**
 * Genera un PDF multi-página a partir del DOM real del Dashboard tal como está
 * renderizado (filtros, moneda y datos actuales), sin reconstruir un resumen aparte.
 * Cada sección de nivel superior del Dashboard (una fila del grid) se captura como
 * una imagen independiente y se ubica secuencialmente en el PDF, evitando cortar
 * una tarjeta/tabla/gráfico a la mitad salvo que una sola sección ya sea más alta
 * que una página completa.
 */

interface SavedStyle {
  el: HTMLElement;
  height: string;
  maxHeight: string;
  overflow: string;
  overflowY: string;
}

/** Encuentra, dentro de `root`, los contenedores que hoy recortan contenido por scroll interno
 *  (overflow-y auto/scroll con scrollHeight > clientHeight): tablas y listas con scroll propio. */
const findClippedScrollers = (root: HTMLElement): HTMLElement[] => {
  const candidates = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
  return candidates.filter((el) => {
    const style = getComputedStyle(el);
    const scrollsY = style.overflowY === 'auto' || style.overflowY === 'scroll';
    return scrollsY && el.scrollHeight - el.clientHeight > 1;
  });
};

/** Sube desde `el` hasta `root` (inclusive) liberando cualquier altura fija en la cadena,
 *  para que el contenido antes recortado por scroll pueda expandirse sin ser truncado
 *  por un ancestro con height:100% atado a una altura fija. */
const expandChainToRoot = (el: HTMLElement, root: HTMLElement, saved: Map<HTMLElement, SavedStyle>) => {
  let current: HTMLElement | null = el;
  while (current) {
    if (!saved.has(current)) {
      saved.set(current, {
        el: current,
        height: current.style.height,
        maxHeight: current.style.maxHeight,
        overflow: current.style.overflow,
        overflowY: current.style.overflowY
      });
    }
    current.style.height = 'auto';
    current.style.maxHeight = 'none';
    if (current === el) {
      current.style.overflow = 'visible';
      current.style.overflowY = 'visible';
    }
    if (current === root) break;
    current = current.parentElement;
  }
};

const restoreStyles = (saved: Map<HTMLElement, SavedStyle>) => {
  saved.forEach(({ el, height, maxHeight, overflow, overflowY }) => {
    el.style.height = height;
    el.style.maxHeight = maxHeight;
    el.style.overflow = overflow;
    el.style.overflowY = overflowY;
  });
};

const waitForLayout = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

const timestampForFilename = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
};

export interface ExportDashboardPdfOptions {
  /** Elemento raíz del grid del Dashboard (todas las secciones visibles a exportar). */
  root: HTMLElement;
  /** Prefijo del nombre de archivo; se le agrega _YYYY-MM-DD_HH-mm.pdf */
  filenamePrefix?: string;
}

export const exportDashboardToPdf = async ({ root, filenamePrefix = 'FORD-AVON_Dashboard_OnePage' }: ExportDashboardPdfOptions): Promise<void> => {
  const saved = new Map<HTMLElement, SavedStyle>();

  // 1) Expandir temporalmente todo contenedor con scroll interno que hoy recorta contenido
  //    (tablas de Cuentas/Resumen/Top, lista de Zona y Sector), para que el PDF incluya
  //    absolutamente todas las filas, no solo las visibles dentro del scroll.
  findClippedScrollers(root).forEach((el) => expandChainToRoot(el, root, saved));
  await waitForLayout();

  const sections = Array.from(root.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.dataset.onepageSkip !== 'true'
  );

  try {
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

    pdf.save(`${filenamePrefix}_${timestampForFilename(new Date())}.pdf`);
  } finally {
    // 2) Restaurar el DOM/estilos originales sin importar si la captura tuvo éxito o falló.
    restoreStyles(saved);
  }
};
