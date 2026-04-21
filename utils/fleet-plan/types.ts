export type FleetPlanSheetKey = 'diesel-12m' | 'small-buses' | 'electric-12m';

export interface FleetPlanTimelineColumn {
    key: string;
    label: string;
    exportColumn: string;
}

export interface FleetPlanBandLabel {
    cell: string;
    value: string;
    fill?: string;
    fontColor?: string;
    bold?: boolean;
}

export interface FleetPlanSheetConfig {
    key: FleetPlanSheetKey;
    name: string;
    title: string;
    titleMerge: string;
    headerRow: number;
    dataStartRow: number;
    baseColumns: Array<{
        key: 'unitNumber' | 'busSize' | 'makeModel' | 'year' | 'comment' | 'electricFlag';
        label: string;
        exportColumn: string;
    }>;
    timelineColumns: FleetPlanTimelineColumn[];
    footerSpacerRows: number;
    legendColumn?: string;
    legendItems?: string[];
    bandLabels?: FleetPlanBandLabel[];
    rowBandHeights?: Record<number, number>;
    zoomScale?: number;
    freezeCell?: string | null;
    footerType: 'diesel-12m' | 'small-buses' | 'electric-12m';
}

export interface FleetPlanRow {
    id: string;
    unitNumber: string;
    busSize?: string;
    makeModel: string;
    year: string;
    comment?: string;
    electricFlag?: string;
    timeline: Record<string, string>;
}

export interface FleetPlanSheet {
    key: FleetPlanSheetKey;
    name: string;
    title: string;
    rows: FleetPlanRow[];
}

export interface FleetPlanMetadata {
    templateVersion: string;
    sourceFileName: string;
    importedAt: string;
    importedBy: string;
    updatedAt: string;
    updatedBy: string;
}

export interface FleetPlanWorkbook {
    schemaVersion: 1;
    metadata: FleetPlanMetadata;
    sheets: FleetPlanSheet[];
}

export interface FleetPlanSummary {
    totalRows: number;
    sheetCount: number;
}

export interface FleetPlanDocumentMetadata extends FleetPlanSummary {
    templateVersion: string;
    sourceFileName: string;
    importedAt: string;
    importedBy: string;
    updatedAt: string;
    updatedBy: string;
    storagePath: string;
}

export interface FleetPlanParseResult {
    workbook: FleetPlanWorkbook;
    warnings: string[];
}
