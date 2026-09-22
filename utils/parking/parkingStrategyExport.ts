import type { ParkingLocoMobiHistorySnapshot } from './parkingLocoMobiTypes';
import type { ParkingStrategyModel } from './parkingStrategyModel';

export interface ParkingStrategyBriefOptions {
  snapshot: ParkingLocoMobiHistorySnapshot;
  model: ParkingStrategyModel;
  periodLabel: string;
  selectedAreaLabel?: string;
}

const count = (value: number) => value.toLocaleString('en-CA');
const amount = (value: number) => `CAD ${value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pdfText = (value: string) => value.replace(/[\u0000-\u001f]/g, ' ').replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');

/** Aggregate-only briefing; never accepts or exports payment rows or user identifiers. */
export async function exportParkingStrategyBrief({ snapshot, model, periodLabel, selectedAreaLabel }: ParkingStrategyBriefOptions): Promise<void> {
  if (!model.periodAvailable) throw new Error(model.unavailableReason || 'This archive cannot produce the selected period briefing.');
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const margin = 38;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const textWidth = pageWidth - margin * 2;
  let y = 42;

  function paragraph(value: string, fontSize = 9, bold = false): void {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(pdfText(value), textWidth) as string[];
    for (const line of lines) {
      if (y + fontSize * 1.4 > pageHeight - 42) { doc.addPage(); y = 42; }
      doc.text(line, margin, y);
      y += fontSize * 1.4;
    }
    y += 5;
  }

  function table(title: string, head: string[], body: string[][]): void {
    if (y + 70 > pageHeight - 42) { doc.addPage(); y = 42; }
    paragraph(title, 11, true);
    autoTable(doc, {
      startY: y,
      head: [head.map(pdfText)],
      body: body.map(row => row.map(pdfText)),
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 5, overflow: 'linebreak' },
      headStyles: { fillColor: [15, 64, 87], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [243, 247, 250] },
      margin: { top: 38, bottom: 42, left: margin, right: margin },
    });
    y = (doc as typeof doc & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
    y += 18;
  }

  paragraph('Parking Strategy - Executive Evidence Brief', 17, true);
  paragraph(`LocoMobi / Worldstream | ${periodLabel}`, 10);
  paragraph(`Archive observed dates: ${snapshot.coverage.observedStartDate} to ${snapshot.coverage.observedEndDate}. These dates do not establish complete collection coverage.`);
  if (selectedAreaLabel) paragraph(`${model.selectedArea ? 'Evidence scope' : 'Highlighted area (board totals cover all areas)'}: ${selectedAreaLabel}`);
  paragraph('Financial basis: source-reported amounts in CAD. Tax treatment is unconfirmed; amounts are not added to HotSpot / QR tax-inclusive revenue.', 9, true);

  table('Selected-period evidence', ['Measure', 'Value'], [
    ['Accepted payment records', count(model.totals.rowCount)],
    ['Source-reported amount', amount(model.totals.totalReportedAmount)],
    ['Zero-dollar records (included)', count(model.totals.zeroAmountRowCount)],
    ['Negative-amount records (included)', count(model.totals.negativeAmountRowCount)],
    ['Observed supplied months', count(model.observedMonths.length)],
  ]);
  if (!model.totals.rowCount) paragraph('No supplied records match this selection. This is not evidence of zero parking activity.');

  table('Monthly payment activity', ['Month', 'Records', 'Source-reported amount', 'Zero-dollar records'],
    model.monthly.map(month => [month.month, count(month.rowCount), amount(month.totalReportedAmount), count(month.zeroAmountRowCount)]));

  const ranked = (model.selectedArea ? [model.selectedArea] : model.areas).slice().sort((a, b) => b.rowCount - a.rowCount || a.label.localeCompare(b.label));
  table('Area ranking by payment records', ['Area', 'Location link', 'Records', 'Source-reported amount'], ranked.map(area => [
    area.label,
    area.kind === 'reviewed_location' ? 'Reviewed physical lot link' : 'Unmatched source area',
    count(area.rowCount),
    amount(area.totalReportedAmount),
  ]));
  paragraph('Map coverage: only reviewed physical links with valid location coordinates receive pins. A reviewed link alone does not confirm valid coordinates. Unmatched source areas remain in evidence totals; this briefing does not assert a mapped-record count.');

  paragraph('Interpretation and limitations', 11, true);
  paragraph('Payment activity is not occupancy. These records do not establish stay length, turnover, occupied spaces, or capacity utilization. First and last months may be partial; missing months are unavailable, not zero. No annualized estimate or forecast is presented.');
  paragraph('Zero-dollar records remain in counts and contribute zero to monetary totals. Rates, exemptions, payment-system settings, occupancy surveys, accessibility, costs and asset condition require separate evidence before policy conclusions.');

  table('Source archive reconciliation (all imported periods)', ['Measure', 'Archive total'], [
    ['Source rows', count(snapshot.reconciliation.sourceRowCount)],
    ['Accepted records', count(snapshot.reconciliation.acceptedRowCount)],
    ['Exact duplicates removed', count(snapshot.reconciliation.duplicateRowCount)],
    ['Report / invalid rows excluded', count(snapshot.reconciliation.skippedRowCount)],
    ['Source-reported amount', amount(snapshot.reconciliation.totalReportedAmount)],
  ]);
  table('Source workbooks and canonical tables (whole archive)', ['Workbook / table', 'Accepted', 'Duplicates', 'Excluded'], snapshot.sourceTables.map(source => [
    `${source.fileName.split(/[\\/]/).at(-1) || 'Workbook'} / ${source.sheetName}`,
    count(source.acceptedRowCount), count(source.duplicateRowCount), count(source.skippedRowCount),
  ]));
  paragraph('Method: one canonical table per workbook; exact source-row deduplication before privacy projection. Transaction Time defines activity, with Entry Time used only when Transaction Time is unavailable. This briefing contains aggregate evidence only.');

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(90);
    doc.text('Municipal Parking Strategy | LocoMobi evidence', margin, pageHeight - 22);
    doc.text(`${page} / ${pageCount}`, pageWidth - margin, pageHeight - 22, { align: 'right' });
  }
  const suffix = periodLabel.replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'history';
  doc.save(`parking-strategy-brief-${suffix}.pdf`);
}
