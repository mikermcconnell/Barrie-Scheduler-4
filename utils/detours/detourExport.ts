import { jsPDF } from 'jspdf';
import {
  type DetourExportNoticeInput,
  buildMyRideCopyPackage,
  formatDetourEffectiveSchedule,
  isDetourEffectiveDateOnly,
  sanitizeDetourPlainText,
} from './detourCopy';
import { buildDetourFilename } from './detourFilename';
import {
  DETOUR_NOTICE_COLORS,
  formatDetourStopSheetRoutes,
  formatDetourStopSheetSubtitle,
  formatDetourStopSheetTitle,
  type DetourStopSheet,
  type DetourStopSheetKind,
} from './detourStopSheets';

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
  stopSheets?: Array<{
    sheet: DetourStopSheet;
    mapImageDataUrl: string;
  }>;
}

const INK = '#231F20';
const BRAND_BLUE = DETOUR_NOTICE_COLORS.master;
const EFFECTIVE_RED = '#F04438';
const PAGE_WIDTH = 792;
const HEADER_HEIGHT = 105;
const FOOTER_Y = 539;
const LEFT_X = 10;
const CARD_Y = 116;
const LEFT_WIDTH = 487;
const CARD_BOTTOM = 526;
const LEGEND_Y = 437;
const RIGHT_X = 509;
const RIGHT_WIDTH = 273;

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

