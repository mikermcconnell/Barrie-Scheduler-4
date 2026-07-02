/**
 * Admin-only workspace data seeding helpers.
 *
 * Copies source team Transit App and STREETS performance metadata + JSON storage
 * into the target team's own scoped paths so partner users can read it with the
 * normal team access model.
 */

import { doc, getDoc, serverTimestamp, setDoc, type DocumentData } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';

type StringRecord = Record<string, string>;
type NestedStringRecord = Record<string, StringRecord>;

export interface SeedPartnerWorkspaceDataOptions {
    sourceTeamId: string;
    targetTeamId: string;
    userId: string;
    includeTransitApp?: boolean;
    includePerformance?: boolean;
}

export interface SeedPartnerWorkspaceDataResult {
    transitApp: 'copied' | 'missing' | 'skipped';
    performance: 'copied' | 'missing' | 'skipped';
    copiedStorageFiles: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readStringRecord(value: unknown): StringRecord {
    if (!isRecord(value)) return {};
    return Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1])
    );
}

function readNestedStringRecord(value: unknown): NestedStringRecord {
    if (!isRecord(value)) return {};
    return Object.fromEntries(
        Object.entries(value)
            .map(([key, nested]) => [key, readStringRecord(nested)] as const)
            .filter((entry): entry is readonly [string, StringRecord] => Object.keys(entry[1]).length > 0)
    );
}

function getStorageBasename(storagePath: string): string {
    return storagePath.split('/').filter(Boolean).at(-1) || `${Date.now()}.json`;
}

function makeTransitTargetPath(targetTeamId: string, seedId: string, sourcePath: string): string {
    return `teams/${targetTeamId}/transitAppData/seeded/${seedId}/${getStorageBasename(sourcePath)}`;
}

function makePerformanceTargetPath(targetTeamId: string, seedId: string, sourcePath: string): string {
    const marker = '/performanceData/';
    const markerIndex = sourcePath.indexOf(marker);
    const relativePath = markerIndex >= 0
        ? sourcePath.slice(markerIndex + marker.length)
        : getStorageBasename(sourcePath);
    return `teams/${targetTeamId}/performanceData/seeded/${seedId}/${relativePath}`;
}

