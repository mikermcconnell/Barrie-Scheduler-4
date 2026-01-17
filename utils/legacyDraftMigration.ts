import { getAllDrafts as getLegacyDrafts, getDraft as getLegacyDraft } from './dataService';
import { getAllProjects, getProject } from './newScheduleProjectService';
import { saveDraft } from './draftService';
import { buildMasterContentFromTables } from './scheduleDraftAdapter';
import { extractDayType, extractRouteNumber } from './masterScheduleTypes';
import type { MasterRouteTable } from './masterScheduleParser';
import type { DraftScheduleInput } from './scheduleTypes';

export interface MigrationSummary {
    migrated: number;
    skipped: number;
    errors: string[];
}

const groupTablesByRouteDay = (tables: MasterRouteTable[]): Map<string, MasterRouteTable[]> => {
    const grouped = new Map<string, MasterRouteTable[]>();

    tables.forEach(table => {
        const routeNumber = extractRouteNumber(table.routeName);
        const dayType = extractDayType(table.routeName);
        const key = `${routeNumber}-${dayType}`;
        const existing = grouped.get(key) || [];
        existing.push(table);
        grouped.set(key, existing);
    });

    return grouped;
};

const buildDraftInputs = (
    baseName: string,
    userId: string,
    tables: MasterRouteTable[],
    basedOn?: DraftScheduleInput['basedOn']
): DraftScheduleInput[] => {
    const grouped = groupTablesByRouteDay(tables);
    const inputs: DraftScheduleInput[] = [];

    grouped.forEach((groupTables, key) => {
        const buildResult = buildMasterContentFromTables(groupTables);
        if (!buildResult) return;

        const displayName = grouped.size > 1 ? `${baseName} - ${buildResult.routeNumber} ${buildResult.dayType}` : baseName;

        inputs.push({
            name: displayName,
            routeNumber: buildResult.routeNumber,
            dayType: buildResult.dayType,
            status: 'draft',
            createdBy: userId,
            basedOn,
            content: buildResult.content
        });
    });

    return inputs;
};

export const migrateLegacyDrafts = async (userId: string): Promise<MigrationSummary> => {
    const summary: MigrationSummary = { migrated: 0, skipped: 0, errors: [] };

    const legacyDrafts = await getLegacyDrafts(userId);

    for (const legacy of legacyDrafts) {
        try {
            const fullDraft = await getLegacyDraft(userId, legacy.id);
            if (!fullDraft || !fullDraft.schedules || fullDraft.schedules.length === 0) {
                summary.skipped += 1;
                continue;
            }

            const inputs = buildDraftInputs(
                fullDraft.name,
                userId,
                fullDraft.schedules,
                { type: 'legacy', id: legacy.id }
            );

            if (inputs.length === 0) {
                summary.skipped += 1;
                continue;
            }

            for (const input of inputs) {
                await saveDraft(userId, input);
                summary.migrated += 1;
            }
        } catch (error) {
            summary.errors.push(`Draft ${legacy.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return summary;
};

export const migrateGeneratedProjects = async (userId: string): Promise<MigrationSummary> => {
    const summary: MigrationSummary = { migrated: 0, skipped: 0, errors: [] };
    const projects = await getAllProjects(userId);

    for (const project of projects) {
        try {
            if (!project.isGenerated) {
                summary.skipped += 1;
                continue;
            }

            const fullProject = await getProject(userId, project.id);
            const schedules = fullProject?.generatedSchedules || [];
            if (schedules.length === 0) {
                summary.skipped += 1;
                continue;
            }

            const inputs = buildDraftInputs(
                fullProject?.name || project.name || 'Generated Project',
                userId,
                schedules,
                { type: 'generated', id: project.id }
            );

            if (inputs.length === 0) {
                summary.skipped += 1;
                continue;
            }

            for (const input of inputs) {
                await saveDraft(userId, input);
                summary.migrated += 1;
            }
        } catch (error) {
            summary.errors.push(`Project ${project.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return summary;
};

export const migrateLegacyUserData = async (userId: string): Promise<MigrationSummary> => {
    const draftSummary = await migrateLegacyDrafts(userId);
    const projectSummary = await migrateGeneratedProjects(userId);

    return {
        migrated: draftSummary.migrated + projectSummary.migrated,
        skipped: draftSummary.skipped + projectSummary.skipped,
        errors: [...draftSummary.errors, ...projectSummary.errors]
    };
};
