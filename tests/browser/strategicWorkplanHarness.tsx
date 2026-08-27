import React from 'react';
import { createRoot } from 'react-dom/client';
import { StrategicPlanWorkspace } from '../../components/Analytics/StrategicPlanWorkspace';
import type { StrategicWorkplanWorkspaceServices } from '../../components/Analytics/StrategicWorkplanWorkspace';
import { buildStrategicWorkplanAudit } from '../../utils/strategic-plan/workplanAudit';
import { createStrategicWorkplanBaseline } from '../../utils/strategic-plan/workplanBaseline';
import type { StrategicWorkplanDocument, StrategicWorkplanVersion } from '../../utils/strategic-plan/workplanTypes';

let savedWorkplan: StrategicWorkplanDocument | null = null;
const versions: StrategicWorkplanVersion[] = [];

const workplanServices: StrategicWorkplanWorkspaceServices = {
    load: async () => savedWorkplan ? structuredClone(savedWorkplan) : null,
    listVersions: async () => structuredClone(versions),
    save: async (_teamId, workplan, userId, userLabel) => {
        const editedAt = new Date().toISOString();
        const next: StrategicWorkplanDocument = {
            ...structuredClone(workplan),
            revision: workplan.revision + 1,
            updatedAt: editedAt,
            updatedBy: userId,
        };
        versions.unshift({
            ...structuredClone(next),
            audit: buildStrategicWorkplanAudit(
                savedWorkplan ?? createStrategicWorkplanBaseline(next.teamId, next.createdBy),
                next,
                { uid: userId, name: userLabel },
                editedAt,
            ),
        });
        savedWorkplan = next;
        return structuredClone(next);
    },
};

createRoot(document.getElementById('root')!).render(
    <StrategicPlanWorkspace
        onBack={() => undefined}
        requestingTeamId="dillon-team"
        workplanTeamId="barrie-team"
        ridershipTeamId="barrie-team"
        currentUserId="browser-planner"
        currentUserLabel="Browser Planner"
        workplanServices={workplanServices}
    />,
);