async function copyStorageJson(sourcePath: string, targetPath: string): Promise<void> {
    const url = await getDownloadURL(ref(storage, sourcePath));
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Could not download source data: ${sourcePath}`);
    }
    const blob = await response.blob();
    await uploadBytes(ref(storage, targetPath), blob, {
        contentType: blob.type || 'application/json',
    });
}

async function deleteTargetStoragePaths(teamId: string, paths: Iterable<string>): Promise<void> {
    await Promise.all([...new Set(paths)].map(async path => {
        if (!path.startsWith(`teams/${teamId}/`)) return;
        try {
            await deleteObject(ref(storage, path));
        } catch {
            // Best effort cleanup only.
        }
    }));
}

function collectPerformanceStoragePaths(data: DocumentData): string[] {
    const paths = [
        typeof data.storagePath === 'string' ? data.storagePath : '',
        typeof data.overviewStoragePath === 'string' ? data.overviewStoragePath : '',
        typeof data.reportStoragePath === 'string' ? data.reportStoragePath : '',
        ...Object.values(readStringRecord(data.routeStoragePaths)),
        ...Object.values(readStringRecord(data.monthlyStoragePaths)),
        ...Object.values(readNestedStringRecord(data.routeMonthlyStoragePaths)).flatMap(months => Object.values(months)),
    ];
    return paths.filter(Boolean);
}

async function seedTransitAppData(
    sourceTeamId: string,
    targetTeamId: string,
    userId: string,
    seedId: string,
): Promise<{ status: SeedPartnerWorkspaceDataResult['transitApp']; copiedFiles: number }> {
    const sourceRef = doc(db, 'teams', sourceTeamId, 'transitAppData', 'default');
    const targetRef = doc(db, 'teams', targetTeamId, 'transitAppData', 'default');
    const sourceSnap = await getDoc(sourceRef);
    if (!sourceSnap.exists()) return { status: 'missing', copiedFiles: 0 };

    const source = sourceSnap.data();
    const sourceStoragePath = typeof source.storagePath === 'string' ? source.storagePath : '';
    if (!sourceStoragePath) return { status: 'missing', copiedFiles: 0 };

    const targetStoragePath = makeTransitTargetPath(targetTeamId, seedId, sourceStoragePath);
    await copyStorageJson(sourceStoragePath, targetStoragePath);

    const oldTargetSnap = await getDoc(targetRef);
    const oldTargetPath = oldTargetSnap.exists() && typeof oldTargetSnap.data().storagePath === 'string'
        ? oldTargetSnap.data().storagePath
        : '';

    await setDoc(targetRef, {
        importedAt: serverTimestamp(),
        importedBy: userId,
        storagePath: targetStoragePath,
        dateRange: source.dateRange || { start: '', end: '' },
        fileStats: source.fileStats || { totalFiles: 0, rowsParsed: 0 },
        seededAt: serverTimestamp(),
        seededBy: userId,
        seededFromTeamId: sourceTeamId,
        seededFromStoragePath: sourceStoragePath,
    });

    if (oldTargetPath && oldTargetPath !== targetStoragePath) {
        await deleteTargetStoragePaths(targetTeamId, [oldTargetPath]);
    }

    return { status: 'copied', copiedFiles: 1 };
}

async function seedPerformanceData(
    sourceTeamId: string,
    targetTeamId: string,
    userId: string,
    seedId: string,
): Promise<{ status: SeedPartnerWorkspaceDataResult['performance']; copiedFiles: number }> {
    const sourceRef = doc(db, 'teams', sourceTeamId, 'performanceData', 'metadata');
    const targetRef = doc(db, 'teams', targetTeamId, 'performanceData', 'metadata');
    const sourceSnap = await getDoc(sourceRef);
    if (!sourceSnap.exists()) return { status: 'missing', copiedFiles: 0 };

    const source = sourceSnap.data();
    const oldTargetSnap = await getDoc(targetRef);
    const oldTargetPaths = oldTargetSnap.exists() ? collectPerformanceStoragePaths(oldTargetSnap.data()) : [];

    const copiedPaths = new Map<string, string>();
    const copyPath = async (sourcePath: string): Promise<string> => {
        if (!sourcePath) return '';
        const existing = copiedPaths.get(sourcePath);
        if (existing) return existing;
        const targetPath = makePerformanceTargetPath(targetTeamId, seedId, sourcePath);
        await copyStorageJson(sourcePath, targetPath);
        copiedPaths.set(sourcePath, targetPath);
        return targetPath;
    };

    const storagePath = typeof source.storagePath === 'string' ? await copyPath(source.storagePath) : '';
    const overviewStoragePath = typeof source.overviewStoragePath === 'string' ? await copyPath(source.overviewStoragePath) : '';
    const reportStoragePath = typeof source.reportStoragePath === 'string' ? await copyPath(source.reportStoragePath) : '';

    const routeStoragePaths: StringRecord = {};
    for (const [routeId, sourcePath] of Object.entries(readStringRecord(source.routeStoragePaths))) {
        routeStoragePaths[routeId] = await copyPath(sourcePath);
    }

    const monthlyStoragePaths: StringRecord = {};
    for (const [month, sourcePath] of Object.entries(readStringRecord(source.monthlyStoragePaths))) {
        monthlyStoragePaths[month] = await copyPath(sourcePath);
    }

    const routeMonthlyStoragePaths: NestedStringRecord = {};
    for (const [routeId, months] of Object.entries(readNestedStringRecord(source.routeMonthlyStoragePaths))) {
        routeMonthlyStoragePaths[routeId] = {};
        for (const [month, sourcePath] of Object.entries(months)) {
            routeMonthlyStoragePaths[routeId][month] = await copyPath(sourcePath);
        }
    }

    if (copiedPaths.size === 0) return { status: 'missing', copiedFiles: 0 };

    await setDoc(targetRef, {
        importedAt: serverTimestamp(),
        importedBy: userId,
        storageMode: source.storageMode || (Object.keys(monthlyStoragePaths).length > 0 ? 'monthly' : 'monolithic'),
        storagePath,
        overviewStoragePath,
        reportStoragePath,
        routeStoragePaths,
        monthlyStoragePaths,
        routeMonthlyStoragePaths,
        dateRange: source.dateRange || { start: '', end: '' },
        dayCount: source.dayCount || 0,
        totalRecords: source.totalRecords || 0,
        runtimeLogicVersion: typeof source.runtimeLogicVersion === 'number' ? source.runtimeLogicVersion : null,
        cleanHistoryStartDate: typeof source.cleanHistoryStartDate === 'string' ? source.cleanHistoryStartDate : null,
        seededAt: serverTimestamp(),
        seededBy: userId,
        seededFromTeamId: sourceTeamId,
    });

    await deleteTargetStoragePaths(targetTeamId, oldTargetPaths);
    return { status: 'copied', copiedFiles: copiedPaths.size };
}

export async function seedPartnerWorkspaceData(
    options: SeedPartnerWorkspaceDataOptions,
): Promise<SeedPartnerWorkspaceDataResult> {
    if (!options.sourceTeamId || !options.targetTeamId) {
        throw new Error('Source and target teams are required');
    }
    if (options.sourceTeamId === options.targetTeamId) {
        throw new Error('Choose a different source team');
    }

    const seedId = Date.now().toString();
    const includeTransitApp = options.includeTransitApp !== false;
    const includePerformance = options.includePerformance !== false;

    const transit = includeTransitApp
        ? await seedTransitAppData(options.sourceTeamId, options.targetTeamId, options.userId, seedId)
        : { status: 'skipped' as const, copiedFiles: 0 };
    const performance = includePerformance
        ? await seedPerformanceData(options.sourceTeamId, options.targetTeamId, options.userId, seedId)
        : { status: 'skipped' as const, copiedFiles: 0 };

    return {
        transitApp: transit.status,
        performance: performance.status,
        copiedStorageFiles: transit.copiedFiles + performance.copiedFiles,
    };
}
