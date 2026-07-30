export interface FareProgramsPdfExportOptions {
    element: HTMLElement;
    filterLabel: string;
    sourceFileName: string;
    totalUses: number;
    mappedUses: number;
    now?: Date;
}

function safeDate(value: Date): string {
    return value.toISOString().slice(0, 10);
}

export async function exportFareProgramsUsageMapPdf(
    options: FareProgramsPdfExportOptions,
): Promise<string> {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
    ]);
    const now = options.now ?? new Date();
    const canvas = await html2canvas(options.element, {
        backgroundColor: '#f9fafb',
        useCORS: true,
        allowTaint: false,
        scale: Math.max(2, Math.min(3, window.devicePixelRatio || 1)),
        logging: false,
        onclone: (clonedDocument) => {
            clonedDocument.querySelectorAll('[data-pdf-ignore="true"]').forEach((element) => {
                (element as HTMLElement).style.display = 'none';
            });
        },
    });

    if (!canvas.width || !canvas.height) {
        throw new Error('The usage map page could not be captured.');
    }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 10;
    const headerHeight = 25;
    const footerHeight = 10;
    const contentTop = headerHeight + 5;
    const contentWidth = pageWidth - margin * 2;
    const contentHeight = pageHeight - contentTop - footerHeight;

    doc.setFillColor(17, 54, 86);
    doc.rect(0, 0, pageWidth, headerHeight, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.text('Fare Programs - High School Pass Usage Map', margin, 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(219, 234, 254);
    doc.text(options.filterLabel, margin, 17);
    doc.text(
        `${options.totalUses.toLocaleString('en-CA')} total uses | ${options.mappedUses.toLocaleString('en-CA')} uses shown`,
        margin,
        22,
    );
    doc.setFontSize(8);
    doc.text(`Generated ${now.toLocaleString('en-CA')}`, pageWidth - margin, 10, { align: 'right' });
    doc.text(options.sourceFileName, pageWidth - margin, 17, { align: 'right' });

    const imageAspect = canvas.width / canvas.height;
    let imageWidth = contentWidth;
    let imageHeight = imageWidth / imageAspect;
    if (imageHeight > contentHeight) {
        imageHeight = contentHeight;
        imageWidth = imageHeight * imageAspect;
    }
    const imageX = (pageWidth - imageWidth) / 2;
    const imageY = contentTop + (contentHeight - imageHeight) / 2;

    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.rect(imageX - 0.5, imageY - 0.5, imageWidth + 1, imageHeight + 1, 'S');
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', imageX, imageY, imageWidth, imageHeight, undefined, 'FAST');

    doc.setDrawColor(203, 213, 225);
    doc.line(margin, pageHeight - 7, pageWidth - margin, pageHeight - 7);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.text('Internal planning map - workbook starting locations', margin, pageHeight - 3.5);
    doc.text('Barrie Transit', pageWidth - margin, pageHeight - 3.5, { align: 'right' });

    const fileName = `fare-programs-high-school-usage-map-${safeDate(now)}.pdf`;
    doc.save(fileName);
    return fileName;
}
