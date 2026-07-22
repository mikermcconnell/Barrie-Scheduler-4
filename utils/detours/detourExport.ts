import { jsPDF } from 'jspdf';
import {
  DetourExportNoticeInput,
  buildMyRideCopyPackage,
  formatDetourEffectiveSchedule,
  formatDetourRouteLabel,
  sanitizeDetourPlainText,
} from './detourCopy';
import { buildDetourFilename } from './detourFilename';

export type DetourExportErrorCode = 'missing-preview' | 'capture-failed' | 'invalid-map-image' | 'download-failed';

export class DetourExportError extends Error {
  constructor(public readonly code: DetourExportErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DetourExportError';
  }
}

export interface DetourPdfInput {
  notice: DetourExportNoticeInput;
  mapImageDataUrl: string;
  mapAttribution?: string;
  brandAssets?: {
    transitLogoDataUrl?: string;
    cityLogoDataUrl?: string;
  };
}

const BRAND_BLUE = '#005DAA';
const INK = '#172033';
const MUTED = '#526176';
const LIGHT = '#EDF3F8';

function assertImageDataUrl(value: string): void {
  if (!/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=\s]+$/i.test(value)) {
    throw new DetourExportError('invalid-map-image', 'The map image could not be read. Capture the map again and retry.');
  }
}

function imageFormat(dataUrl: string): 'PNG' | 'JPEG' {
  return /^data:image\/jpe?g;/i.test(dataUrl) ? 'JPEG' : 'PNG';
}

function addWrappedText(doc: jsPDF, text: string, x: number, y: number, width: number, lineHeight: number, maxLines: number): number {
  const lines = doc.splitTextToSize(sanitizeDetourPlainText(text), width) as string[];
  const visible = lines.slice(0, maxLines);
  doc.text(visible, x, y);
  return y + visible.length * lineHeight;
}

function drawPhoneIcon(doc: jsPDF, x: number, y: number): void {
  doc.line(x, y - 7, x + 2, y - 5);
  doc.line(x + 2, y - 5, x + 4, y - 1);
  doc.line(x + 4, y - 1, x + 8, y + 1);
  doc.line(x + 8, y + 1, x + 10, y - 1);
}

function drawMailIcon(doc: jsPDF, x: number, y: number): void {
  doc.rect(x, y - 7, 11, 8);
  doc.line(x, y - 7, x + 5.5, y - 3);
  doc.line(x + 11, y - 7, x + 5.5, y - 3);
}

function drawGlobeIcon(doc: jsPDF, x: number, y: number): void {
  doc.circle(x + 5, y - 3, 5);
  doc.line(x, y - 3, x + 10, y - 3);
  doc.line(x + 5, y - 8, x + 5, y + 2);
}