function fitSingleLineFont(doc: jsPDF, text: string, width: number, maximum: number, minimum: number): number {
  for (let size = maximum; size >= minimum; size -= 0.5) {
    doc.setFontSize(size);
    if (doc.getTextWidth(text) <= width) return size;
  }
  return minimum;
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

function drawTransitStopIcon(
  doc: jsPDF,
  x: number,
  y: number,
  radius: number,
  kind: DetourStopSheetKind | 'active',
): void {
  const ringColor = kind === 'temporary' ? DETOUR_NOTICE_COLORS.temporary : BRAND_BLUE;
  doc.setFillColor('#FFFFFF');
  doc.setDrawColor(ringColor);
  doc.setLineWidth(Math.max(1.2, radius * 0.12));
  doc.circle(x, y, radius, 'FD');
  doc.setFillColor(BRAND_BLUE);
  doc.circle(x, y, radius * 0.76, 'F');

  doc.setFillColor('#FFFFFF');
  doc.roundedRect(x - radius * 0.39, y - radius * 0.43, radius * 0.78, radius * 0.82, radius * 0.1, radius * 0.1, 'F');
  doc.setFillColor(BRAND_BLUE);
  doc.roundedRect(x - radius * 0.28, y - radius * 0.31, radius * 0.56, radius * 0.28, radius * 0.04, radius * 0.04, 'F');
  doc.rect(x - radius * 0.28, y + radius * 0.08, radius * 0.56, radius * 0.09, 'F');
  doc.setFillColor('#FFFFFF');
  doc.circle(x - radius * 0.22, y + radius * 0.39, radius * 0.1, 'F');
  doc.circle(x + radius * 0.22, y + radius * 0.39, radius * 0.1, 'F');

  if (kind === 'closed') {
    doc.setDrawColor(DETOUR_NOTICE_COLORS.closed);
    doc.setLineWidth(Math.max(2, radius * 0.14));
    doc.line(x - radius * 0.72, y + radius * 0.72, x + radius * 0.72, y - radius * 0.72);
  }
}

function drawWarningIcon(doc: jsPDF, x: number, y: number): void {
  doc.setDrawColor(EFFECTIVE_RED);
  doc.setFillColor('#FFFFFF');
  doc.setLineWidth(5);
  doc.triangle(x, y - 31, x - 27, y + 25, x + 27, y + 25, 'FD');
  doc.setTextColor(INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(25);
  doc.text('!', x, y + 16, { align: 'center' });
}

function drawNorthArrow(doc: jsPDF): void {
  const x = LEFT_X + 15;
  const top = CARD_Y + 8;
  doc.setDrawColor(INK);
  doc.setFillColor(INK);
  doc.setLineWidth(1.2);
  doc.line(x, top + 19, x, top + 4);
  doc.triangle(x, top, x - 4, top + 7, x + 4, top + 7, 'F');
  doc.setTextColor(INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('N', x, top + 34, { align: 'center' });
}

function drawRouteLegend(doc: jsPDF, x: number, y: number): void {
  doc.setLineCap('round');
  doc.setDrawColor('#E74C3C');
  doc.setLineWidth(7);
  doc.line(x - 22, y, x + 22, y);
  doc.setDrawColor(BRAND_BLUE);
  doc.setLineWidth(4);
  doc.line(x - 22, y, x + 22, y);
  doc.setDrawColor(INK);
  doc.setLineWidth(1.7);
  doc.line(x - 22, y, x + 22, y);
}

function drawLegend(doc: jsPDF): void {
  doc.setTextColor(INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Legend', LEFT_X + 14, LEGEND_Y + 20);

  const centers = [58, 151, 247, 343, 440];
  const symbolY = LEGEND_Y + 48;
  drawRouteLegend(doc, centers[0], symbolY);

  doc.setDrawColor(DETOUR_NOTICE_COLORS.closed);
  doc.setLineWidth(3.2);
  doc.setLineDashPattern([5, 4], 0);
  doc.line(centers[1] - 22, symbolY, centers[1] + 22, symbolY);
  doc.setLineDashPattern([], 0);

  drawTransitStopIcon(doc, centers[2], symbolY, 8, 'closed');
  drawTransitStopIcon(doc, centers[3], symbolY, 8, 'active');
  drawTransitStopIcon(doc, centers[4], symbolY, 8, 'temporary');

  const labels = [
    ['Active Routing'],
    ['Out of Service', 'Routing'],
    ['Out-of-Service Stops'],
    ['Active Stops'],
    ['Temporary Stops'],
  ];
  doc.setFontSize(6.7);
  labels.forEach((lines, index) => {
    doc.text(lines, centers[index], LEGEND_Y + 70, { align: 'center' });
  });
}

function drawCityMark(doc: jsPDF, x: number, y: number): void {
  doc.setTextColor('#FFFFFF');
  doc.setDrawColor('#FFFFFF');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.text('Barrie', x, y);
  doc.setLineWidth(1.7);
  doc.line(x, y + 7, x + 22, y + 4);
  doc.line(x + 22, y + 4, x + 43, y + 8);
  doc.line(x + 43, y + 8, x + 65, y + 4);
}

function drawHeader(
  doc: jsPDF,
  input: DetourPdfInput,
  themeColor: string,
  headerTitle: string,
  headerSubtitle: string,
  stopSheet?: DetourStopSheet,
): void {
  doc.setFillColor(themeColor);
  doc.rect(0, 0, PAGE_WIDTH, HEADER_HEIGHT, 'F');
  doc.setTextColor('#FFFFFF');

  if (input.brandAssets?.transitLogoDataUrl) {
    assertImageDataUrl(input.brandAssets.transitLogoDataUrl);
    doc.addImage(input.brandAssets.transitLogoDataUrl, imageFormat(input.brandAssets.transitLogoDataUrl), 27, 21, 128, 59, undefined, 'FAST');
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('BARRIE TRANSIT', 27, 58);
  }

  doc.setDrawColor('#FFFFFF');
  doc.setLineWidth(0.8);
  doc.line(177, 18, 177, 87);
  doc.setFont('helvetica', 'bold');
  const titleSize = fitSingleLineFont(doc, headerTitle, 503, headerTitle.length > 20 ? 33 : 41, 25);
  doc.setFontSize(titleSize);
  doc.text(headerTitle, 197, 53);
  doc.setFontSize(fitSingleLineFont(doc, headerSubtitle, 500, 14, 9));
  doc.text(headerSubtitle, 197, 78);

  if (stopSheet) drawTransitStopIcon(doc, 751, 52, 33, stopSheet.kind);
  else drawWarningIcon(doc, 751, 53);
}

function drawMainMap(doc: jsPDF, input: DetourPdfInput, mapImageDataUrl: string): void {
  const imageX = LEFT_X + 3;
  const imageY = CARD_Y + 3;
  const imageW = LEFT_WIDTH - 6;
  const imageH = LEGEND_Y - CARD_Y - 3;
  try {
    doc.addImage(mapImageDataUrl, imageFormat(mapImageDataUrl), imageX, imageY, imageW, imageH, undefined, 'FAST');
  } catch (error) {
    throw new DetourExportError('invalid-map-image', 'The captured map image is invalid or unsupported.', { cause: error });
  }

  drawNorthArrow(doc);
  doc.setFillColor('#FFFFFF');
  doc.setTextColor('#526176');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.6);
  const attribution = sanitizeDetourPlainText(input.mapAttribution ?? 'Map data (c) Mapbox (c) OpenStreetMap');
  const attributionWidth = Math.min(128, doc.getTextWidth(attribution) + 5);
  doc.rect(LEFT_X + 6, LEGEND_Y - 10, attributionWidth, 7, 'F');
  doc.text(attribution, LEFT_X + 8, LEGEND_Y - 5);

  drawLegend(doc);
  doc.setDrawColor(INK);
  doc.setLineWidth(3.2);
  doc.roundedRect(LEFT_X, CARD_Y, LEFT_WIDTH, CARD_BOTTOM - CARD_Y, 8, 8, 'S');
  doc.line(LEFT_X, LEGEND_Y, LEFT_X + LEFT_WIDTH, LEGEND_Y);
}

function drawRightPanel(doc: jsPDF, notice: DetourExportNoticeInput): void {
  doc.setTextColor(INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.text('Effective Dates', RIGHT_X + 6, 149);

  doc.setDrawColor(INK);
  doc.setLineWidth(3.2);
  doc.roundedRect(RIGHT_X, 163, RIGHT_WIDTH, 151, 8, 8, 'S');

  const effectiveSchedule = formatDetourEffectiveSchedule(notice.effectiveSchedule);
  doc.setTextColor(EFFECTIVE_RED);
  doc.setFont('helvetica', 'bold');
  if (isDetourEffectiveDateOnly(notice.effectiveSchedule)) {
    doc.setFontSize(fitSingleLineFont(doc, effectiveSchedule, RIGHT_WIDTH - 28, 23, 11));
    doc.text(effectiveSchedule, RIGHT_X + RIGHT_WIDTH / 2, 244, { align: 'center' });
  } else {
    doc.setFontSize(16);
    const lines = (doc.splitTextToSize(effectiveSchedule, RIGHT_WIDTH - 30) as string[]).slice(0, 5);
    const startY = 239 - ((lines.length - 1) * 10);
    doc.text(lines, RIGHT_X + RIGHT_WIDTH / 2, startY, { align: 'center', lineHeightFactor: 1.18 });
  }

  doc.setTextColor(INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.text('Details', RIGHT_X + 6, 356);
  doc.setDrawColor(INK);
  doc.setLineWidth(3.2);
  doc.roundedRect(RIGHT_X, 367, RIGHT_WIDTH, 158, 8, 8, 'S');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  addWrappedText(doc, notice.publicDetails, RIGHT_X + 14, 386, RIGHT_WIDTH - 28, 12.5, 10);
}

function drawFooter(doc: jsPDF, input: DetourPdfInput, themeColor: string): void {
  doc.setFillColor(themeColor);
  doc.rect(0, FOOTER_Y, PAGE_WIDTH, 612 - FOOTER_Y, 'F');
  doc.setTextColor('#FFFFFF');
  doc.setDrawColor('#FFFFFF');

  if (input.brandAssets?.cityLogoDataUrl) {
    assertImageDataUrl(input.brandAssets.cityLogoDataUrl);
    doc.addImage(input.brandAssets.cityLogoDataUrl, imageFormat(input.brandAssets.cityLogoDataUrl), 28, 555, 105, 38, undefined, 'FAST');
  } else {
    drawCityMark(doc, 28, 580);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('For More Information Contact:', 296, 580, { align: 'center' });
  const footerTextX = 522;
  drawPhoneIcon(doc, footerTextX, 558);
  doc.text('Service Barrie at 705-726-4242', footerTextX + 15, 558);
  drawMailIcon(doc, footerTextX, 575);
  doc.text('ServiceBarrie@barrie.ca', footerTextX + 15, 575);
  drawGlobeIcon(doc, footerTextX, 592);
  doc.text('www.barrie.ca/TransitNotices', footerTextX + 15, 592);
}

function drawDetourPdfPage(doc: jsPDF, input: DetourPdfInput, mapImageDataUrl: string, stopSheet?: DetourStopSheet): void {
  assertImageDataUrl(mapImageDataUrl);
  const { notice } = input;
  const themeColor = stopSheet ? DETOUR_NOTICE_COLORS[stopSheet.kind] : BRAND_BLUE;
  const headerTitle = stopSheet
    ? formatDetourStopSheetTitle(stopSheet)
    : notice.noticeType === 'stop-closure' ? 'STOP CLOSURE' : 'DETOUR NOTICE';
  const headerSubtitle = stopSheet
    ? formatDetourStopSheetSubtitle(stopSheet)
    : formatDetourStopSheetRoutes(notice.routes);

  drawHeader(doc, input, themeColor, headerTitle, headerSubtitle, stopSheet);
  drawMainMap(doc, input, mapImageDataUrl);
  drawRightPanel(doc, notice);
  drawFooter(doc, input, themeColor);
}

/** Builds a landscape-letter publication package. Chrome and copy remain vector; supplied maps stay raster. */
export function createDetourPdf(input: DetourPdfInput): jsPDF {
  assertImageDataUrl(input.mapImageDataUrl);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter', compress: false });
  drawDetourPdfPage(doc, input, input.mapImageDataUrl);
  input.stopSheets?.forEach(({ sheet, mapImageDataUrl }) => {
    doc.addPage('letter', 'landscape');
    drawDetourPdfPage(doc, input, mapImageDataUrl, sheet);
  });
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
