import { downloadBlob } from './tableExport';

const serializeSvg = (svg: SVGSVGElement) => {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const serializer = new XMLSerializer();
  return serializer.serializeToString(clone);
};

const createSvgDataUrl = (svg: SVGSVGElement) => {
  const svgString = serializeSvg(svg);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
};

export const downloadChartPng = async (chartId: string, fileName: string) => {
  const svgElement = document.querySelector(`#${CSS.escape(chartId)} svg`) as SVGSVGElement | null;
  if (!svgElement) return;
  const dataUrl = createSvgDataUrl(svgElement);
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = dataUrl;
  await new Promise((resolve) => {
    image.onload = resolve;
    image.onerror = resolve;
  });
  const width = svgElement.clientWidth || image.width || 640;
  const height = svgElement.clientHeight || image.height || 360;
  const canvas = document.createElement('canvas');
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(2, 2);
  ctx.drawImage(image, 0, 0, width, height);
  await new Promise<void>((resolve) => {
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, fileName);
      resolve();
    }, 'image/png');
  });
};