/** Builds a one-page letter PDF. All chrome and copy remain vector; only the supplied map is raster. */
export function createDetourPdf(input: DetourPdfInput): jsPDF {
  assertImageDataUrl(input.mapImageDataUrl);
  const { notice } = input;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter', compress: false });
  const width = doc.internal.pageSize.getWidth();

  doc.setFillColor(BRAND_BLUE);
  doc.rect(0, 0, width, 58, 'F');
  doc.setTextColor('#FFFFFF');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(21);
  if (input.brandAssets?.transitLogoDataUrl) {
    assertImageDataUrl(input.brandAssets.transitLogoDataUrl);
    doc.addImage(input.brandAssets.transitLogoDataUrl, imageFormat(input.brandAssets.transitLogoDataUrl), 24, 7, 106, 41, undefined, 'FAST');
  } else {
    doc.text('BARRIE TRANSIT', 28, 28);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(notice.noticeType === 'stop-closure' ? 'STOP CLOSURE' : 'DETOUR NOTICE', 28, 44);
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  const title = sanitizeDetourPlainText(notice.title);
  doc.text((doc.splitTextToSize(title, 480) as string[]).slice(0, 2), 260, 26);
  const warningX = width - 38;
  doc.setDrawColor('#EF4444');
  doc.setFillColor('#FFFFFF');
  doc.setLineWidth(2.5);
  doc.triangle(warningX, 7, warningX - 18, 49, warningX + 18, 49, 'FD');
  doc.setTextColor('#EF4444');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('!', warningX, 42, { align: 'center' });

  const mapX = 28;
  const mapY = 76;
  const mapW = 480;
  const mapH = 450;
  doc.setDrawColor('#B9C6D3');
  doc.setLineWidth(1);
  doc.rect(mapX, mapY, mapW, mapH);
  try {
    doc.addImage(input.mapImageDataUrl, imageFormat(input.mapImageDataUrl), mapX + 1, mapY + 1, mapW - 2, mapH - 2, undefined, 'FAST');
  } catch (error) {
    throw new DetourExportError('invalid-map-image', 'The captured map image is invalid or unsupported.', { cause: error });
  }
  const northX = mapX + mapW - 19;
  const northY = mapY + 20;
  doc.setFillColor('#FFFFFF');
  doc.setDrawColor('#94A3B8');
  doc.roundedRect(northX - 13, northY - 12, 26, 38, 3, 3, 'FD');
  doc.setTextColor(INK);
  doc.setFont('helvetica', 'bold');
  doc.setDrawColor(INK);
  doc.setFillColor(INK);
  doc.setLineWidth(1.5);
  doc.line(northX, northY + 8, northX, northY - 3);
  doc.triangle(northX, northY - 8, northX - 4, northY - 1, northX + 4, northY - 1, 'F');
  doc.setFontSize(8);
  doc.text('N', northX, northY + 19, { align: 'center' });

  const panelX = 528;
  const panelW = width - panelX - 28;
  let y = 82;
  doc.setTextColor(INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  y = addWrappedText(doc, formatDetourRouteLabel(notice.routes), panelX, y, panelW, 15, 3) + 8;

  doc.setFillColor(LIGHT);
  doc.roundedRect(panelX, y, panelW, 76, 5, 5, 'F');
  doc.setFontSize(9);
  doc.setTextColor(BRAND_BLUE);
  doc.text('EFFECTIVE', panelX + 12, y + 18);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(INK);
  doc.setFontSize(10);
  addWrappedText(doc, formatDetourEffectiveSchedule(notice.effectiveSchedule), panelX + 12, y + 37, panelW - 24, 13, 3);
  y += 92;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(BRAND_BLUE);
  doc.text('DETAILS', panelX, y);
  y += 17;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(INK);
  doc.setFontSize(10);
  y = addWrappedText(doc, notice.publicDetails, panelX, y, panelW, 13, 13) + 13;
  y = addWrappedText(doc, 'Routes not shown are on regular routing.', panelX, y, panelW, 13, 2) + 13;

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(BRAND_BLUE);
  doc.text('MAP LEGEND', panelX, y);
  y += 16;
  const stopLegend = [
    { color: '#1682D4', label: 'Active stop' },
    { color: '#D83535', label: 'Closed stop' },
    { color: '#1C9B68', label: 'Temporary stop' },
  ];
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(INK);
  doc.setDrawColor(BRAND_BLUE);
  doc.setLineWidth(3);
  doc.line(panelX, y - 3, panelX + 12, y - 3);
  doc.setTextColor(INK);
  doc.text('Active routing', panelX + 18, y);
  y += 16;
  doc.setDrawColor('#6E7B8B');
  doc.setLineWidth(2);
  doc.setLineDashPattern([4, 3], 0);
  doc.line(panelX, y - 3, panelX + 12, y - 3);
  doc.setLineDashPattern([], 0);
  doc.text('Out-of-service routing', panelX + 18, y);
  y += 16;
  stopLegend.forEach(item => {
    doc.setFillColor(item.color);
    doc.circle(panelX + 5, y - 3, 4, 'F');
    doc.text(item.label, panelX + 15, y);
    y += 16;
  });

  doc.setDrawColor('#D4DCE5');
  doc.line(28, 548, width - 28, 548);
  doc.setFontSize(8.5);
  doc.setTextColor(MUTED);
  let footerTextX = 28;
  if (input.brandAssets?.cityLogoDataUrl) {
    assertImageDataUrl(input.brandAssets.cityLogoDataUrl);
    doc.addImage(input.brandAssets.cityLogoDataUrl, imageFormat(input.brandAssets.cityLogoDataUrl), 28, 553, 42, 18, undefined, 'FAST');
    footerTextX = 78;
  }
  doc.setDrawColor(MUTED);
  doc.setLineWidth(1);
  drawPhoneIcon(doc, footerTextX, 568);
  doc.text('Service Barrie 705-726-4242', footerTextX + 15, 568);
  const emailX = footerTextX + 165;
  drawMailIcon(doc, emailX, 568);
  doc.text('servicebarrie@barrie.ca', emailX + 15, 568);
  const websiteX = emailX + 160;
  drawGlobeIcon(doc, websiteX, 568);
  doc.text('barrie.ca/TransitNotices', websiteX + 15, 568);
  doc.text(`Revision ${Math.max(1, Math.trunc(notice.revision || 1))}`, width - 28, 568, { align: 'right' });
  doc.setFontSize(7);
  doc.text(sanitizeDetourPlainText(input.mapAttribution ?? 'Map data © Mapbox © OpenStreetMap'), 28, 535);

  return doc;
}

export function downloadDetourPdf(input: DetourPdfInput): string {
  const filename = buildDetourFilename({
    title: input.notice.title,
    revision: input.notice.revision,
    startDate: input.notice.effectiveSchedule.startDate,
    extension: 'pdf',
  });
  createDetourPdf(input).save(filename);
  return filename;
}

export async function captureDetourNoticePng(element: HTMLElement | null, notice: DetourExportNoticeInput): Promise<{ blob: Blob; filename: string }> {
  if (!element) throw new DetourExportError('missing-preview', 'The notice preview is not available yet.');
  try {
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(element, {
      backgroundColor: '#ffffff',
      width: element.scrollWidth,
      height: element.scrollHeight,
      scale: 2,
      useCORS: true,
      logging: false,
    });
    const output = document.createElement('canvas');
    output.width = 2200;
    output.height = 1700;
    const context = output.getContext('2d');
    if (!context) throw new Error('Canvas rendering is unavailable.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, output.width, output.height);
    context.drawImage(canvas, 0, 0, output.width, output.height);
    const blob = await new Promise<Blob | null>(resolve => output.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG encoding returned no data.');
    return {
      blob,
      filename: buildDetourFilename({ title: notice.title, revision: notice.revision, startDate: notice.effectiveSchedule.startDate, extension: 'png' }),
    };
  } catch (error) {
    if (error instanceof DetourExportError) throw error;
    throw new DetourExportError('capture-failed', 'The full notice image could not be captured. Check that the map has loaded and retry.', { cause: error });
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  try {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (error) {
    throw new DetourExportError('download-failed', 'The browser could not download the exported file.', { cause: error });
  }
}

export { buildMyRideCopyPackage };
