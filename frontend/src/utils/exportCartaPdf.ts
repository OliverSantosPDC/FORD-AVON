import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

/**
 * Motor ÚNICO de render de una carta a PDF (captura del nodo real vía
 * html2canvas + jsPDF, igual que utils/exportDashboardPdf.ts) — usado tanto
 * por la descarga individual (`descargarCartaPdf`, guarda directo) como por
 * la descarga masiva (`cartaPdfBlob`, Gestión > Cartas: selección múltiple
 * -> ZIP), para que ambas produzcan EXACTAMENTE el mismo documento. Nunca
 * duplicado entre las dos.
 */
const renderizarCartaPdf = async (node: HTMLElement): Promise<jsPDF> => {
  const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidthMm = 210;
  const marginMm = 12;
  const usableWidthMm = pageWidthMm - marginMm * 2;
  const imgHeightMm = (canvas.height / canvas.width) * usableWidthMm;
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', marginMm, marginMm, usableWidthMm, imgHeightMm);
  return pdf;
};

/** Descarga de una carta de cobro ya AUTORIZADA, como PDF de una sola página. */
export const descargarCartaPdf = async (node: HTMLElement, nombreArchivo: string): Promise<void> => {
  const pdf = await renderizarCartaPdf(node);
  pdf.save(`${nombreArchivo}.pdf`);
};

/** Mismo PDF que `descargarCartaPdf`, pero como Blob en vez de guardarlo
 *  directo — para empaquetar varias cartas en un único ZIP (descarga masiva). */
export const cartaPdfBlob = async (node: HTMLElement): Promise<Blob> => {
  const pdf = await renderizarCartaPdf(node);
  return pdf.output('blob');
};

/** Espera a que todas las imágenes (logo/firma) dentro del nodo terminen de
 *  cargar antes de capturarlo — html2canvas puede disparar antes de que el
 *  navegador termine de pintar una <img> recién insertada. Nunca se queda
 *  colgado indefinidamente: cada imagen tiene un tope de espera propio. */
export const esperarImagenesCargadas = (node: HTMLElement, timeoutMs = 8000): Promise<void> => {
  const imgs = Array.from(node.querySelectorAll('img'));
  if (imgs.length === 0) return Promise.resolve();
  return Promise.all(
    imgs.map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const done = () => resolve();
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        setTimeout(done, timeoutMs);
      });
    })
  ).then(() => undefined);
};
