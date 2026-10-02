import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

/**
 * Descarga de una carta de cobro ya AUTORIZADA, como PDF de una sola página.
 * Misma técnica (captura del nodo real vía html2canvas + jsPDF) que
 * utils/exportDashboardPdf.ts — reutilizada, no una librería/implementación
 * paralela — simplificada aquí porque una carta es una sola página, sin la
 * paginación por tarjetas que sí necesita el OnePage del Dashboard.
 */
export const descargarCartaPdf = async (node: HTMLElement, nombreArchivo: string): Promise<void> => {
  const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidthMm = 210;
  const marginMm = 12;
  const usableWidthMm = pageWidthMm - marginMm * 2;
  const imgHeightMm = (canvas.height / canvas.width) * usableWidthMm;
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', marginMm, marginMm, usableWidthMm, imgHeightMm);
  pdf.save(`${nombreArchivo}.pdf`);
};
